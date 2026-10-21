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

/// Linux reaches players over MPRIS on the session bus.
#[cfg(target_os = "linux")]
mod platform {
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::OnceLock;

    use super::MediaPayload;
    use zbus::blocking::fdo::DBusProxy;
    use zbus::blocking::Connection;
    use zbus::zvariant::{OwnedValue, Value};

    const PREFIX: &str = "org.mpris.MediaPlayer2.";
    const PATH: &str = "/org/mpris/MediaPlayer2";
    const ROOT: &str = "org.mpris.MediaPlayer2";
    const PLAYER: &str = "org.mpris.MediaPlayer2.Player";
    const PROPERTIES: &str = "org.freedesktop.DBus.Properties";

    type Props = HashMap<String, OwnedValue>;

    /// One connection for the life of the app. Opening the session bus every
    /// second would be a socket and a handshake per tick.
    fn bus() -> Option<&'static Connection> {
        static BUS: OnceLock<Option<Connection>> = OnceLock::new();
        BUS.get_or_init(|| match Connection::session() {
            Ok(conn) => Some(conn),
            Err(err) => {
                eprintln!("poller.media: no session bus: {err}");
                None
            }
        })
        .as_ref()
    }

    /// Read fresh each time rather than through a caching proxy: players are
    /// not required to announce position changes, so a cache goes stale.
    fn get_all(bus: &Connection, name: &str, iface: &str) -> Option<Props> {
        bus.call_method(Some(name), PATH, Some(PROPERTIES), "GetAll", &iface)
            .ok()?
            .body()
            .deserialize::<Props>()
            .ok()
    }

    /// Values inside a dictionary of variants arrive wrapped in one more.
    fn plain<'v, 'a>(v: &'v Value<'a>) -> &'v Value<'a> {
        match v {
            Value::Value(inner) => plain(inner),
            other => other,
        }
    }

    fn text(v: Option<&Value<'_>>) -> Option<String> {
        match plain(v?) {
            Value::Str(s) => Some(s.as_str().to_string()),
            _ => None,
        }
    }

    /// `xesam:artist` is a list, but some players send a single string.
    fn texts(v: Option<&Value<'_>>) -> Vec<String> {
        match v.map(plain) {
            Some(Value::Array(list)) => list.inner().iter().filter_map(|s| text(Some(s))).collect(),
            Some(single) => text(Some(single)).into_iter().collect(),
            None => Vec::new(),
        }
    }

    /// Microseconds, which the spec says are signed and some players send
    /// unsigned.
    fn micros(v: Option<&Value<'_>>) -> Option<i64> {
        match plain(v?) {
            Value::I64(n) => Some(*n),
            Value::U64(n) => i64::try_from(*n).ok(),
            Value::I32(n) => Some(i64::from(*n)),
            Value::U32(n) => Some(i64::from(*n)),
            _ => None,
        }
    }

    fn field<'v>(metadata: &'v Value<'static>, key: &str) -> Option<&'v Value<'static>> {
        let Value::Dict(dict) = plain(metadata) else {
            return None;
        };
        dict.iter()
            .find(|(k, _)| matches!(plain(k), Value::Str(s) if s.as_str() == key))
            .map(|(_, v)| v)
    }

    fn players(bus: &Connection) -> Vec<String> {
        let Ok(dbus) = DBusProxy::new(bus) else {
            return Vec::new();
        };
        dbus.list_names()
            .map(|names| {
                names
                    .into_iter()
                    .map(|n| n.to_string())
                    .filter(|n| n.starts_with(PREFIX))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The player worth showing: one that is playing, else one that is paused,
    /// else any. Windows picks a current session for us; MPRIS leaves the choice
    /// to whoever is asking.
    fn current(bus: &Connection) -> Option<(String, Props)> {
        let mut best: Option<(u8, String, Props)> = None;
        for name in players(bus) {
            let Some(props) = get_all(bus, &name, PLAYER) else {
                continue;
            };
            let rank = match text(props.get("PlaybackStatus").map(|v| &**v)).as_deref() {
                Some("Playing") => 0,
                Some("Paused") => 1,
                _ => 2,
            };
            if best.as_ref().is_none_or(|(r, _, _)| rank < *r) {
                best = Some((rank, name, props));
            }
        }
        best.map(|(_, name, props)| (name, props))
    }

    /// The player's own name for itself, falling back to its bus name, which is
    /// lower case and can carry an instance suffix.
    fn identity(bus: &Connection, name: &str) -> String {
        bus.call_method(
            Some(name),
            PATH,
            Some(PROPERTIES),
            "Get",
            &(ROOT, "Identity"),
        )
        .ok()
        .and_then(|reply| reply.body().deserialize::<OwnedValue>().ok())
        .and_then(|v| text(Some(&v)))
        .unwrap_or_else(|| {
            let tail = name.strip_prefix(PREFIX).unwrap_or(name);
            tail.split('.').next().unwrap_or(tail).to_string()
        })
    }

    /// Only art already on disk is shown. A player that offers its cover as a
    /// web address would have Kehai make a request it promises not to make.
    fn art_path(metadata: &Value<'static>) -> Option<PathBuf> {
        let url = text(field(metadata, "mpris:artUrl"))?;
        if !url.starts_with("file://") {
            return None;
        }
        tauri::Url::parse(&url).ok()?.to_file_path().ok()
    }

    pub fn snapshot() -> Option<MediaPayload> {
        let bus = bus()?;
        let (name, props) = current(bus)?;
        let metadata = props.get("Metadata")?;

        let title = text(field(metadata, "xesam:title")).unwrap_or_default();
        if title.is_empty() {
            return None;
        }

        let secs = |us: i64| (us.max(0) / 1_000_000) as u64;

        Some(MediaPayload {
            playing: text(props.get("PlaybackStatus").map(|v| &**v)).as_deref() == Some("Playing"),
            title,
            artist: texts(field(metadata, "xesam:artist")).join(", "),
            elapsed_sec: micros(props.get("Position").map(|v| &**v))
                .map(secs)
                .unwrap_or(0),
            duration_sec: micros(field(metadata, "mpris:length"))
                .map(secs)
                .unwrap_or(0),
            has_art: art_path(metadata).is_some(),
            player: identity(bus, &name),
        })
    }

    /// Reads the cover from disk as a data URL. Players often cache covers
    /// without an extension, so the type comes from the file's first bytes, and
    /// anything that is not a recognisable image is left out.
    pub fn artwork() -> Option<String> {
        use base64::Engine;

        const MAX_BYTES: u64 = 4 * 1024 * 1024;

        let bus = bus()?;
        let (_, props) = current(bus)?;
        let path = art_path(props.get("Metadata")?)?;

        let size = std::fs::metadata(&path).ok()?.len();
        if size == 0 || size > MAX_BYTES {
            return None;
        }
        let bytes = std::fs::read(&path).ok()?;

        let mime = if bytes.starts_with(b"\x89PNG") {
            "image/png"
        } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
            "image/jpeg"
        } else if bytes.starts_with(b"GIF8") {
            "image/gif"
        } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
            "image/webp"
        } else {
            return None;
        };

        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        Some(format!("data:{mime};base64,{encoded}"))
    }

    pub fn control(action: &str) {
        let method = match action {
            "playpause" => "PlayPause",
            "next" => "Next",
            "previous" => "Previous",
            _ => return,
        };
        let Some(bus) = bus() else { return };
        let Some((name, _)) = current(bus) else {
            return;
        };
        if let Err(err) = bus.call_method(Some(name.as_str()), PATH, Some(PLAYER), method, &()) {
            eprintln!("poller.media: {method} refused by {name}: {err}");
        }
    }
}

/// macOS keeps its now-playing information behind a private framework. Not
/// wired, so the widget correctly reports nothing playing rather than pretending.
#[cfg(not(any(windows, target_os = "linux")))]
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
