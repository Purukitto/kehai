//! The brightness of the display Kehai is for, set over the display's own
//! control line (DDC/CI). Night and the quiet panel turn the backlight down,
//! rather than only darkening what Kehai draws, and bring it back.
//!
//! Many displays save each change to their own memory, which wears with
//! writes, so Kehai writes only when something changes (night starts or ends,
//! you leave or come back, the slider settles, Kehai quits), never a fade.
//! Reading is a question, not a change, and wears nothing: the display is read
//! every few seconds to notice its own buttons.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Listener, Manager};

use super::display::{self, Where};
use crate::bus;
use crate::log;

const TOPIC: &str = "app:backlight";
const SRC: &str = "poller.backlight";
const STORE_FILE: &str = "backlight.json";
/// How often the display is read, to notice its own buttons and where Kehai is.
const INTERVAL: Duration = Duration::from_secs(3);
/// A level from the slider waits this long for the finger to stop, so a run of
/// taps is one write.
const SETTLE_SET: Duration = Duration::from_millis(500);
/// Night, away and a level being previewed are written almost at once.
const SETTLE_HOLD: Duration = Duration::from_millis(150);
/// Some displays answer a read with the old level for a moment after a write.
const AFTER_WRITE: Duration = Duration::from_millis(1500);
/// A display that didn't answer is asked again this often: one that has just
/// woken may miss the first question.
const RETRY: Duration = Duration::from_secs(30);

const NO_ANSWER: &str = "This display doesn’t let programs set its brightness, so at night Kehai darkens what it draws instead.";
const MISSING: &str = "Kehai is on the main display while its own is missing, and leaves the brightness of every display alone until it’s back.";
const ELSEWHERE: &str =
    "Kehai isn’t on the display it’s for just now, and leaves the brightness of every display alone.";

/// Engine → local renderer on `app:backlight`. Mirrors `BacklightPayload` in
/// `src/core/payloads.ts`. Never sent to a remote panel.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
struct BacklightPayload {
    available: bool,
    reason: Option<String>,
    /// What night and away come back to, 0–100 of the display's range.
    yours: Option<u32>,
    /// Where the display is now.
    now: Option<u32>,
}

impl BacklightPayload {
    fn unavailable(reason: &str) -> Self {
        BacklightPayload {
            available: false,
            reason: Some(reason.to_string()),
            yours: None,
            now: None,
        }
    }
}

/// Renderer → engine on `backlight:command`. Mirrors `BacklightCommand`.
#[derive(Deserialize, PartialEq, Debug)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Command {
    /// Yours, from the slider.
    Set { level: f64 },
    /// Hold the display here for now. None gives it back to yours.
    Hold { level: Option<f64> },
}

/// A level the renderer sent, as the display's percent.
fn percent(level: f64) -> u32 {
    if level.is_finite() {
        level.round().clamp(0.0, 100.0) as u32
    } else {
        0
    }
}

/// What a start after a crash needs to give the display back. Written beside
/// `display.json`.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct Stored {
    /// The display's id, as `display.json` keeps it.
    display: String,
    yours: u32,
    /// What Kehai last left the display at.
    wrote: Option<u32>,
}

/// Decides what the display should be at. Pure, so the rules can be tested
/// without a display: the caller reads, writes and reports back.
#[derive(Debug, Default, PartialEq)]
struct Keeper {
    yours: Option<u32>,
    /// Where the renderer asks the display to be held, for night or away.
    hold: Option<u32>,
    /// Where the display was last read or left.
    known: Option<u32>,
    /// While the panel is hidden in the tray the display is yours: Kehai isn't
    /// on it to dim.
    shown: bool,
    /// Its own buttons moved it while it was held. Kept until the next change.
    by_hand: bool,
}

impl Keeper {
    /// The first reading of a display. One that Kehai left turned down when it
    /// last stopped, and that still reads what Kehai left it at, gets yours
    /// back from the store. Anything else is yours as it is.
    fn attach(read: u32, stored: Option<&Stored>, shown: bool) -> Self {
        let yours = match stored {
            Some(s) if s.wrote == Some(read) && s.yours != read => s.yours,
            _ => read,
        };
        Keeper {
            yours: Some(yours),
            hold: None,
            known: Some(read),
            shown,
            by_hand: false,
        }
    }

