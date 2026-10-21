use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::RecvTimeoutError;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;

use super::transcripts::{self, now_ms, parse_iso, transcript_root, Transcripts};
use crate::bus;

const INTERVAL: Duration = Duration::from_millis(30_000);
/// The length of a usage block, and of the history the sparkline covers.
const BLOCK_HOURS: i64 = 5;
const HOUR_MS: i64 = 60 * 60 * 1000;
/// How far back the reader looks to find where the current block began. A block
/// starts with the first request after the previous one ended, so finding it
/// means walking forward from a quiet spell; this is enough history for any
/// day that has one.
const LOOKBACK_HOURS: i64 = 24;
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

pub fn spawn(app: AppHandle) {
    let chosen_rx = transcripts::chosen_roots(&app);

    thread::spawn(move || {
        // Waiting for the renderer's choice keeps a wrong first read, which
        // drops the quota tab from Stage, off the panel.
        let mut chosen = chosen_rx
            .recv_timeout(transcripts::FIRST_ROOT_GRACE)
            .ok()
            .flatten();
        // Every line in the lookback counts, so each transcript is read whole.
        let mut tails = Transcripts::new(None);
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
fn read(
    chosen: Option<&Path>,
    tails: &mut Transcripts<Vec<Event>>,
) -> Result<(PathBuf, QuotaPayload), String> {
    let root = transcript_root(chosen)?;
    tails.point_at(&root);

    let now = now_ms();
    let since = now - LOOKBACK_HOURS * HOUR_MS;

    if !tails.collect(since, |events, line| events.extend(parse(line))) {
        return Err(format!(
            "no agent session transcripts at {}",
            root.display()
        ));
    }
    for events in tails.states_mut() {
        events.retain(|e| e.at_ms >= since);
    }

    // Once per reply, however many lines carried it. Keyed across files too:
    // nothing guarantees a reply is only ever written to one transcript.
    let mut seen = HashSet::new();
    let mut events: Vec<&Event> = tails
        .files()
        .flat_map(|(_, tail)| &tail.state)
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
