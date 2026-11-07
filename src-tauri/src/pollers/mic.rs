//! The PC's microphone: whether it is muted, and which apps have it open now.
//!
//! Muting is the default microphone's own mute, the one Windows' sound
//! settings show, so it holds for every app at once. Which apps are listening
//! comes from Windows' privacy records, the same ones its microphone indicator
//! in the taskbar reads. Kehai asks them only which apps are using it now, and
//! never says when any app last did.

use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Listener};

use super::launch;
use crate::bus;
use crate::log;

const SRC: &str = "poller.mic";
const INTERVAL: Duration = Duration::from_secs(2);

/// Mirrors `MicPayload` in `src/core/payloads.ts`.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MicPayload {
    /// There is a microphone to speak of.
    pub available: bool,
    pub muted: bool,
    /// The apps with it open now, by the name the Start menu gives them.
    pub listening: Vec<String>,
}

/// One app Windows' records say has the microphone open: by its package, or
/// by its program's path for an app that isn't packaged.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Holder {
    pub package: Option<String>,
    pub exe: Option<String>,
}

/// Mirrors `MicCommand` in `src/core/payloads.ts`.
#[derive(Deserialize)]
struct Command {
    action: String,
    muted: Option<bool>,
}

/// The apps with the microphone open now.
pub fn holders() -> Vec<Holder> {
    platform::holders()
}

/// A program path as the records write it: `C:#Apps#chat.exe`.
#[cfg_attr(not(windows), allow(dead_code))]
fn record_path(key: &str) -> String {
    key.replace('#', "\\")
}

fn payload() -> MicPayload {
    let (available, muted) = platform::state();
    let own = std::env::current_exe()
        .ok()
        .map(|p| p.to_string_lossy().to_ascii_lowercase());
    let mut listening: Vec<String> = Vec::new();
    for h in holders() {
        if h.exe.as_deref().map(str::to_ascii_lowercase) == own && own.is_some() {
            continue;
        }
        if let Some(name) = launch::name_for(h.package.as_deref(), h.exe.as_deref()) {
            if !listening.contains(&name) {
                listening.push(name);
            }
        }
    }
    MicPayload {
        available,
        muted: available && muted,
        listening,
    }
}

pub fn spawn(app: AppHandle) {
    let publisher = app.clone();
    app.listen("mic:command", move |event| {
        let Ok(cmd) = serde_json::from_str::<Command>(event.payload()) else {
            return;
        };
        let (true, Some(muted)) = (cmd.action == "mute", cmd.muted) else {
            return;
        };
        let app = publisher.clone();
        thread::spawn(move || {
            match platform::set_mute(muted) {
                Ok(()) => log::info(SRC, if muted { "muted" } else { "unmuted" }),
                Err(why) => log::warn(SRC, format!("mute not changed: {why}")),
            }
            bus::publish(&app, "os:mic", SRC, payload());
        });
    });

    thread::spawn(move || {
        let mut last: Option<MicPayload> = None;
        loop {
            let now = payload();
            if last.as_ref() != Some(&now) {
                if last.as_ref().map(|l| l.available) != Some(now.available) {
                    log::info(
                        SRC,
                        if now.available {
                            "a microphone is there"
                        } else {
                            "no microphone"
                        },
                    );
                }
                bus::publish(&app, "os:mic", SRC, now.clone());
                last = Some(now);
            }
            thread::sleep(INTERVAL);
        }
    });
}

#[cfg(windows)]
mod platform {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        eCapture, eCommunications, eConsole, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED,
    };
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    use super::{record_path, Holder};

    const RECORDS: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";

    struct Apartment(bool);

    impl Apartment {
        #[allow(unsafe_code)]
        fn join() -> Self {
            // SAFETY: no pointers. S_FALSE (already in it) counts, and is
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

    /// The default microphone, and the one for calls where that is another:
    /// apps in a call listen on the second.
    #[allow(unsafe_code)]
    fn endpoints() -> Vec<IAudioEndpointVolume> {
        let mut seen: Vec<String> = Vec::new();
        let mut out = Vec::new();
        // SAFETY: a class the system registers, asked for by its own ID.
        let Ok(devices) = (unsafe {
            CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
        }) else {
            return out;
        };
        for role in [eConsole, eCommunications] {
            // SAFETY: plain calls on the live enumerator and the device it
            // returns; the id string is freed straight after.
            unsafe {
                let Ok(device) = devices.GetDefaultAudioEndpoint(eCapture, role) else {
                    continue;
                };
                let id = device
                    .GetId()
                    .ok()
                    .map(|p| {
                        let s = p.to_string().unwrap_or_default();
                        CoTaskMemFree(Some(p.0 as *const _));
                        s
                    })
                    .unwrap_or_default();
                if seen.contains(&id) {
                    continue;
                }
                if let Ok(volume) = device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) {
                    seen.push(id);
                    out.push(volume);
                }
            }
        }
        out
    }

    /// Whether there is a microphone, and whether every one of them is muted.
    #[allow(unsafe_code)]
    pub fn state() -> (bool, bool) {
        let _apartment = Apartment::join();
        let all = endpoints();
        // SAFETY: a getter on a live interface.
        let muted = all
            .iter()
            .all(|e| unsafe { e.GetMute() }.is_ok_and(|m| m.as_bool()));
        (!all.is_empty(), muted)
    }

    #[allow(unsafe_code)]
    pub fn set_mute(muted: bool) -> Result<(), String> {
        let _apartment = Apartment::join();
        let all = endpoints();
        if all.is_empty() {
            return Err("no microphone".to_string());
        }
        for e in &all {
            // SAFETY: a setter on a live interface. A null event context only
            // means the change carries no tag of ours.
            unsafe { e.SetMute(muted, std::ptr::null()) }.map_err(|e| e.message())?;
        }
        Ok(())
    }

    /// In use now: started, and not stopped since.
    fn in_use(key: &RegKey) -> bool {
        let start: u64 = key.get_value("LastUsedTimeStart").unwrap_or(0);
        let stop: Option<u64> = key.get_value("LastUsedTimeStop").ok();
        start > 0 && stop == Some(0)
    }

    pub fn holders() -> Vec<Holder> {
        let Ok(records) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(RECORDS) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for name in records.enum_keys().flatten() {
            let Ok(key) = records.open_subkey(&name) else {
                continue;
            };
            if name.eq_ignore_ascii_case("NonPackaged") {
                for program in key.enum_keys().flatten() {
                    if key.open_subkey(&program).is_ok_and(|k| in_use(&k)) {
                        out.push(Holder {
                            package: None,
                            exe: Some(record_path(&program)),
                        });
                    }
                }
            } else if in_use(&key) {
                out.push(Holder {
                    package: Some(name),
                    exe: None,
                });
            }
        }
        out
    }
}

#[cfg(not(windows))]
mod platform {
    use super::Holder;

    pub fn state() -> (bool, bool) {
        (false, false)
    }

    pub fn set_mute(_muted: bool) -> Result<(), String> {
        Err("the microphone is set only on Windows so far".to_string())
    }

    pub fn holders() -> Vec<Holder> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_records_key_is_the_programs_path() {
        assert_eq!(
            record_path("C:#Users#u#AppData#Local#Chat#app-1.0#Chat.exe"),
            r"C:\Users\u\AppData\Local\Chat\app-1.0\Chat.exe"
        );
    }
}
