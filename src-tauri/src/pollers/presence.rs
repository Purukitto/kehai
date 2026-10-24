use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Listener};

use crate::bus;

const TOPIC: &str = "os:presence";
const SRC: &str = "poller.presence";
/// Fast enough that a touch on a quiet panel brings it back before anyone
/// wonders whether it heard, and cheap: two system calls a tick.
const INTERVAL: Duration = Duration::from_secs(1);

/// Whether anyone is at this computer, as far as the panel needs to know.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
enum State {
    Here,
    /// No input for as long as the renderer asked for.
    Away,
    /// The system's lock screen covers every display, so nothing is drawn.
    Locked,
}

/// Engine → local renderer on `os:presence`. Mirrors `PresencePayload` in
/// `src/core/payloads.ts`. Never sent to a remote panel: when you are at your
/// desk is nobody else's business.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
struct PresencePayload {
    /// False where the platform gives no idle time, which is not the same as
    /// someone always being here.
    available: bool,
    reason: Option<String>,
    state: State,
}

/// Renderer → engine on `presence:command`. Mirrors `PresenceCommand` in
/// `src/core/payloads.ts`. The delay is a setting, and settings live in the
/// renderer.
#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum Command {
    /// How long without input counts as away. None for never.
    Configure { away_after_sec: Option<u64> },
}

/// What one look at the system found. Only Windows makes one so far.
#[cfg_attr(not(windows), allow(dead_code))]
struct Sample {
    idle: Duration,
    locked: bool,
}

/// Locked wins over away: a locked session is not drawn at all, however long
/// it has been.
fn decide(sample: &Sample, away_after: Option<Duration>) -> State {
    if sample.locked {
        State::Locked
    } else if away_after.is_some_and(|after| sample.idle >= after) {
        State::Away
    } else {
        State::Here
    }
}

fn payload(sample: Result<Sample, String>, away_after: Option<Duration>) -> PresencePayload {
    match sample {
        Ok(sample) => PresencePayload {
            available: true,
            reason: None,
            state: decide(&sample, away_after),
        },
        Err(reason) => PresencePayload {
            available: false,
            reason: Some(reason),
            state: State::Here,
        },
    }
}

/// Publishes only changes. Until the renderer sends a delay, nobody is ever
/// away: a copy whose settings say never must not blink out at launch.
pub fn spawn(app: AppHandle) {
    let (command_tx, command_rx) = mpsc::channel::<Command>();
    app.listen(
        "presence:command",
        move |event| match serde_json::from_str::<Command>(event.payload()) {
            Ok(command) => {
                let _ = command_tx.send(command);
            }
            Err(err) => eprintln!("poller.presence: ignored a command: {err}"),
        },
    );

    thread::spawn(move || {
        let mut away_after: Option<Duration> = None;
        let mut last = payload(platform::sample(), away_after);
        bus::publish(&app, TOPIC, SRC, last.clone());

        loop {
            match command_rx.recv_timeout(INTERVAL) {
                Ok(Command::Configure { away_after_sec }) => {
                    away_after = away_after_sec.map(Duration::from_secs);
                }
                Err(RecvTimeoutError::Timeout) => {}
                // Only if the listener is gone. Without the sleep this would spin.
                Err(RecvTimeoutError::Disconnected) => thread::sleep(INTERVAL),
            }
            let next = payload(platform::sample(), away_after);
            if next != last {
                bus::publish(&app, TOPIC, SRC, next.clone());
                last = next;
            }
        }
    });
}

/// Input from any keyboard, mouse, pen or touchscreen on this session counts,
/// the panel's own touchscreen included, and the session's own lock state says
/// whether its lock screen is up.
#[cfg(windows)]
mod platform {
    use std::time::Duration;

    use windows::core::PWSTR;
    use windows::Win32::System::RemoteDesktop::{
        WTSFreeMemory, WTSQuerySessionInformationW, WTSSessionInfoEx, WTSINFOEXW,
        WTS_CURRENT_SESSION, WTS_SESSIONSTATE_LOCK,
    };
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    use super::Sample;

    #[allow(unsafe_code)]
    fn idle() -> Result<Duration, String> {
        let mut info = LASTINPUTINFO {
            cbSize: size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        // SAFETY: a live local, with cbSize set as the call requires.
        if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
            return Err("Windows did not say when you last used this computer".to_string());
        }
        // SAFETY: no arguments, no preconditions.
        let now = unsafe { GetTickCount() };
        // Both are milliseconds since boot in 32 bits, which wrap every 49.7
        // days; wrapping subtraction stays right across the wrap.
        Ok(Duration::from_millis(u64::from(
            now.wrapping_sub(info.dwTime),
        )))
    }

