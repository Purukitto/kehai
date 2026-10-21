use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Listener};

use crate::bus;

const INTERVAL: Duration = Duration::from_millis(30_000);
/// How long the first read waits for the renderer to say which folder to use.
/// See `spawn`.
const FIRST_ROOT_GRACE: Duration = Duration::from_millis(5_000);
/// The length of a usage block, and of the history the sparkline covers.
const BLOCK_HOURS: i64 = 5;
const HOUR_MS: i64 = 60 * 60 * 1000;
/// How far back the reader looks to find where the current block began. A block
/// starts with the first request after the previous one ended, so finding it
/// means walking forward from a quiet spell; this is enough history for any
/// day that has one.
const LOOKBACK_HOURS: i64 = 24;
/// `<root>/<project>/<session>/subagents/<agent>.jsonl` is three folders down.
/// Sub-agents draw on the same limit as the session that started them.
const MAX_DEPTH: usize = 3;
const BUCKETS: usize = 56;
const PROVIDER: &str = "Coding agent";

/// Mirrors `QuotaPayload` in `src/core/payloads.ts`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QuotaPayload {
    /// False when there is nothing to read — not the same as a quiet window.
    /// Going silent instead would be indistinguishable from a slow first poll.
    pub available: bool,
    pub reason: Option<String>,
    pub provider: String,
    /// Counted inside the current block. All zero when there is none.
    pub tokens_in: u64,
    pub tokens_out: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub requests: u64,
    pub window_hours: i64,
    /// When the current block began, or `None` when the last one has ended and
    /// the next request will start another.
    pub block_start_ms: Option<i64>,
    /// Until the current block ends. Zero when there is none.
    pub resets_in_ms: i64,
    /// Tokens per minute over the last quarter of the block length.
    pub burn_per_min: u64,
    pub models: Vec<ModelUsage>,
    /// The last `window_hours`, rolling, whatever block it fell in.
    pub history: Vec<u64>,
    /// No local source exposes the real plan limit, so this stays `None` until
    /// the user sets a budget. The widget shows counts rather than inventing a
    /// percentage against a number nobody published.
    pub budget_tokens: Option<u64>,
}

