use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::AppHandle;

use crate::bus;

const INTERVAL: Duration = Duration::from_millis(30_000);
const WINDOW_HOURS: i64 = 5;
const BUCKETS: usize = 56;

/// Mirrors `QuotaPayload` in `src/core/payloads.ts`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QuotaPayload {
    pub provider: String,
    pub tokens_in: u64,
    pub tokens_out: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub requests: u64,
    pub window_hours: i64,
    pub resets_in_ms: i64,
    pub burn_per_min: u64,
    pub models: Vec<ModelUsage>,
    pub history: Vec<u64>,
    /// No local source exposes the real plan limit, so this stays `None` until
    /// the user sets a budget. The widget shows counts rather than inventing a
    /// percentage against a number nobody published.
    pub budget_tokens: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    pub tokens: u64,
}

struct Event {
    at_ms: i64,
    model: String,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        let Some(root) = transcript_root() else {
            eprintln!("poller.quota: no ~/.claude/projects directory; quota stays empty");
            return;
        };

        eprintln!(
            "poller.quota: reading local transcripts from {}",
            root.display()
        );

        let mut announced = false;

        loop {
            let window_ms = WINDOW_HOURS * 60 * 60 * 1000;
            let now = now_ms();
            let since = now - window_ms;

            let events = collect(&root, since);
            let payload = summarise(events, now, since);

            if !announced {
                announced = true;
                eprintln!(
                    "poller.quota: {}h window, {} requests, {} in / {} out tokens, {} models",
                    payload.window_hours,
                    payload.requests,
                    payload.tokens_in,
                    payload.tokens_out,
                    payload.models.len()
                );
            }

            bus::publish(&app, "dev:llm_tokens", "poller.quota", payload);

            thread::sleep(INTERVAL);
        }
    });
}

fn summarise(events: Vec<Event>, now: i64, since: i64) -> QuotaPayload {
    let window_ms = now - since;

    let mut tokens_in = 0u64;
    let mut tokens_out = 0u64;
    let mut cache_read = 0u64;
    let mut cache_write = 0u64;
    let mut per_model: Vec<(String, u64)> = Vec::new();
    let mut history = vec![0u64; BUCKETS];
    let mut oldest = now;
    let mut recent = 0u64;

    let recent_from = now - window_ms / 4;

    for e in &events {
        tokens_in += e.input;
        tokens_out += e.output;
        cache_read += e.cache_read;
        cache_write += e.cache_write;

        let billed = e.input + e.output;
        if e.at_ms < oldest {
            oldest = e.at_ms;
        }
        if e.at_ms >= recent_from {
            recent += billed;
        }

        match per_model.iter_mut().find(|(m, _)| *m == e.model) {
            Some((_, total)) => *total += billed,
            None => per_model.push((e.model.clone(), billed)),
        }

        let offset = (e.at_ms - since).max(0) as f64 / window_ms.max(1) as f64;
        let idx = ((offset * BUCKETS as f64) as usize).min(BUCKETS - 1);
        history[idx] += billed;
    }

    per_model.sort_by_key(|(_, total)| std::cmp::Reverse(*total));

    let quarter_min = (window_ms / 4) as f64 / 60_000.0;
    let burn_per_min = if quarter_min > 0.0 {
        (recent as f64 / quarter_min).round() as u64
    } else {
        0
    };

    QuotaPayload {
        provider: "Coding agent".to_string(),
        tokens_in,
        tokens_out,
        cache_read,
        cache_write,
        requests: events.len() as u64,
        window_hours: WINDOW_HOURS,
        // When the oldest counted event falls out of the window.
        resets_in_ms: (oldest + window_ms - now).max(0),
        burn_per_min,
        models: per_model
            .into_iter()
            .map(|(model, tokens)| ModelUsage { model, tokens })
            .collect(),
        history,
        budget_tokens: None,
    }
}

/// Walks `projects/*/**.jsonl`, skipping files untouched since the window opened.
fn collect(root: &PathBuf, since: i64) -> Vec<Event> {
    let mut events = Vec::new();

    let Ok(projects) = fs::read_dir(root) else {
        return events;
    };

    for project in projects.flatten() {
        let Ok(files) = fs::read_dir(project.path()) else {
            continue;
        };

        for entry in files.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            if modified_ms(&entry) < since {
                continue;
            }
            read_file(&path, since, &mut events);
        }
    }

    events
}

fn read_file(path: &PathBuf, since: i64, out: &mut Vec<Event>) {
    let Ok(file) = File::open(path) else { return };

    for line in BufReader::new(file).lines().map_while(Result::ok) {
        // Most lines are not assistant turns. A substring test is far cheaper
        // than parsing every record in a transcript thousands of lines long.
        if !line.contains("\"usage\"") {
            continue;
        }

        let Ok(record) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };

        let Some(at_ms) = record
            .get("timestamp")
            .and_then(|t| t.as_str())
            .and_then(parse_iso)
        else {
            continue;
        };
        if at_ms < since {
            continue;
        }

        let Some(message) = record.get("message") else {
            continue;
        };
        let Some(usage) = message.get("usage") else {
            continue;
        };

        let num = |key: &str| usage.get(key).and_then(|v| v.as_u64()).unwrap_or(0);

        out.push(Event {
            at_ms,
            model: message
                .get("model")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown")
                .to_string(),
            input: num("input_tokens"),
            output: num("output_tokens"),
            cache_read: num("cache_read_input_tokens"),
            cache_write: num("cache_creation_input_tokens"),
        });
    }
}

/// Minimal RFC 3339 reader for the shape these transcripts use, so the poller
/// does not pull in a date library for one field.
fn parse_iso(s: &str) -> Option<i64> {
    let bytes = s.as_bytes();
    if bytes.len() < 19 {
        return None;
    }

    let part = |from: usize, to: usize| s.get(from..to)?.parse::<i64>().ok();

    let year = part(0, 4)?;
    let month = part(5, 7)?;
    let day = part(8, 10)?;
    let hour = part(11, 13)?;
    let min = part(14, 16)?;
    let sec = part(17, 19)?;

    let millis = s
        .get(20..23)
        .and_then(|m| m.parse::<i64>().ok())
        .filter(|_| bytes.get(19) == Some(&b'.'))
        .unwrap_or(0);

    Some(
        (days_from_civil(year, month, day) * 86_400 + hour * 3600 + min * 60 + sec) * 1000 + millis,
    )
}

/// Howard Hinnant's civil-date algorithm: days since the Unix epoch.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn modified_ms(entry: &fs::DirEntry) -> i64 {
    entry
        .metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn transcript_root() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    let root = PathBuf::from(home).join(".claude").join("projects");
    root.is_dir().then_some(root)
}