    /// Unknown counts as unlocked, so a failed query can only ever leave the
    /// panel showing, never blank it.
    #[allow(unsafe_code)]
    fn locked() -> bool {
        let mut buffer = PWSTR::null();
        let mut bytes = 0u32;
        // SAFETY: both out-pointers are live locals. The buffer the call
        // allocates is read only within the size it reports, and freed below.
        let queried = unsafe {
            WTSQuerySessionInformationW(
                None,
                WTS_CURRENT_SESSION,
                WTSSessionInfoEx,
                &mut buffer,
                &mut bytes,
            )
        };
        if queried.is_err() || buffer.is_null() {
            return false;
        }
        let locked = if bytes as usize >= size_of::<WTSINFOEXW>() {
            // SAFETY: the buffer holds a WTSINFOEXW, as the size just checked
            // says, and level 1 is the only level the call returns.
            let info = unsafe { &*buffer.0.cast::<WTSINFOEXW>() };
            info.Level == 1
                && unsafe { info.Data.WTSInfoExLevel1.SessionFlags } == WTS_SESSIONSTATE_LOCK as i32
        } else {
            false
        };
        // SAFETY: allocated by the query above, and not touched after this.
        unsafe { WTSFreeMemory(buffer.0.cast()) };
        locked
    }

    pub fn sample() -> Result<Sample, String> {
        Ok(Sample {
            idle: idle()?,
            locked: locked(),
        })
    }
}

/// Idle time and the lock come from the session bus elsewhere, through
/// interfaces that differ between desktops. Until they are wired, the panel
/// says it cannot tell, rather than claiming you never leave.
#[cfg(not(windows))]
mod platform {
    use super::Sample;

    pub fn sample() -> Result<Sample, String> {
        Err("Kehai cannot yet tell when you are away on this system".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(idle_sec: u64, locked: bool) -> Sample {
        Sample {
            idle: Duration::from_secs(idle_sec),
            locked,
        }
    }

    const TEN_MIN: Option<Duration> = Some(Duration::from_secs(600));

    #[test]
    fn here_until_the_delay_has_passed() {
        assert_eq!(decide(&at(0, false), TEN_MIN), State::Here);
        assert_eq!(decide(&at(599, false), TEN_MIN), State::Here);
        assert_eq!(decide(&at(600, false), TEN_MIN), State::Away);
    }

    #[test]
    fn never_away_without_a_delay() {
        assert_eq!(decide(&at(86_400, false), None), State::Here);
    }

    #[test]
    fn locked_wins_over_everything() {
        assert_eq!(decide(&at(0, true), TEN_MIN), State::Locked);
        assert_eq!(decide(&at(86_400, true), TEN_MIN), State::Locked);
        assert_eq!(decide(&at(0, true), None), State::Locked);
    }

    #[test]
    fn a_platform_that_cannot_tell_says_so() {
        let got = payload(Err("no".to_string()), TEN_MIN);
        assert!(!got.available);
        assert_eq!(got.reason.as_deref(), Some("no"));
        assert_eq!(got.state, State::Here);
    }

    #[test]
    fn the_command_reads_as_the_renderer_writes_it() {
        let read = |json: &str| {
            let Command::Configure { away_after_sec } =
                serde_json::from_str(json).expect("command parses");
            away_after_sec
        };
        assert_eq!(
            read(r#"{"action":"configure","awayAfterSec":300}"#),
            Some(300)
        );
        assert_eq!(read(r#"{"action":"configure","awayAfterSec":null}"#), None);
    }

    #[test]
    fn the_state_reads_as_the_renderer_expects() {
        let json =
            serde_json::to_value(payload(Ok(at(700, false)), TEN_MIN)).expect("payload serialises");
        assert_eq!(
            json,
            serde_json::json!({ "available": true, "reason": null, "state": "away" })
        );
    }

    /// The real system calls, against the session the test runs in. A build
    /// machine has no one at its desk, so this is run by hand:
    /// `cargo test -- --ignored reads_this_session`.
    #[cfg(windows)]
    #[test]
    #[ignore = "reads the session it runs in; run by hand at a desk"]
    fn reads_this_session() {
        let sample = platform::sample().expect("Windows says when it was last used");
        eprintln!("idle {:?}, locked {}", sample.idle, sample.locked);
        assert!(!sample.locked, "a session running tests is not locked");
        assert!(sample.idle < Duration::from_secs(3600));
    }
}
