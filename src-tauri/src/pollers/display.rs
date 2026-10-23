use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Listener, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::bus;

const TOPIC: &str = "app:displays";
const SRC: &str = "poller.display";
const STORE_FILE: &str = "display.json";
const INTERVAL: Duration = Duration::from_secs(2);
/// Ticks after Kehai moves itself before where the window sits is taken as
/// yours. A move between displays of different scale settles over a few
/// events, and reading it half-way would record a move nobody made.
const SETTLE_TICKS: u32 = 2;
/// Ticks the chosen display must be gone before Kehai leaves it. A monitor
/// that sleeps or re-trains its link vanishes for a moment and comes back.
const ABSENT_TICKS: u32 = 2;
/// Moves that did not land before Kehai stops insisting and records where the
/// window is instead. Some window systems do not let an app place itself.
const MAX_TRIES: u32 = 3;
/// The window Kehai opens on a display it does not fill, in logical pixels:
/// the panel it was designed on.
const WINDOW_W: f64 = 1280.0;
const WINDOW_H: f64 = 800.0;

/// One connected display. Mirrors `DisplayInfo` in `src/core/payloads.ts`.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
struct Display {
    /// Stable across restarts where the platform has a device path for the
    /// monitor, so a choice survives replugging it into the same port.
    id: String,
    /// As the platform numbers it, so 2 here is 2 in the system's own settings.
    number: u32,
    /// What the monitor calls itself, when it says.
    name: Option<String>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
    primary: bool,
}

/// Engine → renderer on `app:displays`. Mirrors `DisplaysPayload` in
/// `src/core/payloads.ts`. Only for the local panel: a remote panel has no
/// window to place.
#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct DisplaysPayload {
    displays: Vec<Display>,
    /// The display the window is on now.
    current: Option<String>,
    /// The display Kehai is for, which is not `current` while it is missing.
    chosen: Option<String>,
    /// Kept from when it was chosen, so a missing display can still be named.
    chosen_name: Option<String>,
    chosen_number: Option<u32>,
    missing: bool,
    fill: bool,
}

/// Renderer → engine on `display:command`. Mirrors `DisplayCommand` in
/// `src/core/payloads.ts`.
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Command {
    /// Make this the display Kehai is for and put it there now.
    Show { id: String, fill: bool },
}

/// Which display Kehai is for, as written to disk. The engine keeps it rather
/// than the renderer because it has to act on it before the window is shown,
/// and again while nothing is drawing.
#[derive(Serialize, Deserialize, Clone, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
struct Stored {
    id: Option<String>,
    name: Option<String>,
    number: Option<u32>,
    fill: bool,
}

/// What a tick found, reduced to what the decisions need.
#[derive(Clone, PartialEq, Debug)]
struct Seen {
    connected: Vec<String>,
    current: Option<String>,
    fullscreen: bool,
}

#[derive(Debug, PartialEq)]
enum Action {
    /// Put the window on this display, filling it or not.
    Show { id: String, fill: bool },
    /// The chosen display is gone: a window on the main display instead.
    Fallback,
    /// On the right display; only filling it differs.
    Fill(bool),
}

/// Keeps the window on the display it is for. Pure, so the rules can be
/// tested without a window: `observe` says what to do and the caller does it.
#[derive(Default)]
struct Keeper {
    stored: Stored,
    missing: bool,
    absent: u32,
    /// Ticks since Kehai last moved the window.
    quiet: u32,
    tries: u32,
    last: Option<Seen>,
}

impl Keeper {
    fn new(stored: Stored) -> Self {
        Self {
            stored,
            ..Self::default()
        }
    }

    fn adopt(&mut self, id: &str, found: Option<&Display>, fill: bool) {
        self.stored = Stored {
            id: Some(id.to_string()),
            name: found.and_then(|d| d.name.clone()),
            number: found.map(|d| d.number),
            fill,
        };
    }

