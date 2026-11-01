use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Listener};

use crate::bus;
use crate::log;

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
    /// The player takes a new position. Some browser tabs don't.
    pub can_seek: bool,
}

/// Mirrors `VolumePayload` in `src/core/payloads.ts`: this computer's main
/// output, as the volume keys turn it, whatever is playing. Published as null
/// where Kehai can't reach it.
#[derive(Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VolumePayload {
    /// 0 to 100.
    pub level: u8,
    pub muted: bool,
}

/// Mirrors `ArtPayload` in `src/core/payloads.ts`.
#[derive(Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArtPayload {
    pub data_url: Option<String>,
}

/// What the widget asks for. The widget states an intent and the engine owns
/// the side effect, so a wedged player can never block the panel's render loop.
/// Mirrors `MediaCommand` in `src/core/payloads.ts`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Command {
    action: String,
    /// `seek`: where to, in seconds from the start of the track.
    position_sec: Option<f64>,
    /// `volume`: 0 to 100.
    level: Option<f64>,
    /// `mute`.
    muted: Option<bool>,
}

/// A command checked and put in range. Anything else is dropped here.
pub enum Action {
    PlayPause,
    Next,
    Previous,
    /// Seconds from the start of the track.
    Seek(f64),
    /// 0.0 to 1.0. Changing the volume unmutes, as the volume keys do.
    Volume(f32),
    Mute(bool),
}

impl Command {
    fn action(&self) -> Option<Action> {
        let finite = |v: Option<f64>| v.filter(|v| v.is_finite());
        match self.action.as_str() {
            "playpause" => Some(Action::PlayPause),
            "next" => Some(Action::Next),
            "previous" => Some(Action::Previous),
            "seek" => finite(self.position_sec).map(|s| Action::Seek(s.max(0.0))),
            "volume" => {
                finite(self.level).map(|l| Action::Volume((l.clamp(0.0, 100.0) / 100.0) as f32))
            }
            "mute" => self.muted.map(Action::Mute),
            _ => None,
        }
    }
}