    /// Never brighter than yours: a night is never lighter than your day.
    fn target(&self) -> Option<u32> {
        let yours = self.yours?;
        Some(match (self.shown, self.hold) {
            (true, Some(hold)) => hold.min(yours),
            _ => yours,
        })
    }

    fn set(&mut self, level: u32) {
        self.yours = Some(level);
        self.by_hand = false;
    }

    fn hold(&mut self, level: Option<u32>) {
        if self.hold != level {
            self.hold = level;
            self.by_hand = false;
        }
    }

    fn show(&mut self, shown: bool) {
        if self.shown != shown {
            self.shown = shown;
            self.by_hand = false;
        }
    }

    fn held(&self) -> bool {
        self.shown && self.hold.is_some()
    }

    /// A reading that moved since Kehai last left it is someone at the
    /// display's own buttons. While nothing holds it, that is yours, and the
    /// slider follows. While night or away holds it, it stays until the next
    /// change. True when yours moved.
    fn observe(&mut self, read: u32) -> bool {
        // A display may round a level it was given by one either way.
        if self.known.is_some_and(|k| k.abs_diff(read) <= 1) {
            return false;
        }
        self.known = Some(read);
        if self.held() {
            self.by_hand = true;
            false
        } else {
            self.yours = Some(read);
            true
        }
    }

    /// The level to write now, if the display isn't there already.
    fn due(&self) -> Option<u32> {
        if self.by_hand {
            return None;
        }
        let target = self.target()?;
        (self.known != Some(target)).then_some(target)
    }

    fn wrote(&mut self, level: u32) {
        self.known = Some(level);
    }

    fn payload(&self) -> BacklightPayload {
        BacklightPayload {
            available: true,
            reason: None,
            yours: self.yours,
            now: self.known,
        }
    }

    fn stored(&self, display: &str) -> Option<Stored> {
        Some(Stored {
            display: display.to_string(),
            yours: self.yours?,
            wrote: self.known,
        })
    }
}

/// The display Kehai has, while it has one.
struct Attached {
    id: String,
    device: String,
    keeper: Keeper,
    last_write: Option<Instant>,
    /// The last write failed, so the next failure isn't logged again.
    failing: bool,
}

/// Serialises every exchange with a display, so the give-back at quit never
/// talks over the poller's own.
static LINE: Mutex<()> = Mutex::new(());
/// What a quit must put back: the display and yours, while Kehai has it
/// anywhere else.
static GIVE_BACK: Mutex<Option<(String, u32)>> = Mutex::new(None);

fn read(device: &str) -> Result<u32, String> {
    let _line = LINE.lock();
    platform::read(device)
}

fn write(device: &str, level: u32) -> Result<(), String> {
    let _line = LINE.lock();
    platform::write(device, level)
}

/// Puts the display back at yours. Called as Kehai quits, so a panel turned
/// down for the night isn't left that way.
pub fn give_back() {
    let owed = GIVE_BACK.lock().ok().and_then(|mut g| g.take());
    if let Some((device, yours)) = owed {
        match write(&device, yours) {
            Ok(()) => log::info(SRC, format!("gave the display back at {yours}%")),
            Err(err) => log::warn(SRC, format!("could not give the display back: {err}")),
        }
    }
}

fn note_give_back(attached: Option<&Attached>) {
    let owed = attached.and_then(|a| {
        let yours = a.keeper.yours?;
        (a.keeper.known != Some(yours)).then(|| (a.device.clone(), yours))
    });
    if let Ok(mut g) = GIVE_BACK.lock() {
        *g = owed;
    }
}

fn store_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(STORE_FILE))
}

