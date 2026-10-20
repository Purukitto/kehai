use std::collections::HashMap;
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

/// Last value per topic.
///
/// Tauri events are fire-and-forget: anything emitted before a webview attaches
/// is simply gone. Frequent topics recover on their next tick, but a poller
/// that only publishes on change — the notification sink, cover art — would
/// stay silent forever after losing its first send. The renderer's bus retains
/// last values for exactly this reason; the gap was that the retention stopped
/// at the IPC boundary.
static RETAINED: Mutex<Option<HashMap<String, serde_json::Value>>> = Mutex::new(None);

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Publish onto the renderer's bus. Emitting is fire-and-forget by design — a
/// closed window must never stall a poller thread.
pub fn publish<T: Serialize + Clone>(app: &AppHandle, topic: &str, src: &str, data: T) {
    let envelope = Envelope {
        topic: topic.to_string(),
        ts: now_ms(),
        src: src.to_string(),
        data,
    };

    match serde_json::to_value(&envelope) {
        Ok(value) => {
            if let Ok(mut guard) = RETAINED.lock() {
                guard
                    .get_or_insert_with(HashMap::new)
                    .insert(topic.to_string(), value.clone());
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
    let Ok(guard) = RETAINED.lock() else { return };
    let Some(map) = guard.as_ref() else { return };

    for value in map.values() {
        let _ = app.emit("bus", value.clone());
    }

    eprintln!("bus: replayed {} retained topics", map.len());
}