pub fn spawn(app: AppHandle) {
    let commands = app.clone();
    let publisher = app.clone();
    commands.listen("media:command", move |event| {
        let Some(action) = serde_json::from_str::<Command>(event.payload())
            .ok()
            .and_then(|cmd| cmd.action())
        else {
            return;
        };
        // Off the event thread: a control call can block on a slow player.
        let app = publisher.clone();
        thread::spawn(move || {
            platform::control(&action);
            // Said at once rather than at the next tick, so the level under a
            // finger pressing + keeps up with it.
            if matches!(action, Action::Volume(_) | Action::Mute(_)) {
                bus::publish(&app, "media:volume", "poller.media", platform::volume());
            }
        });
    });

    thread::spawn(move || {
        let mut last: Option<MediaPayload> = None;
        let mut last_track = String::new();
        let mut last_volume: Option<Option<VolumePayload>> = None;
        let mut announced = false;

        loop {
            let volume = platform::volume();
            if last_volume != Some(volume) {
                bus::publish(&app, "media:volume", "poller.media", volume);
                last_volume = Some(volume);
            }

            let current = platform::snapshot();

            if !announced {
                announced = true;
                match &current {
                    Some(m) => log::info("poller.media", format!("session found via {}", m.player)),
                    None => log::info(
                        "poller.media",
                        "no media session; widget shows nothing playing",
                    ),
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
                log::detail("poller.media", || match &data_url {
                    Some(url) => format!("artwork {} bytes", url.len()),
                    None => "no artwork for this track".into(),
                });
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
    use super::{Action, MediaPayload, VolumePayload};
    use crate::log;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
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
            can_seek: playback
                .Controls()
                .and_then(|c| c.IsPlaybackPositionEnabled())
                .unwrap_or(false),
        })
    }

    /// This thread's place in the multithreaded apartment, which the audio
    /// calls need, given back when dropped. Declared before any interface it
    /// covers, so those are released first.
    struct Apartment(bool);

    impl Apartment {
        #[allow(unsafe_code)]
        fn join() -> Self {
            // SAFETY: no pointers. S_FALSE (already in it) also counts, and is
            // balanced on drop like S_OK.
            Self(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
        }
    }

    impl Drop for Apartment {
        #[allow(unsafe_code)]
        fn drop(&mut self) {
            if self.0 {
                // SAFETY: pairs the successful join above, on the same thread.
                unsafe { CoUninitialize() };
            }
        }
    }

    /// The default output device's volume, the one the volume keys turn.
    /// Looked up each time, so plugging in headphones moves it with them.
    #[allow(unsafe_code)]
    fn endpoint() -> Option<IAudioEndpointVolume> {
        // SAFETY: a class the system registers, asked for by its own ID.
        let devices: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.ok()?;
        // SAFETY: plain calls on the live enumerator and the device it returns.
        let device = unsafe { devices.GetDefaultAudioEndpoint(eRender, eConsole) }.ok()?;
        unsafe { device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) }.ok()
    }

    #[allow(unsafe_code)]
    pub fn volume() -> Option<VolumePayload> {
        let _apartment = Apartment::join();
        let endpoint = endpoint()?;
        // SAFETY: getters on a live interface.
        let level = unsafe { endpoint.GetMasterVolumeLevelScalar() }.ok()?;
        let muted = unsafe { endpoint.GetMute() }.ok()?.as_bool();
        Some(VolumePayload {
            level: (level.clamp(0.0, 1.0) * 100.0).round() as u8,
            muted,
        })
    }

    #[allow(unsafe_code)]
    fn set_volume(action: &Action) {
        let _apartment = Apartment::join();
        let Some(endpoint) = endpoint() else { return };
        let none = std::ptr::null();
        // SAFETY: setters on a live interface. A null event context only means
        // the change carries no tag of ours.
        let result = unsafe {
            match *action {
                Action::Volume(level) => endpoint
                    .SetMute(false, none)
                    .and_then(|()| endpoint.SetMasterVolumeLevelScalar(level, none)),
                Action::Mute(muted) => endpoint.SetMute(muted, none),
                _ => return,
            }
        };
        if let Err(err) = result {
            log::warn("poller.media", format!("volume not changed: {err}"));
        }
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

    pub fn control(action: &Action) {
        if matches!(action, Action::Volume(_) | Action::Mute(_)) {
            set_volume(action);
            return;
        }
        let Some(session) = session() else { return };
        let _ = match *action {
            Action::PlayPause => session.TryTogglePlayPauseAsync().map(|op| op.get()),
            Action::Next => session.TrySkipNextAsync().map(|op| op.get()),
            Action::Previous => session.TrySkipPreviousAsync().map(|op| op.get()),
            // WinRT positions are 100-nanosecond ticks.
            Action::Seek(sec) => session
                .TryChangePlaybackPositionAsync((sec * 10_000_000.0) as i64)
                .map(|op| op.get()),
            Action::Volume(_) | Action::Mute(_) => return,
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
    use crate::log;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::OnceLock;

    use super::{Action, MediaPayload, VolumePayload};
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
                log::warn("poller.media", format!("no session bus: {err}"));
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
            can_seek: matches!(
                props.get("CanSeek").map(|v| &**v).map(plain),
                Some(Value::Bool(true))
            ),
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

    /// The system volume belongs to PulseAudio or PipeWire, which Kehai has
    /// no way into without another dependency. The speaker doesn't show.
    pub fn volume() -> Option<VolumePayload> {
        None
    }

    pub fn control(action: &Action) {
        let Some(bus) = bus() else { return };
        let Some((name, props)) = current(bus) else {
            return;
        };
        let result = match *action {
            Action::PlayPause => {
                bus.call_method(Some(name.as_str()), PATH, Some(PLAYER), "PlayPause", &())
            }
            Action::Next => bus.call_method(Some(name.as_str()), PATH, Some(PLAYER), "Next", &()),
            Action::Previous => {
                bus.call_method(Some(name.as_str()), PATH, Some(PLAYER), "Previous", &())
            }
            // Seek moves by an offset in microseconds, so it needs no track
            // ID, which SetPosition does and not every player gives.
            Action::Seek(sec) => {
                let now = micros(props.get("Position").map(|v| &**v)).unwrap_or(0);
                let offset = (sec * 1_000_000.0) as i64 - now;
                bus.call_method(Some(name.as_str()), PATH, Some(PLAYER), "Seek", &offset)
            }
            Action::Volume(_) | Action::Mute(_) => return,
        };
        if let Err(err) = result {
            log::warn(
                "poller.media",
                format!("a command was refused by {name}: {err}"),
            );
        }
    }
}

/// macOS keeps its now-playing information behind a private framework. Not
/// wired, so the widget correctly reports nothing playing rather than pretending.
#[cfg(not(any(windows, target_os = "linux")))]
mod platform {
    use super::{Action, MediaPayload, VolumePayload};

    pub fn snapshot() -> Option<MediaPayload> {
        None
    }

    pub fn artwork() -> Option<String> {
        None
    }

    pub fn volume() -> Option<VolumePayload> {
        None
    }

    pub fn control(_action: &Action) {}
}