fn load(path: &Path) -> Option<Stored> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn save(path: &Path, stored: &Stored) {
    match serde_json::to_string(stored) {
        Ok(json) => {
            if let Err(err) = fs::write(path, json) {
                log::warn(SRC, format!("could not keep the level: {err}"));
            }
        }
        Err(err) => log::warn(SRC, format!("could not keep the level: {err}")),
    }
}

pub fn spawn(app: AppHandle) {
    let (command_tx, command_rx) = mpsc::channel::<Command>();
    app.listen(
        "backlight:command",
        move |event| match serde_json::from_str::<Command>(event.payload()) {
            Ok(command) => {
                let _ = command_tx.send(command);
            }
            Err(err) => log::warn(SRC, format!("ignored a command: {err}")),
        },
    );

    thread::spawn(move || {
        let store = store_path(&app);
        let shown = || {
            app.get_webview_window("main")
                .and_then(|w| w.is_visible().ok())
                .unwrap_or(true)
        };
        let mut attached: Option<Attached> = None;
        // The renderer's last word, kept across a change of display.
        let mut hold: Option<u32> = None;
        let mut due_at: Option<Instant> = None;
        let mut next_read = Instant::now();
        let mut last_where: Option<Where> = None;
        let mut retry_at: Option<Instant> = None;
        let mut last: Option<BacklightPayload> = None;
        let mut unavailable = BacklightPayload::unavailable(ELSEWHERE);

        loop {
            let now = Instant::now();
            let wait = due_at
                .map_or(INTERVAL, |d| d.saturating_duration_since(now))
                .min(INTERVAL);
            match command_rx.recv_timeout(wait) {
                Ok(Command::Set { level }) => {
                    if let Some(a) = attached.as_mut() {
                        a.keeper.set(percent(level));
                        if let (Some(path), Some(s)) = (&store, a.keeper.stored(&a.id)) {
                            save(path, &s);
                        }
                    }
                    due_at = Some(Instant::now() + SETTLE_SET);
                }
                Ok(Command::Hold { level }) => {
                    hold = level.map(percent);
                    if let Some(a) = attached.as_mut() {
                        a.keeper.hold(hold);
                    }
                    let soon = Instant::now() + SETTLE_HOLD;
                    due_at = Some(due_at.map_or(soon, |d| d.min(soon)));
                }
                Err(RecvTimeoutError::Timeout) => {}
                // Only if the listener is gone. Without the sleep this would spin.
                Err(RecvTimeoutError::Disconnected) => thread::sleep(INTERVAL),
            }
            let now = Instant::now();

            // Which display, if any, is Kehai's to set.
            let here = display::whereabouts();
            let retry = retry_at.is_some_and(|r| now >= r);
            if here != last_where || retry {
                retry_at = None;
                if here != last_where {
                    // A display Kehai is leaving gets yours back first.
                    if let Some(old) = attached.take() {
                        if let Some(yours) = old.keeper.yours {
                            if old.keeper.known != Some(yours) {
                                let _ = write(&old.device, yours);
                            }
                        }
                    }
                }
                match &here {
                    Some(Where::On { id, device }) => match read(device) {
                        Ok(level) => {
                            let stored = store.as_deref().and_then(load);
                            let mut keeper = Keeper::attach(
                                level,
                                stored.as_ref().filter(|s| &s.display == id),
                                shown(),
                            );
                            keeper.hold(hold);
                            log::info(SRC, format!("{device} answers, at {level}%"));
                            attached = Some(Attached {
                                id: id.clone(),
                                device: device.clone(),
                                keeper,
                                last_write: None,
                                failing: false,
                            });
                            next_read = now + INTERVAL;
                        }
                        Err(err) => {
                            if here != last_where {
                                log::info(SRC, format!("{device} doesn't answer: {err}"));
                            }
                            unavailable = BacklightPayload::unavailable(NO_ANSWER);
                            retry_at = Some(now + RETRY);
                        }
                    },
                    Some(Where::Missing) => unavailable = BacklightPayload::unavailable(MISSING),
                    Some(Where::Elsewhere) | None => {
                        unavailable = BacklightPayload::unavailable(ELSEWHERE)
                    }
                }
                last_where = here;
            }

            if let Some(a) = attached.as_mut() {
                a.keeper.show(shown());
                if due_at.is_none_or(|d| now >= d) {
                    due_at = None;
                    if let Some(level) = a.keeper.due() {
                        match write(&a.device, level) {
                            Ok(()) => {
                                a.keeper.wrote(level);
                                a.last_write = Some(now);
                                a.failing = false;
                                log::detail(SRC, || format!("set {} to {level}%", a.device));
                                if let (Some(path), Some(s)) = (&store, a.keeper.stored(&a.id)) {
                                    save(path, &s);
                                }
                            }
                            Err(err) => {
                                if !a.failing {
                                    log::warn(SRC, format!("could not set {}: {err}", a.device));
                                }
                                a.failing = true;
                            }
                        }
                    }
                }
                let settled = a
                    .last_write
                    .is_none_or(|w| now.duration_since(w) >= AFTER_WRITE);
                if now >= next_read && settled && due_at.is_none() {
                    next_read = now + INTERVAL;
                    // A display that has gone to sleep may not answer: it is
                    // asked again next time.
                    if let Ok(level) = read(&a.device) {
                        if a.keeper.observe(level) {
                            log::detail(SRC, || {
                                format!("{} set to {level}% at the display", a.device)
                            });
                            if let (Some(path), Some(s)) = (&store, a.keeper.stored(&a.id)) {
                                save(path, &s);
                            }
                        }
                    }
                }
            }
            note_give_back(attached.as_ref());

            let payload = attached
                .as_ref()
                .map_or_else(|| unavailable.clone(), |a| a.keeper.payload());
            if last.as_ref() != Some(&payload) {
                bus::publish(&app, TOPIC, SRC, payload.clone());
                last = Some(payload);
            }
        }
    });
}