impl QuotaPayload {
    /// Nothing to read from. Counters are zeroed rather than omitted so the
    /// widget can render without special-casing every field, and `history`
    /// keeps its length so the sparkline still has a well-formed series.
    fn unavailable(reason: String) -> Self {
        Self {
            available: false,
            reason: Some(reason),
            provider: PROVIDER.to_string(),
            tokens_in: 0,
            tokens_out: 0,
            cache_read: 0,
            cache_write: 0,
            requests: 0,
            window_hours: BLOCK_HOURS,
            block_start_ms: None,
            resets_in_ms: 0,
            burn_per_min: 0,
            models: Vec::new(),
            history: vec![0; BUCKETS],
            budget_tokens: None,
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    pub tokens: u64,
}

struct Event {
    at_ms: i64,
    /// Message and request ids together. The agent writes one transcript line
    /// per content block of a reply, and every one of them repeats the reply's
    /// usage, so counting lines counts most replies two or three times.
    key: Option<String>,
    model: String,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
}

/// What has been read of one transcript. They only ever grow, so each pass
/// reads on from where the last one stopped instead of from the top.
#[derive(Default)]
struct Tail {
    read_to: u64,
    events: Vec<Event>,
}

/// Every transcript being followed, for one folder.
#[derive(Default)]
struct Tails {
    root: PathBuf,
    files: HashMap<PathBuf, Tail>,
}

/// Mirrors `QuotaCommand` in `src/core/payloads.ts`. The folder is kept in the
/// renderer's settings, so this is the only way the engine learns it.
#[derive(Deserialize)]
struct Command {
    action: String,
    /// `None` means the default location.
    path: Option<String>,
}

pub fn spawn(app: AppHandle) {
    let (chosen_tx, chosen_rx) = mpsc::channel::<Option<PathBuf>>();

    let commands = app.clone();
    commands.listen("quota:command", move |event| {
        let Ok(cmd) = serde_json::from_str::<Command>(event.payload()) else {
            return;
        };
        if cmd.action != "set_root" {
            return;
        }
        let path = cmd.path.filter(|p| !p.trim().is_empty()).map(PathBuf::from);
        // The read itself happens on the poller thread, which this wakes; a
        // folder with a lot of recent transcripts takes a while to tally.
        let _ = chosen_tx.send(path);
    });

    thread::spawn(move || {
        // The renderer sends its choice once its bridge is up, which is after
        // this thread starts. Reading the default first would publish another
        // folder's figures, or its absence, which drops the quota tab from
        // Stage, only to replace them a second later.
        let mut chosen = chosen_rx.recv_timeout(FIRST_ROOT_GRACE).ok().flatten();
        let mut tails = Tails::default();
        let mut last_said = String::new();

        loop {
            // Resolved every pass rather than once at start, so a changed
            // setting, or a folder that appears after launch, is picked up.
            let (payload, said) = match read(chosen.as_deref(), &mut tails) {
                Ok((root, payload)) => (
                    payload,
                    format!("reading local transcripts from {}", root.display()),
                ),
                Err(reason) => (QuotaPayload::unavailable(reason.clone()), reason),
            };

            if said != last_said {
                eprintln!("poller.quota: {said}");
                if payload.available {
                    eprintln!(
                        "poller.quota: {} block, {} requests, {} in / {} out tokens, {} models",
                        if payload.block_start_ms.is_some() {
                            "in a"
                        } else {
                            "no active"
                        },
                        payload.requests,
                        payload.tokens_in,
                        payload.tokens_out,
                        payload.models.len()
                    );
                }
                last_said = said;
            }

            bus::publish(&app, "dev:llm_tokens", "poller.quota", payload);

            // Wait out the interval, but wake for a new folder: a path edited
            // in Settings should show its effect now, not up to 30 s later.
            match chosen_rx.recv_timeout(INTERVAL) {
                // Several changes queued behind a slow read: only the last counts.
                Ok(path) => chosen = chosen_rx.try_iter().last().unwrap_or(path),
                Err(RecvTimeoutError::Timeout) => {}
                // Only if the listener is gone. Without the sleep this would spin.
                Err(RecvTimeoutError::Disconnected) => thread::sleep(INTERVAL),
            }
        }
    });
}

/// One pass over the chosen folder, or the default. A folder with no
/// transcripts in it at all is reported as such: counting it as a quiet window
/// would show zeroes for a source that is not there.
fn read(chosen: Option<&Path>, tails: &mut Tails) -> Result<(PathBuf, QuotaPayload), String> {
    let root = transcript_root(chosen)?;
    if tails.root != root {
        *tails = Tails {
            root: root.clone(),
            files: HashMap::new(),
        };
    }

    let now = now_ms();
    let since = now - LOOKBACK_HOURS * HOUR_MS;

    if !collect(&root, since, &mut tails.files) {
        return Err(format!(
            "no agent session transcripts at {}",
            root.display()
        ));
    }

    // Once per reply, however many lines carried it. Keyed across files too:
    // nothing guarantees a reply is only ever written to one transcript.
    let mut seen = HashSet::new();
    let mut events: Vec<&Event> = tails
        .files
        .values()
        .flat_map(|tail| &tail.events)
        .filter(|e| e.key.as_ref().is_none_or(|k| seen.insert(k)))
        .collect();
    events.sort_by_key(|e| e.at_ms);

    let payload = summarise(&events, now);
    Ok((root, payload))
}

/// The block `now` falls in, as `(start, end)`, if one is running.
///
/// A block opens with the first request after the previous block ended, on
/// the hour before it, in UTC, and lasts `BLOCK_HOURS`. That is how local usage
/// tools reconstruct the provider's limit window; the provider does not
/// document it, so the reset time shown is an estimate.
fn active_block(events: &[&Event], now: i64) -> Option<(i64, i64)> {
    let mut block: Option<(i64, i64)> = None;
    for e in events {
        if block.is_none_or(|(_, end)| e.at_ms >= end) {
            let start = e.at_ms - e.at_ms.rem_euclid(HOUR_MS);
            block = Some((start, start + BLOCK_HOURS * HOUR_MS));
        }
    }
    block.filter(|&(_, end)| now < end)
}

fn summarise(events: &[&Event], now: i64) -> QuotaPayload {
    let block = active_block(events, now);
    let span_ms = BLOCK_HOURS * HOUR_MS;
    let history_from = now - span_ms;
    let recent_from = now - span_ms / 4;

    let mut tokens_in = 0u64;
    let mut tokens_out = 0u64;
    let mut cache_read = 0u64;
    let mut cache_write = 0u64;
    let mut requests = 0u64;
    let mut per_model: Vec<(String, u64)> = Vec::new();
    let mut history = vec![0u64; BUCKETS];
    let mut recent = 0u64;

    for e in events {
        let billed = e.input + e.output;

        if block.is_some_and(|(start, _)| e.at_ms >= start) {
            tokens_in += e.input;
            tokens_out += e.output;
            cache_read += e.cache_read;
            cache_write += e.cache_write;
            requests += 1;
            match per_model.iter_mut().find(|(m, _)| *m == e.model) {
                Some((_, total)) => *total += billed,
                None => per_model.push((e.model.clone(), billed)),
            }
        }

        if e.at_ms >= recent_from {
            recent += billed;
        }

        if e.at_ms >= history_from {
            let offset = (e.at_ms - history_from) as f64 / span_ms as f64;
            let idx = ((offset * BUCKETS as f64) as usize).min(BUCKETS - 1);
            history[idx] += billed;
        }
    }

    per_model.sort_by_key(|(_, total)| std::cmp::Reverse(*total));

    let quarter_min = (span_ms / 4) as f64 / 60_000.0;
    let burn_per_min = (recent as f64 / quarter_min).round() as u64;

    QuotaPayload {
        available: true,
        reason: None,
        provider: PROVIDER.to_string(),
        tokens_in,
        tokens_out,
        cache_read,
        cache_write,
        requests,
        window_hours: BLOCK_HOURS,
        block_start_ms: block.map(|(start, _)| start),
        resets_in_ms: block.map_or(0, |(_, end)| end - now),
        burn_per_min,
        models: per_model
            .into_iter()
            .map(|(model, tokens)| ModelUsage { model, tokens })
            .collect(),
        history,
        budget_tokens: None,
    }
}

/// Brings every transcript touched since `since` up to date, and forgets the
/// rest. False when there is not a single transcript, however old.
fn collect(root: &Path, since: i64, files: &mut HashMap<PathBuf, Tail>) -> bool {
    let mut found = Vec::new();
    walk(root, 0, &mut found);
    if found.is_empty() {
        files.clear();
        return false;
    }

    let mut live = HashSet::new();
    for (path, modified, len) in found {
        if modified < since {
            continue;
        }
        let tail = files.entry(path.clone()).or_default();
        follow(&path, len, tail);
        tail.events.retain(|e| e.at_ms >= since);
        live.insert(path);
    }
    files.retain(|path, _| live.contains(path));
    true
}

/// Every `.jsonl` under `dir`, with when it last changed and how long it is.
fn walk(dir: &Path, depth: usize, out: &mut Vec<(PathBuf, i64, u64)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let path = entry.path();
        if meta.is_dir() {
            if depth < MAX_DEPTH {
                walk(&path, depth + 1, out);
            }
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            out.push((path, modified_ms(&meta), meta.len()));
        }
    }
}

/// Reads whatever has been appended since the last pass. A line still being
/// written has no newline yet and is left for next time, rather than parsed
/// half-finished and then skipped as already read.
fn follow(path: &Path, len: u64, tail: &mut Tail) {
    if len < tail.read_to {
        // Shorter than what was read: rewritten, not appended to.
        *tail = Tail::default();
    }
    if len == tail.read_to {
        return;
    }

    let Ok(mut file) = File::open(path) else {
        return;
    };
    if file.seek(SeekFrom::Start(tail.read_to)).is_err() {
        return;
    }

    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    loop {
        line.clear();
        let Ok(n) = reader.read_until(b'\n', &mut line) else {
            return;
        };
        if n == 0 || line.last() != Some(&b'\n') {
            return;
        }
        tail.read_to += n as u64;
        if let Some(event) = parse(&String::from_utf8_lossy(&line)) {
            tail.events.push(event);
        }
    }
}

fn parse(line: &str) -> Option<Event> {
    // Most lines are not assistant turns. A substring test is far cheaper
    // than parsing every record in a transcript thousands of lines long.
    if !line.contains("\"usage\"") {
        return None;
    }

    let record = serde_json::from_str::<serde_json::Value>(line).ok()?;
    let at_ms = record
        .get("timestamp")
        .and_then(|t| t.as_str())
        .and_then(parse_iso)?;
    let message = record.get("message")?;
    let usage = message.get("usage")?;

    let num = |key: &str| usage.get(key).and_then(|v| v.as_u64()).unwrap_or(0);
    fn id(v: Option<&serde_json::Value>) -> &str {
        v.and_then(|v| v.as_str()).unwrap_or("")
    }
    let message_id = id(message.get("id"));

    Some(Event {
        at_ms,
        key: (!message_id.is_empty())
            .then(|| format!("{message_id}:{}", id(record.get("requestId")))),
        model: message
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown")
            .to_string(),
        input: num("input_tokens"),
        output: num("output_tokens"),
        cache_read: num("cache_read_input_tokens"),
        cache_write: num("cache_creation_input_tokens"),
    })
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

fn modified_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
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

/// The directory the poller tails, or a reason the widget can show the user.
/// The path is worth carrying into the failure: it is the one piece of
/// information that explains what is missing.
fn transcript_root(chosen: Option<&Path>) -> Result<PathBuf, String> {
    let root = match chosen {
        // A relative path would resolve against wherever the app was launched
        // from, and read a different folder depending on how it was started.
        Some(path) if !path.is_absolute() => {
            return Err(format!("{} is not an absolute path", path.display()));
        }
        Some(path) => path.to_path_buf(),
        None => {
            let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))
            else {
                return Err("no home directory in the environment".to_string());
            };
            PathBuf::from(home).join(".claude").join("projects")
        }
    };

    if root.is_dir() {
        Ok(root)
    } else if root.exists() {
        Err(format!("{} is not a folder", root.display()))
    } else {
        Err(format!(
            "no agent session transcripts at {}",
            root.display()
        ))
    }
}