    /// One tick. Returns what to do, and whether `stored` changed.
    fn observe(&mut self, seen: &Seen, displays: &[Display]) -> (Option<Action>, bool) {
        let first = self.last.is_none();
        let last = self.last.replace(seen.clone());
        self.quiet = self.quiet.saturating_add(1);
        let settled = self.quiet > SETTLE_TICKS;
        let before = self.stored.clone();
        let find = |id: &str| displays.iter().find(|d| d.id == id);

        let action = match self.stored.id.clone() {
            // A fresh install, or a copy from before displays could be chosen:
            // it is for the display it is on.
            None => {
                if let Some(current) = &seen.current {
                    self.adopt(current, find(current), seen.fullscreen);
                }
                None
            }
            Some(id) if !seen.connected.contains(&id) => {
                self.absent += 1;
                // At launch there is no waiting: the window may have been put
                // back filling the main display, on top of everything.
                if !self.missing && (first || self.absent >= ABSENT_TICKS) {
                    self.missing = true;
                    Some(Action::Fallback)
                } else {
                    None
                }
            }
            Some(id) => {
                self.absent = 0;
                if let Some(found) = find(&id) {
                    // The monitor may have learnt its name, or been renumbered.
                    self.stored.name = found.name.clone();
                    self.stored.number = Some(found.number);
                }
                let fill = self.stored.fill;
                if self.missing {
                    self.missing = false;
                    self.tries = 0;
                    Some(Action::Show { id, fill })
                } else if seen.current.as_deref() != Some(id.as_str()) {
                    let left_it = last
                        .as_ref()
                        .is_some_and(|l| l.current.as_deref() == Some(id.as_str()));
                    match &seen.current {
                        // It was there a tick ago and Kehai did not move it:
                        // you did, and that is the display it is for now.
                        Some(current) if settled && left_it => {
                            self.adopt(current, find(current), seen.fullscreen);
                            None
                        }
                        Some(current) if self.tries >= MAX_TRIES => {
                            self.adopt(current, find(current), seen.fullscreen);
                            None
                        }
                        _ if first || settled => {
                            self.tries += 1;
                            Some(Action::Show { id, fill })
                        }
                        _ => None,
                    }
                } else {
                    self.tries = 0;
                    if seen.fullscreen == fill {
                        None
                    } else if first {
                        Some(Action::Fill(fill))
                    } else if settled {
                        // F11, or the window controls. Kehai's own changes
                        // have landed by now, so this one is yours.
                        self.stored.fill = seen.fullscreen;
                        None
                    } else {
                        None
                    }
                }
            }
        };

        if action.is_some() {
            self.quiet = 0;
        }
        let changed = self.stored != before;
        (action, changed)
    }

    /// A choice made in setup or Settings. Returns what to do, and whether
    /// `stored` changed.
    fn show(&mut self, id: &str, fill: bool, displays: &[Display]) -> (Option<Action>, bool) {
        let before = self.stored.clone();
        let Some(found) = displays.iter().find(|d| d.id == id) else {
            // Not connected. Filling the missing display still counts once it
            // returns; anything else has nowhere to go.
            if self.stored.id.as_deref() == Some(id) {
                self.stored.fill = fill;
            }
            return (None, self.stored != before);
        };
        self.adopt(id, Some(found), fill);
        self.missing = false;
        self.absent = 0;
        self.tries = 0;
        self.quiet = 0;
        let changed = self.stored != before;
        (
            Some(Action::Show {
                id: id.to_string(),
                fill,
            }),
            changed,
        )
    }

    fn payload(&self, displays: Vec<Display>, seen: &Seen) -> DisplaysPayload {
        DisplaysPayload {
            displays,
            current: seen.current.clone(),
            chosen: self.stored.id.clone(),
            chosen_name: self.stored.name.clone(),
            chosen_number: self.stored.number,
            missing: self.missing,
            fill: self.stored.fill,
        }
    }
}

/// The trailing number of a GDI device name such as `\\.\DISPLAY2`, which is
/// the number Windows shows in its own display settings.
fn gdi_number(name: &str) -> Option<u32> {
    let digits: String = name
        .chars()
        .rev()
        .take_while(char::is_ascii_digit)
        .collect();
    if digits.is_empty() {
        return None;
    }
    digits.chars().rev().collect::<String>().parse().ok()
}

fn same_monitor(a: &Monitor, b: &Monitor) -> bool {
    a.name() == b.name() && a.position() == b.position()
}