/// Over the display's control line through the system's monitor
/// configuration API (dxva2), which every DDC/CI display answers. VCP code
/// 0x10 is brightness.
#[cfg(windows)]
mod platform {
    use windows::core::BOOL;
    use windows::Win32::Devices::Display::{
        DestroyPhysicalMonitors, GetNumberOfPhysicalMonitorsFromHMONITOR,
        GetPhysicalMonitorsFromHMONITOR, GetVCPFeatureAndVCPFeatureReply, SetVCPFeature,
        PHYSICAL_MONITOR,
    };
    use windows::Win32::Foundation::{LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
    };

    const BRIGHTNESS: u8 = 0x10;

    struct Search {
        device: Vec<u16>,
        found: Option<HMONITOR>,
    }

    #[allow(unsafe_code)]
    unsafe extern "system" fn visit(monitor: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
        // SAFETY: `data` is the `Search` that `find` passed in, alive for the
        // whole enumeration.
        let search = unsafe { &mut *(data.0 as *mut Search) };
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
        // SAFETY: a live local, with cbSize set to the extended form.
        let ok =
            unsafe { GetMonitorInfoW(monitor, std::ptr::addr_of_mut!(info).cast::<MONITORINFO>()) };
        if ok.as_bool() {
            let len = info.szDevice.iter().position(|&c| c == 0).unwrap_or(32);
            if info.szDevice[..len] == search.device[..] {
                search.found = Some(monitor);
                return BOOL(0);
            }
        }
        BOOL(1)
    }

    /// The physical monitors behind one display, released when dropped.
    struct Physical(Vec<PHYSICAL_MONITOR>);

    impl Drop for Physical {
        #[allow(unsafe_code)]
        fn drop(&mut self) {
            // SAFETY: handles from GetPhysicalMonitorsFromHMONITOR, released once.
            let _ = unsafe { DestroyPhysicalMonitors(&self.0) };
        }
    }

