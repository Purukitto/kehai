use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Listener};

use crate::bus;

const INTERVAL: Duration = Duration::from_millis(1000);

/// Mirrors `MediaPayload` in `src/core/payloads.ts`.
#[derive(Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaPayload {
    pub playing: bool,
    pub title: String,
    pub artist: String,
    pub elapsed_sec: u64,
    pub duration_sec: u64,
    pub has_art: bool,
    pub player: String,
}

/// Mirrors `ArtPayload` in `src/core/payloads.ts`.
#[derive(Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArtPayload {
    pub data_url: Option<String>,
}

/// What the widget asks for. The widget states an intent and the engine owns
/// the side effect, so a wedged player can never block the panel's render loop.
#[derive(Deserialize)]
struct Command {
    action: String,
}

pub fn spawn(app: AppHandle) {
    let commands = app.clone();
    commands.listen("media:command", move |event| {
        let Ok(cmd) = serde_json::from_str::<Command>(event.payload()) else {
            return;
        };
        // Off the event thread: a control call can block on a slow player.
        let action = cmd.action;
        thread::spawn(move || platform::control(&action));
    });

    thread::spawn(move || {
        let mut last: Option<MediaPayload> = None;
        let mut last_track = String::new();
        let mut announced = false;

        loop {
            let current = platform::snapshot();

            if !announced {
                announced = true;
                match &current {
                    Some(m) => eprintln!("poller.media: session found via {}", m.player),
                    None => {
                        eprintln!("poller.media: no media session; widget shows nothing playing")
                    }
                }
            }

            // Publishing a byte-identical payload every second would wake every
            // subscriber for nothing. Position changes, so this still ticks
            // once a second while something is playing.
            // Artwork travels on its own topic and only when the track
            // changes. Position moves every second; the cover does not, and a
            // re-encoded JPEG every tick would push megabytes over the bridge.
            let track = current
                .as_ref()
                .map(|m| format!("{}\u{1}{}", m.title, m.artist))
                .unwrap_or_default();

            if track != last_track {
                last_track = track;
                let data_url = if current.is_some() {
                    platform::artwork()
                } else {
                    None
                };
                match &data_url {
                    Some(url) => eprintln!("poller.media: artwork {} bytes", url.len()),
                    None => eprintln!("poller.media: no artwork for this track"),
                }
                bus::publish(&app, "media:art", "poller.media", ArtPayload { data_url });
            }

            if last.as_ref() != current.as_ref() {
                match &current {
                    Some(payload) => {
                        bus::publish(&app, "media:now_playing", "poller.media", payload.clone())
                    }
                    None => bus::publish(
                        &app,
                        "media:now_playing",
                        "poller.media",
                        serde_json::Value::Null,
                    ),
                }
                last = current;
            }

            thread::sleep(INTERVAL);
        }
    });
}

#[cfg(windows)]
mod platform {
    use super::MediaPayload;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };

    fn session() -> Option<Session> {
        Manager::RequestAsync()
            .ok()?
            .get()
            .ok()?
            .GetCurrentSession()
            .ok()
    }

    pub fn snapshot() -> Option<MediaPayload> {
        let session = session()?;
        let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let timeline = session.GetTimelineProperties().ok()?;
        let playback = session.GetPlaybackInfo().ok()?;

        let title = props.Title().map(|s| s.to_string()).unwrap_or_default();
        if title.is_empty() {
            return None;
        }

        // WinRT durations are 100-nanosecond ticks.
        let secs = |ticks: i64| (ticks.max(0) / 10_000_000) as u64;

        Some(MediaPayload {
            playing: playback
                .PlaybackStatus()
                .map(|s| s == Status::Playing)
                .unwrap_or(false),
            title,
            artist: props.Artist().map(|s| s.to_string()).unwrap_or_default(),
            elapsed_sec: timeline.Position().map(|d| secs(d.Duration)).unwrap_or(0),
            duration_sec: timeline.EndTime().map(|d| secs(d.Duration)).unwrap_or(0),
            has_art: props.Thumbnail().is_ok(),
            player: session
                .SourceAppUserModelId()
                .map(|s| friendly(&s.to_string()))
                .unwrap_or_else(|_| "Unknown".to_string()),
        })
    }

    /// Reads the session's cover art as a data URL.
    ///
    /// The thumbnail arrives as a WinRT stream, so it has to be pulled into
    /// memory and encoded. Anything implausibly large is dropped rather than
    /// pushed across the IPC bridge.
    pub fn artwork() -> Option<String> {
        use base64::Engine;
        use windows::Storage::Streams::DataReader;

        const MAX_BYTES: u64 = 4 * 1024 * 1024;

        let session = session()?;
        let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.get().ok()?;

        let size = stream.Size().ok()?;
        if size == 0 || size > MAX_BYTES {
            return None;
        }

        let mime = stream
            .ContentType()
            .map(|s| s.to_string())
            .unwrap_or_else(|_| "image/png".to_string());

        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).ok()?).ok()?;
        reader.LoadAsync(size as u32).ok()?.get().ok()?;

        let mut buffer = vec![0u8; size as usize];
        reader.ReadBytes(&mut buffer).ok()?;

        let encoded = base64::engine::general_purpose::STANDARD.encode(&buffer);
        Some(format!("data:{mime};base64,{encoded}"))
    }

    pub fn control(action: &str) {
        let Some(session) = session() else { return };
        let _ = match action {
            "playpause" => session.TryTogglePlayPauseAsync().map(|op| op.get()),
            "next" => session.TrySkipNextAsync().map(|op| op.get()),
            "previous" => session.TrySkipPreviousAsync().map(|op| op.get()),
            _ => return,
        };
    }

    /// App user model IDs are things like `Spotify.exe` or a packaged triple.
    /// Show the recognisable part rather than the raw identifier.
    fn friendly(aumid: &str) -> String {
        let tail = aumid.rsplit('!').next().unwrap_or(aumid);
        let base = tail.strip_suffix(".exe").unwrap_or(tail);
        let name = base.split('.').next_back().unwrap_or(base);
        if name.is_empty() {
            aumid.to_string()
        } else {
            name.to_string()
        }
    }
}

/// Linux reaches players over MPRIS on the session bus. Not wired yet, so the
/// widget correctly reports nothing playing rather than pretending.
#[cfg(not(windows))]
mod platform {
    use super::MediaPayload;

    pub fn snapshot() -> Option<MediaPayload> {
        None
    }

    pub fn artwork() -> Option<String> {
        None
    }

    pub fn control(_action: &str) {}
}
