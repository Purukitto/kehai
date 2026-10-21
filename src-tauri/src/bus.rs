use std::collections::HashMap;
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

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
    /// Everyone else listening: the remote panels.
    taps: Vec<SyncSender<serde_json::Value>>,
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
            if let Ok(mut guard) = STATE.lock() {
                let state = guard.get_or_insert_with(State::default);
                state.retained.insert(topic.to_string(), value.clone());
                // A full tap is a reader that stopped reading. Dropping it
                // closes its channel, which is its cue to go away.
                state.taps.retain(|tap| match tap.try_send(value.clone()) {
                    Ok(()) => true,
                    Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) => false,
                });
            }
            if let Err(err) = app.emit("bus", value) {
                eprintln!("bus: dropped {topic}: {err}");
            }
        }
        Err(err) => eprintln!("bus: {topic} did not serialise: {err}"),
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
    eprintln!("bus: replayed {} retained topics", values.len());
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