    #[allow(unsafe_code)]
    fn open(device: &str) -> Result<Physical, String> {
        let mut search = Search {
            device: device.encode_utf16().collect(),
            found: None,
        };
        // SAFETY: the callback reads `search` only during this call.
        let _ = unsafe {
            EnumDisplayMonitors(
                None,
                None,
                Some(visit),
                LPARAM(std::ptr::addr_of_mut!(search) as isize),
            )
        };
        let monitor = search.found.ok_or("the display is not connected")?;
        let mut count = 0u32;
        // SAFETY: a live out-pointer.
        unsafe { GetNumberOfPhysicalMonitorsFromHMONITOR(monitor, &mut count) }
            .map_err(|e| e.message())?;
        if count == 0 {
            return Err("no monitor behind the display".to_string());
        }
        let mut monitors = vec![PHYSICAL_MONITOR::default(); count as usize];
        // SAFETY: the array is as long as the count just asked for.
        unsafe { GetPhysicalMonitorsFromHMONITOR(monitor, &mut monitors) }
            .map_err(|e| e.message())?;
        // A handle of 0 is valid: it is the first this process opened.
        Ok(Physical(monitors))
    }

    /// The level and the display's own maximum.
    #[allow(unsafe_code)]
    fn query(physical: &Physical) -> Result<(u32, u32), String> {
        let monitor = physical.0.first().ok_or("no monitor behind the display")?;
        let (mut current, mut max) = (0u32, 0u32);
        // SAFETY: live out-pointers; the handle is open until `physical` drops.
        let ok = unsafe {
            GetVCPFeatureAndVCPFeatureReply(
                monitor.hPhysicalMonitor,
                BRIGHTNESS,
                None,
                &mut current,
                Some(&mut max),
            )
        };
        if ok == 0 || max == 0 {
            return Err("it did not answer a brightness read".to_string());
        }
        Ok((current, max))
    }

    pub fn read(device: &str) -> Result<u32, String> {
        let (current, max) = query(&open(device)?)?;
        Ok(((u64::from(current) * 100 + u64::from(max) / 2) / u64::from(max)).min(100) as u32)
    }

    #[allow(unsafe_code)]
    pub fn write(device: &str, percent: u32) -> Result<(), String> {
        let physical = open(device)?;
        let (_, max) = query(&physical)?;
        let value = (u64::from(percent.min(100)) * u64::from(max) + 50) / 100;
        let monitor = physical.0.first().ok_or("no monitor behind the display")?;
        // SAFETY: the handle is open until `physical` drops.
        let ok = unsafe { SetVCPFeature(monitor.hPhysicalMonitor, BRIGHTNESS, value as u32) };
        if ok == 0 {
            return Err("it did not take a brightness write".to_string());
        }
        Ok(())
    }
}

/// DDC/CI elsewhere goes through `/dev/i2c-*`, which needs a kernel module and
/// permissions Kehai doesn't ask for. Until it is wired, night darkens what
/// Kehai draws, as before.
#[cfg(not(windows))]
mod platform {
    const NOT_HERE: &str = "not on this system yet";

    pub fn read(_device: &str) -> Result<u32, String> {
        Err(NOT_HERE.to_string())
    }

