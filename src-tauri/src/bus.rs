use std::collections::HashMap;
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::log;

/// The one shape everything on the bus takes, whatever the source.
///
/// Mirrors the `Envelope` interface in `src/core/types.ts`. Keep them in step:
/// the renderer treats anything arriving on the `bus` channel as one of these.
#[derive(Serialize, Clone)]
pub struct Envelope<T> {
    pub topic: String,
    pub ts: u128,
    pub src: String,
    pub data: T,
}

/// How far a tap may fall behind before it is cut off. A remote panel on a
/// stalled connection would otherwise hold every envelope published since.
const TAP_BACKLOG: usize = 512;
/// With More detail on, how often the log hears what each topic published.
const COUNT_EVERY: Duration = Duration::from_secs(60);

#[derive(Default)]
struct State {
    /// Last value per topic.
    ///
    /// Tauri events are fire-and-forget: anything emitted before a webview
    /// attaches is simply gone. Frequent topics recover on their next tick, but
    /// a poller that only publishes on change — the notification sink, cover
    /// art — would stay silent forever after losing its first send. The
    /// renderer's bus retains last values for exactly this reason; the gap was
    /// that the retention stopped at the IPC boundary.
    retained: HashMap<String, serde_json::Value>,
    /// Everyone else listening: the remote panels, and the tray.
    taps: Vec<SyncSender<serde_json::Value>>,
    /// With More detail on: how many times each topic published, and since when.
    counts: HashMap<String, u32>,
    counting_since: Option<Instant>,
}

impl State {
    /// A source that stalls or floods shows here. Returns a line for the log
    /// once a minute.
    fn count(&mut self, topic: &str) -> Option<String> {
        if !log::detailed() {
            self.counts.clear();
            self.counting_since = None;
            return None;
        }
        *self.counts.entry(topic.to_string()).or_default() += 1;
        let since = *self.counting_since.get_or_insert_with(Instant::now);
        if since.elapsed() < COUNT_EVERY {
            return None;
        }
        let mut counts: Vec<_> = self.counts.drain().collect();
        counts.sort();
        self.counting_since = Some(Instant::now());
        let counts: Vec<String> = counts.iter().map(|(t, n)| format!("{t} {n}")).collect();
        Some(format!(
            "published in {} s: {}",
            since.elapsed().as_secs(),
            counts.join(", ")
        ))
    }
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Publish onto the renderer's bus. Emitting is fire-and-forget by design — a
/// closed window must never stall a poller thread, and neither may a slow tap.
pub fn publish<T: Serialize + Clone>(app: &AppHandle, topic: &str, src: &str, data: T) {
    let envelope = Envelope {
        topic: topic.to_string(),
        ts: now_ms(),
        src: src.to_string(),
        data,
    };

    match serde_json::to_value(&envelope) {
        Ok(value) => {
            let mut counted = None;
            if let Ok(mut guard) = STATE.lock() {
                let state = guard.get_or_insert_with(State::default);
                state.retained.insert(topic.to_string(), value.clone());
                // A full tap is a reader that stopped reading. Dropping it
                // closes its channel, which is its cue to go away.
                state.taps.retain(|tap| match tap.try_send(value.clone()) {
                    Ok(()) => true,
                    Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) => false,
                });
                counted = state.count(topic);
            }
            // Outside the lock: the log publishes too.
            if let Some(line) = counted {
                log::detail("bus", || line);
            }
            if let Err(err) = app.emit("bus", value) {
                log::warn("bus", format!("dropped {topic}: {err}"));
            }
        }
        Err(err) => log::warn("bus", format!("{topic} did not serialise: {err}")),
    }
}

/// Re-emit the last value of every topic. Called when a renderer says hello, so
/// a window that opens late — or reloads — starts with the full picture rather
/// than waiting out each poller's interval.
pub fn replay(app: &AppHandle) {
    let values = snapshot();
    for value in &values {
        let _ = app.emit("bus", value.clone());
    }
    log::info("bus", format!("replayed {} retained topics", values.len()));
}

/// The last value of every topic.
pub fn snapshot() -> Vec<serde_json::Value> {
    let Ok(guard) = STATE.lock() else {
        return Vec::new();
    };
    guard
        .as_ref()
        .map(|state| state.retained.values().cloned().collect())
        .unwrap_or_default()
}

/// Everything retained so far, and everything published from now on. Taken
/// under one lock, so nothing published in between is missed or repeated.
pub fn tap() -> (Vec<serde_json::Value>, Receiver<serde_json::Value>) {
    let (tx, rx) = mpsc::sync_channel(TAP_BACKLOG);
    let Ok(mut guard) = STATE.lock() else {
        return (Vec::new(), rx);
    };
    let state = guard.get_or_insert_with(State::default);
    state.taps.push(tx);
    (state.retained.values().cloned().collect(), rx)
}