/// Every connected display, numbered and named, beside the monitor it is.
fn describe(window: &WebviewWindow) -> Vec<(Display, Monitor)> {
    let monitors = window.available_monitors().unwrap_or_default();
    let primary = window.primary_monitor().ok().flatten();
    let names = platform::names();

    // Without a number from the platform, left to right and then top to bottom.
    let mut order: Vec<usize> = (0..monitors.len()).collect();
    order.sort_by_key(|&i| (monitors[i].position().x, monitors[i].position().y));

    monitors
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let system = m.name().cloned().unwrap_or_default();
            let named = names.get(&system);
            let ordinal = order.iter().position(|&o| o == i).unwrap_or(i) as u32 + 1;
            let display = Display {
                id: named
                    .and_then(|n| n.path.clone())
                    .or_else(|| (!system.is_empty()).then(|| system.clone()))
                    .unwrap_or_else(|| format!("{},{}", m.position().x, m.position().y)),
                number: gdi_number(&system).unwrap_or(ordinal),
                name: named.and_then(|n| n.friendly.clone()),
                x: m.position().x,
                y: m.position().y,
                width: m.size().width,
                height: m.size().height,
                scale: m.scale_factor(),
                primary: primary.as_ref().is_some_and(|p| same_monitor(p, m)),
            };
            (display, m.clone())
        })
        .collect()
}

fn look(window: &WebviewWindow, found: &[(Display, Monitor)]) -> Seen {
    let on = window.current_monitor().ok().flatten();
    Seen {
        connected: found.iter().map(|(d, _)| d.id.clone()).collect(),
        current: on.and_then(|on| {
            found
                .iter()
                .find(|(_, m)| same_monitor(m, &on))
                .map(|(d, _)| d.id.clone())
        }),
        fullscreen: window.is_fullscreen().unwrap_or(false),
    }
}

/// A window of the size Kehai was designed at, centred in what the display
/// leaves free of taskbars, and no bigger than most of it.
fn window_rect(monitor: &Monitor) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let width = ((WINDOW_W * scale) as u32).min(area.size.width * 9 / 10);
    let height = ((WINDOW_H * scale) as u32).min(area.size.height * 9 / 10);
    let x = area.position.x + ((area.size.width - width) / 2) as i32;
    let y = area.position.y + ((area.size.height - height) / 2) as i32;
    (
        PhysicalPosition::new(x, y),
        PhysicalSize::new(width, height),
    )
}

fn place(window: &WebviewWindow, monitor: &Monitor, fill: bool) {
    // A fullscreen or maximised window ignores being moved.
    if window.is_fullscreen().unwrap_or(false) {
        let _ = window.set_fullscreen(false);
    }
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    }
    // Moved first and sized after, so a display of another scale cannot
    // rescale the size on the way in.
    let (position, size) = window_rect(monitor);
    let _ = window.set_position(position);
    let _ = window.set_size(size);
    if fill {
        let at = monitor.position();
        let span = monitor.size();
        let _ = window.set_fullscreen_on_monitor(PhysicalPosition::new(
            f64::from(at.x) + f64::from(span.width) / 2.0,
            f64::from(at.y) + f64::from(span.height) / 2.0,
        ));
    }
}

fn act(window: &WebviewWindow, action: &Action, found: &[(Display, Monitor)]) {
    match action {
        Action::Show { id, fill } => {
            if let Some((_, monitor)) = found.iter().find(|(d, _)| &d.id == id) {
                eprintln!("poller.display: showing on {id}, fill {fill}");
                place(window, monitor, *fill);
            }
        }
        Action::Fallback => {
            let main = found.iter().find(|(d, _)| d.primary).or(found.first());
            if let Some((display, monitor)) = main {
                eprintln!(
                    "poller.display: display missing, showing on {} in a window",
                    display.id
                );
                place(window, monitor, false);
            }
        }
        Action::Fill(fill) => {
            let _ = window.set_fullscreen(*fill);
        }
    }
}

fn store_path(app: &AppHandle) -> Option<PathBuf> {
    match app.path().app_data_dir() {
        Ok(dir) => Some(dir.join(STORE_FILE)),
        Err(err) => {
            eprintln!("poller.display: no app data folder, the display choice will not survive a restart: {err}");
            None
        }
    }
}