    pub fn write(_device: &str, _percent: u32) -> Result<(), String> {
        Err(NOT_HERE.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored(yours: u32, wrote: Option<u32>) -> Stored {
        Stored {
            display: "panel".to_string(),
            yours,
            wrote,
        }
    }

    #[test]
    fn a_display_is_yours_as_it_is() {
        let k = Keeper::attach(80, None, true);
        assert_eq!(k.yours, Some(80));
        assert_eq!(k.due(), None);
    }

    #[test]
    fn a_display_left_turned_down_by_a_crash_gets_yours_back() {
        let k = Keeper::attach(18, Some(&stored(60, Some(18))), true);
        assert_eq!(k.yours, Some(60));
        assert_eq!(k.due(), Some(60));
    }

    #[test]
    fn a_display_changed_since_is_left_as_it_is() {
        // Kehai left it at 18, but it reads 40: someone has been at its buttons.
        let k = Keeper::attach(40, Some(&stored(60, Some(18))), true);
        assert_eq!(k.yours, Some(40));
        assert_eq!(k.due(), None);
    }

    #[test]
    fn night_holds_it_down_and_gives_it_back() {
        let mut k = Keeper::attach(80, None, true);
        k.hold(Some(24));
        assert_eq!(k.due(), Some(24));
        k.wrote(24);
        assert_eq!(k.due(), None);
        k.hold(None);
        assert_eq!(k.due(), Some(80));
    }

    #[test]
    fn a_hold_is_never_brighter_than_yours() {
        let mut k = Keeper::attach(30, None, true);
        k.hold(Some(48));
        assert_eq!(k.due(), None);
    }

    #[test]
    fn the_slider_sets_yours() {
        let mut k = Keeper::attach(80, None, true);
        k.set(50);
        assert_eq!(k.yours, Some(50));
        assert_eq!(k.due(), Some(50));
    }

    #[test]
    fn its_own_buttons_by_day_set_yours() {
        let mut k = Keeper::attach(80, None, true);
        assert!(k.observe(60));
        assert_eq!(k.yours, Some(60));
        assert_eq!(k.due(), None);
    }

    #[test]
    fn its_own_buttons_at_night_last_until_the_next_change() {
        let mut k = Keeper::attach(80, None, true);
        k.hold(Some(24));
        k.wrote(24);
        assert!(!k.observe(40));
        assert_eq!(k.yours, Some(80), "a night tweak is not your day");
        assert_eq!(k.due(), None, "and Kehai doesn't fight it");
        k.hold(None);
        assert_eq!(k.due(), Some(80), "morning brings yours back");
    }

    #[test]
    fn a_level_rounded_by_one_is_not_a_hand() {
        let mut k = Keeper::attach(80, None, true);
        k.hold(Some(24));
        k.wrote(24);
        assert!(!k.observe(25));
        assert!(!k.by_hand);
    }

    #[test]
    fn hidden_in_the_tray_the_display_is_yours() {
        let mut k = Keeper::attach(80, None, true);
        k.hold(Some(24));
        k.wrote(24);
        k.show(false);
        assert_eq!(k.due(), Some(80));
        k.wrote(80);
        // Changed by hand while hidden: yours.
        assert!(k.observe(70));
        k.show(true);
        assert_eq!(k.due(), Some(24));
    }

    #[test]
    fn the_store_keeps_what_a_crash_needs() {
        let mut k = Keeper::attach(80, None, true);
        k.hold(Some(24));
        k.wrote(24);
        assert_eq!(k.stored("panel"), Some(stored(80, Some(24))));
    }

    #[test]
    fn levels_from_the_renderer_are_whole_percents() {
        assert_eq!(percent(23.6), 24);
        assert_eq!(percent(-4.0), 0);
        assert_eq!(percent(140.0), 100);
        assert_eq!(percent(f64::NAN), 0);
    }

    #[test]
    fn commands_read_as_the_renderer_writes_them() {
        let read = |json: &str| serde_json::from_str::<Command>(json).expect("command parses");
        assert_eq!(
            read(r#"{"action":"set","level":60}"#),
            Command::Set { level: 60.0 }
        );
        assert_eq!(
            read(r#"{"action":"hold","level":18}"#),
            Command::Hold { level: Some(18.0) }
        );
        assert_eq!(
            read(r#"{"action":"hold","level":null}"#),
            Command::Hold { level: None }
        );
    }

    #[test]
    fn the_payload_reads_as_the_renderer_expects() {
        let mut k = Keeper::attach(80, None, true);
        k.hold(Some(24));
        k.wrote(24);
        assert_eq!(
            serde_json::to_value(k.payload()).expect("payload serialises"),
            serde_json::json!({ "available": true, "reason": null, "yours": 80, "now": 24 })
        );
    }

    /// A read of the display this PC calls DISPLAY2, run by hand at the desk:
    /// `cargo test -- --ignored reads_the_panel`. Nothing is written.
    #[cfg(windows)]
    #[test]
    #[ignore = "reads a real display; run by hand at a desk"]
    fn reads_the_panel() {
        let level = platform::read(r"\\.\DISPLAY2").expect("the panel answers");
        eprintln!("the panel is at {level}%");
        assert!(level <= 100);
    }
}