fn load(path: &Path) -> Option<Stored> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Written beside itself and renamed into place, so a crash mid-write leaves
/// the last choice rather than half of this one.
fn save(path: &Path, stored: &Stored) {
    let Ok(text) = serde_json::to_string(stored) else {
        return;
    };
    let tmp = path.with_extension("json.tmp");
    let result = path
        .parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|()| fs::write(&tmp, text))
        .and_then(|()| fs::rename(&tmp, path));
    if let Err(err) = result {
        eprintln!("poller.display: could not save the display choice: {err}");
    }
}

/// Runs the first tick on the calling thread, before the window is shown, so
/// a display that has gone never sees Kehai open filling the main one. Call
/// it from setup, ahead of `show`.
pub fn spawn(app: AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("poller.display: no main window to place");
        return;
    };
    let store = store_path(&app);
    let mut keeper = Keeper::new(store.as_deref().and_then(load).unwrap_or_default());

    let tick = move |keeper: &mut Keeper, command: Option<Command>| -> DisplaysPayload {
        let found = describe(&window);
        let displays: Vec<Display> = found.iter().map(|(d, _)| d.clone()).collect();
        let (action, changed) = match command {
            Some(Command::Show { id, fill }) => keeper.show(&id, fill, &displays),
            // A moment with no displays at all is the system rearranging
            // them, not a choice to act on.
            None if found.is_empty() => (None, false),
            None => keeper.observe(&look(&window, &found), &displays),
        };
        if let Some(action) = &action {
            act(&window, action, &found);
        }
        if changed {
            if let Some(path) = &store {
                save(path, &keeper.stored);
            }
        }
        keeper.payload(displays, &look(&window, &found))
    };

    let mut last = tick(&mut keeper, None);
    bus::publish(&app, TOPIC, SRC, last.clone());

    let (command_tx, command_rx) = mpsc::channel::<Command>();
    app.listen("display:command", move |event| {
        match serde_json::from_str::<Command>(event.payload()) {
            Ok(command) => {
                let _ = command_tx.send(command);
            }
            Err(err) => eprintln!("poller.display: ignored a command: {err}"),
        }
    });

    thread::spawn(move || loop {
        let command = match command_rx.recv_timeout(INTERVAL) {
            Ok(command) => Some(command),
            Err(RecvTimeoutError::Timeout) => None,
            // Only if the listener is gone. Without the sleep this would spin.
            Err(RecvTimeoutError::Disconnected) => {
                thread::sleep(INTERVAL);
                None
            }
        };
        let payload = tick(&mut keeper, command);
        if payload != last {
            bus::publish(&app, TOPIC, SRC, payload.clone());
            last = payload;
        }
    });
}

/// What Windows calls each display, keyed by GDI device name (`\\.\DISPLAY1`),
/// which is the name the window system gives each monitor.
#[cfg(windows)]
mod platform {
    use std::collections::HashMap;

    use windows::Win32::Devices::Display::{
        DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig,
        DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
        DISPLAYCONFIG_DEVICE_INFO_HEADER, DISPLAYCONFIG_MODE_INFO,
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL, DISPLAYCONFIG_PATH_INFO,
        DISPLAYCONFIG_SOURCE_DEVICE_NAME, DISPLAYCONFIG_TARGET_DEVICE_NAME, QDC_ONLY_ACTIVE_PATHS,
    };
    use windows::Win32::Foundation::ERROR_SUCCESS;

    pub struct Named {
        /// From the monitor's own description of itself, such as `DELL P2419H`.
        pub friendly: Option<String>,
        /// Stays the same for one monitor on one port, across restarts.
        pub path: Option<String>,
    }

    fn text(buf: &[u16]) -> Option<String> {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        let s = String::from_utf16_lossy(&buf[..end]);
        let s = s.trim();
        (!s.is_empty()).then(|| s.to_string())
    }

    #[allow(unsafe_code)]
    pub fn names() -> HashMap<String, Named> {
        let mut out = HashMap::new();
        let mut path_count = 0u32;
        let mut mode_count = 0u32;
        // SAFETY: both pointers are to live locals the call fills in.
        let sized = unsafe {
            GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count)
        };
        if sized != ERROR_SUCCESS {
            return out;
        }
        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];
        // SAFETY: the buffers hold the counts passed with them, which the call
        // lowers to what it wrote.
        let queried = unsafe {
            QueryDisplayConfig(
                QDC_ONLY_ACTIVE_PATHS,
                &mut path_count,
                paths.as_mut_ptr(),
                &mut mode_count,
                modes.as_mut_ptr(),
                None,
            )
        };
        if queried != ERROR_SUCCESS {
            return out;
        }
        paths.truncate(path_count as usize);

        for path in &paths {
            let mut source = DISPLAYCONFIG_SOURCE_DEVICE_NAME {
                header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
                    r#type: DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
                    size: size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32,
                    adapterId: path.sourceInfo.adapterId,
                    id: path.sourceInfo.id,
                },
                ..Default::default()
            };
            // SAFETY: the header leads the struct it describes, and its size
            // field says how far the call may write.
            if unsafe { DisplayConfigGetDeviceInfo(std::ptr::addr_of_mut!(source).cast()) } != 0 {
                continue;
            }
            let Some(gdi) = text(&source.viewGdiDeviceName) else {
                continue;
            };

            let mut target = DISPLAYCONFIG_TARGET_DEVICE_NAME {
                header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
                    r#type: DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
                    size: size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>() as u32,
                    adapterId: path.targetInfo.adapterId,
                    id: path.targetInfo.id,
                },
                ..Default::default()
            };
            // SAFETY: as above.
            let named = if unsafe {
                DisplayConfigGetDeviceInfo(std::ptr::addr_of_mut!(target).cast())
            } == 0
            {
                // A laptop's own panel usually has no name of its own.
                let internal = target.outputTechnology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL;
                Named {
                    friendly: text(&target.monitorFriendlyDeviceName)
                        .or_else(|| internal.then(|| "Built-in display".to_string())),
                    path: text(&target.monitorDevicePath),
                }
            } else {
                Named {
                    friendly: None,
                    path: None,
                }
            };
            // A duplicated display is two monitors on one source; the first
            // one names it.
            out.entry(gdi).or_insert(named);
        }
        out
    }
}

/// Elsewhere the window system's own name for a monitor, such as `DP-1`, is
/// both its id and the closest thing it has to a name.
#[cfg(not(windows))]
mod platform {
    use std::collections::HashMap;

    pub struct Named {
        pub friendly: Option<String>,
        pub path: Option<String>,
    }

    pub fn names() -> HashMap<String, Named> {
        HashMap::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display(id: &str, number: u32, primary: bool) -> Display {
        Display {
            id: id.to_string(),
            number,
            name: Some(format!("{id} MONITOR")),
            x: 0,
            y: 0,
            width: 1280,
            height: 800,
            scale: 1.0,
            primary,
        }
    }

    fn desk() -> Vec<Display> {
        vec![display("main", 1, true), display("panel", 2, false)]
    }

    fn seen(connected: &[&str], current: Option<&str>, fullscreen: bool) -> Seen {
        Seen {
            connected: connected.iter().map(|s| s.to_string()).collect(),
            current: current.map(str::to_string),
            fullscreen,
        }
    }

    fn chosen(id: &str, fill: bool) -> Keeper {
        Keeper::new(Stored {
            id: Some(id.to_string()),
            name: None,
            number: None,
            fill,
        })
    }

    #[test]
    fn reads_the_number_windows_shows() {
        assert_eq!(gdi_number(r"\\.\DISPLAY2"), Some(2));
        assert_eq!(gdi_number(r"\\.\DISPLAY12"), Some(12));
        assert_eq!(gdi_number("DP-1"), Some(1));
        assert_eq!(gdi_number("eDP"), None);
    }

    #[test]
    fn a_fresh_install_is_for_the_display_it_opened_on() {
        let mut keeper = Keeper::default();
        let (action, changed) =
            keeper.observe(&seen(&["main", "panel"], Some("main"), false), &desk());
        assert_eq!(action, None);
        assert!(changed);
        assert_eq!(keeper.stored.id.as_deref(), Some("main"));
        assert_eq!(keeper.stored.number, Some(1));
        assert!(!keeper.stored.fill);
    }

    #[test]
    fn a_missing_display_at_launch_falls_back_at_once() {
        let mut keeper = chosen("panel", true);
        let (action, _) = keeper.observe(
            &seen(&["main"], Some("main"), true),
            &[display("main", 1, true)],
        );
        assert_eq!(action, Some(Action::Fallback));
        assert!(keeper.missing);
        // The choice is kept for when it comes back.
        assert_eq!(keeper.stored.id.as_deref(), Some("panel"));
    }

    #[test]
    fn a_display_that_blinks_out_is_waited_for() {
        let mut keeper = chosen("panel", true);
        keeper.observe(&seen(&["main", "panel"], Some("panel"), true), &desk());
        let (action, _) = keeper.observe(&seen(&["main"], Some("main"), false), &desk()[..1]);
        assert_eq!(action, None);
        let (action, _) = keeper.observe(&seen(&["main", "panel"], Some("panel"), true), &desk());
        assert_eq!(action, None);
        assert!(!keeper.missing);
    }

    #[test]
    fn goes_back_when_the_display_returns() {
        let mut keeper = chosen("panel", true);
        keeper.observe(&seen(&["main"], Some("main"), false), &desk()[..1]);
        let (action, _) = keeper.observe(&seen(&["main", "panel"], Some("main"), false), &desk());
        assert_eq!(
            action,
            Some(Action::Show {
                id: "panel".into(),
                fill: true
            })
        );
        assert!(!keeper.missing);
    }

    #[test]
    fn launching_elsewhere_moves_back_rather_than_adopting() {
        // The last session ended in a window on the main display while the
        // panel was away; the window-state plugin put it back there.
        let mut keeper = chosen("panel", true);
        let (action, _) = keeper.observe(&seen(&["main", "panel"], Some("main"), false), &desk());
        assert_eq!(
            action,
            Some(Action::Show {
                id: "panel".into(),
                fill: true
            })
        );
        assert_eq!(keeper.stored.id.as_deref(), Some("panel"));
    }

    #[test]
    fn dragging_it_to_another_display_chooses_that_one() {
        let mut keeper = chosen("panel", false);
        for _ in 0..4 {
            keeper.observe(&seen(&["main", "panel"], Some("panel"), false), &desk());
        }
        let (action, changed) =
            keeper.observe(&seen(&["main", "panel"], Some("main"), false), &desk());
        assert_eq!(action, None);
        assert!(changed);
        assert_eq!(keeper.stored.id.as_deref(), Some("main"));
    }

    #[test]
    fn its_own_move_is_not_taken_for_yours() {
        let mut keeper = chosen("main", false);
        keeper.observe(&seen(&["main", "panel"], Some("main"), false), &desk());
        keeper.show("panel", true, &desk());
        // A tick before the move has landed: the window still reads as on main.
        let (action, changed) =
            keeper.observe(&seen(&["main", "panel"], Some("main"), false), &desk());
        assert_eq!(action, None);
        assert!(!changed);
        assert_eq!(keeper.stored.id.as_deref(), Some("panel"));
    }

    #[test]
    fn stops_insisting_when_the_window_will_not_move() {
        let mut keeper = chosen("panel", false);
        let mut shows = 0;
        for _ in 0..20 {
            let (action, _) =
                keeper.observe(&seen(&["main", "panel"], Some("main"), false), &desk());
            if matches!(action, Some(Action::Show { .. })) {
                shows += 1;
            }
        }
        assert_eq!(shows, MAX_TRIES);
        assert_eq!(keeper.stored.id.as_deref(), Some("main"));
    }

    #[test]
    fn f11_on_the_chosen_display_is_kept() {
        let mut keeper = chosen("panel", true);
        for _ in 0..4 {
            keeper.observe(&seen(&["main", "panel"], Some("panel"), true), &desk());
        }
        let (action, changed) =
            keeper.observe(&seen(&["main", "panel"], Some("panel"), false), &desk());
        assert_eq!(action, None);
        assert!(changed);
        assert!(!keeper.stored.fill);
    }

    #[test]
    fn launching_windowed_fills_if_it_should() {
        let mut keeper = chosen("panel", true);
        let (action, _) = keeper.observe(&seen(&["main", "panel"], Some("panel"), false), &desk());
        assert_eq!(action, Some(Action::Fill(true)));
    }

    #[test]
    fn choosing_a_missing_display_keeps_only_the_fill() {
        let mut keeper = chosen("panel", true);
        keeper.observe(&seen(&["main"], Some("main"), false), &desk()[..1]);
        let (action, changed) = keeper.show("panel", false, &desk()[..1]);
        assert_eq!(action, None);
        assert!(changed);
        assert!(!keeper.stored.fill);
        assert!(keeper.missing);
    }
}
