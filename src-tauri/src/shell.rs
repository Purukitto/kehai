//! Where Kehai sits on this PC: an icon in the tray, as a wallpaper app's is,
//! with no taskbar button and out of Alt+Tab unless asked for, and a panel
//! that hides rather than closes.
//!
//! Hiding keeps everything running, remote panels included. The remote server
//! takes its switch from the panel's settings, so the window is never
//! destroyed while Kehai runs: it is hidden, and Quit in the tray's menu is
//! the way out.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::thread;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Listener, Manager, WebviewWindow, Wry};

use crate::{bus, log};

const TOPIC: &str = "app:window";
const SRC: &str = "shell";
const STORE_FILE: &str = "window.json";

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
#[serde(rename_all = "snake_case")]
enum Start {
    /// Shows the panel, as Kehai always has.
    #[default]
    Panel,
    /// Only the tray: for a desk where a tablet is the panel.
    Tray,
}

/// How Kehai sits in Windows, as written to disk. The engine keeps it rather
/// than the renderer because both apply before the window is first shown.
/// No file means no taskbar button: every copy, installed before this or not.
#[derive(Serialize, Deserialize, Clone, Copy, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase", default)]
struct Stored {
    taskbar: bool,
    start: Start,
}

/// Engine → local renderer on `app:window`. Mirrors `WindowPayload` in
/// `src/core/payloads.ts`. A remote panel has no window here to speak of.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WindowPayload {
    taskbar: bool,
    start: Start,
    /// False where the desktop has no tray: then there is a taskbar button
    /// whatever the setting says, and closing quits.
    tray: bool,
}

/// Renderer → engine on `window:command`. Mirrors `WindowCommand` in
/// `src/core/payloads.ts`.
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Command {
    Hide,
    Quit,
    SetTaskbar { on: bool },
    SetStart { start: Start },
}

/// What the tray shows, gathered from the bus.
#[derive(Clone, Default, PartialEq)]
struct View {
    visible: bool,
    /// Agents waiting on you, or stopped by an error.
    waiting: usize,
    clients: usize,
    /// Each display's id, its name for the tooltip, and its row in Move to.
    displays: Vec<(String, String, String)>,
    current: Option<String>,
    fill: bool,
    update: Update,
}

#[derive(Clone, Default, PartialEq)]
enum Update {
    #[default]
    Check,
    Checking,
    Install(String),
    Installing(String),
}

struct Shell {
    tray: Option<TrayIcon<Wry>>,
    toggle: MenuItem<Wry>,
    move_to: Submenu<Wry>,
    updates: MenuItem<Wry>,
    stored: Mutex<Stored>,
    store: Option<PathBuf>,
    view: Mutex<View>,
    /// What the tray last showed, so an unchanged view costs nothing.
    shown: Mutex<Option<View>>,
}

static SHELL: OnceLock<Shell> = OnceLock::new();

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn load(path: &Path) -> Option<Stored> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

/// Written beside itself and renamed into place, as the display choice is.
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
        log::problem(
            SRC,
            "Could not save how Kehai sits in Windows.",
            Some("It is back to no taskbar button after a restart."),
            err,
        );
    }
}

// ------------------------------------------------------------------ the icon

const AMBER: [f64; 3] = [240.0, 168.0, 60.0];
const DARK: [f64; 3] = [13.0, 12.0, 10.0];

/// Kehai's diamond on its dark square, drawn at tray size rather than scaled
/// down from the app icon, and filled while an agent waits on you.
fn icon(filled: bool) -> Image<'static> {
    const N: usize = 32;
    const SS: usize = 4;
    const RADIUS: f64 = 10.8;
    // Half a 3 px stroke, measured across the edge: a diamond's edges run at
    // 45°, so along the axes that is √2 as far.
    const BAND: f64 = 1.5 * std::f64::consts::SQRT_2;
    const CORNER: f64 = 3.0;
    let c = N as f64 / 2.0;
    let mut rgba = Vec::with_capacity(N * N * 4);
    for y in 0..N {
        for x in 0..N {
            let (mut square, mut diamond) = (0.0, 0.0);
            for sy in 0..SS {
                for sx in 0..SS {
                    let px = x as f64 + (sx as f64 + 0.5) / SS as f64;
                    let py = y as f64 + (sy as f64 + 0.5) / SS as f64;
                    // Distance into a rounded corner, if this sample is in one.
                    let dx = (CORNER - px).max(px - (N as f64 - CORNER)).max(0.0);
                    let dy = (CORNER - py).max(py - (N as f64 - CORNER)).max(0.0);
                    if dx * dx + dy * dy > CORNER * CORNER {
                        continue;
                    }
                    square += 1.0;
                    let d = (px - c).abs() + (py - c).abs();
                    if (filled && d <= RADIUS + BAND) || (d - RADIUS).abs() <= BAND {
                        diamond += 1.0;
                    }
                }
            }
            let samples = (SS * SS) as f64;
            let (a, f) = (square / samples, diamond / samples);
            for i in 0..3 {
                let v = if a > 0.0 {
                    (DARK[i] * (a - f) + AMBER[i] * f) / a
                } else {
                    0.0
                };
                rgba.push(v.round() as u8);
            }
            rgba.push((a * 255.0).round() as u8);
        }
    }
    Image::new_owned(rgba, N as u32, N as u32)
}

// ------------------------------------------------------------------ the window

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn has_tray() -> bool {
    SHELL.get().is_some_and(|s| s.tray.is_some())
}

/// Whether closing the panel should only hide it: wherever there is a tray to
/// bring it back from.
pub fn hides_on_close() -> bool {
    has_tray()
}

fn set_visible(app: &AppHandle, visible: bool) {
    if let Some(shell) = SHELL.get() {
        lock(&shell.view).visible = visible;
        refresh(app, shell);
    }
}

/// Shows the panel and brings it to the front: from the tray, from a second
/// launch, or at start.
pub fn show(app: &AppHandle) {
    let Some(window) = window(app) else { return };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    set_visible(app, true);
}

pub fn hide(app: &AppHandle) {
    let Some(window) = window(app) else { return };
    if !has_tray() {
        // Nothing would bring it back.
        app.exit(0);
        return;
    }
    let _ = window.hide();
    set_visible(app, false);
}

/// A click on the icon. A panel behind other windows comes to the front
/// rather than hiding: the click was to see it.
fn toggle(app: &AppHandle) {
    let Some(window) = window(app) else { return };
    let shown = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false);
    if shown && !platform::covered(&window) {
        hide(app);
    } else {
        show(app);
    }
}

/// On the main thread: the window's style belongs to the thread that owns it.
fn apply_taskbar(app: &AppHandle, on: bool) {
    let Some(window) = window(app) else { return };
    let _ = app.run_on_main_thread(move || {
        platform::set_taskbar(&window, on);
        let _ = window.set_skip_taskbar(!on);
    });
}

fn payload(stored: &Stored) -> WindowPayload {
    let tray = has_tray();
    WindowPayload {
        taskbar: stored.taskbar || !tray,
        start: stored.start,
        tray,
    }
}

fn command(app: &AppHandle, command: Command) {
    let Some(shell) = SHELL.get() else { return };
    match command {
        Command::Hide => hide(app),
        Command::Quit => app.exit(0),
        Command::SetTaskbar { on } => {
            let stored = {
                let mut stored = lock(&shell.stored);
                stored.taskbar = on;
                *stored
            };
            if shell.tray.is_some() {
                apply_taskbar(app, on);
            }
            if let Some(path) = &shell.store {
                save(path, &stored);
            }
            log::info(
                SRC,
                format!("taskbar button {}", if on { "on" } else { "off" }),
            );
            bus::publish(app, TOPIC, SRC, payload(&stored));
        }
        Command::SetStart { start } => {
            let stored = {
                let mut stored = lock(&shell.stored);
                stored.start = start;
                *stored
            };
            if let Some(path) = &shell.store {
                save(path, &stored);
            }
            bus::publish(app, TOPIC, SRC, payload(&stored));
        }
    }
}

// -------------------------------------------------------------------- the tray

fn menu_event(app: &AppHandle, id: &str) {
    match id {
        "toggle" => toggle(app),
        "settings" => {
            show(app);
            let _ = app.emit("shell:open", "settings");
        }
        "report" => log::report_bug(app),
        "log" => log::open_log_folder(app),
        "updates" => {
            let update = SHELL.get().map(|s| lock(&s.view).update.clone());
            let action = match update {
                Some(Update::Install(_)) => "install",
                Some(Update::Check) => "check",
                _ => return,
            };
            // The same command the panel's own buttons send.
            let _ = app.emit("update:command", json!({ "action": action }));
        }
        "quit" => app.exit(0),
        _ => {
            if let Some(display) = id.strip_prefix("move:") {
                let fill = SHELL.get().is_some_and(|s| lock(&s.view).fill);
                show(app);
                let _ = app.emit(
                    "display:command",
                    json!({ "action": "show", "id": display, "fill": fill }),
                );
            }
        }
    }
}

fn tooltip(view: &View) -> String {
    let mut parts = vec!["Kehai".to_string()];
    match view.waiting {
        0 if !view.visible => parts.push("panel hidden".into()),
        0 => {
            let on = view
                .current
                .as_ref()
                .and_then(|id| view.displays.iter().find(|(d, _, _)| d == id));
            if let Some((_, name, _)) = on {
                parts.push(format!("on {name}"));
            }
        }
        1 => parts.push("an agent is waiting".into()),
        n => parts.push(format!("{n} agents are waiting")),
    }
    match view.clients {
        0 => {}
        1 => parts.push("1 remote panel".into()),
        n => parts.push(format!("{n} remote panels")),
    }
    parts.join(" · ")
}

/// Brings the icon, its hover text and its menu up to date with the view.
fn refresh(app: &AppHandle, shell: &Shell) {
    let view = lock(&shell.view).clone();
    let before = {
        let mut shown = lock(&shell.shown);
        if shown.as_ref() == Some(&view) {
            return;
        }
        shown.replace(view.clone())
    };

    if let Some(tray) = &shell.tray {
        let _ = tray.set_tooltip(Some(tooltip(&view)));
        let was_waiting = before.as_ref().map(|b| b.waiting > 0);
        if was_waiting != Some(view.waiting > 0) {
            let _ = tray.set_icon(Some(icon(view.waiting > 0)));
        }
    }
    let _ = shell.toggle.set_text(if view.visible {
        "Hide the panel"
    } else {
        "Show the panel"
    });

    let (label, enabled) = match &view.update {
        Update::Check => ("Check for updates".to_string(), true),
        Update::Checking => ("Checking for updates…".to_string(), false),
        Update::Install(v) => (format!("Install {v}"), true),
        Update::Installing(v) => (format!("Installing {v}…"), false),
    };
    let _ = shell.updates.set_text(label);
    let _ = shell.updates.set_enabled(enabled);

    let moved = before
        .as_ref()
        .is_none_or(|b| b.displays != view.displays || b.current != view.current);
    if moved {
        if let Ok(items) = shell.move_to.items() {
            for item in items {
                let _ = shell.move_to.remove(&item);
            }
        }
        for (id, _, row) in &view.displays {
            let here = view.current.as_ref() == Some(id);
            if let Ok(item) =
                CheckMenuItem::with_id(app, format!("move:{id}"), row, true, here, None::<&str>)
            {
                let _ = shell.move_to.append(&item);
            }
        }
        let _ = shell.move_to.set_enabled(!view.displays.is_empty());
    }
}

/// Takes in one envelope from the bus. True when the tray has something new
/// to show.
fn observe(view: &mut View, envelope: &Value) -> bool {
    let data = &envelope["data"];
    let before = view.clone();
    match envelope["topic"].as_str() {
        Some("dev:agents") => {
            view.waiting = data["sessions"]
                .as_array()
                .filter(|_| data["available"].as_bool() == Some(true))
                .map_or(0, |sessions| {
                    sessions
                        .iter()
                        .filter(|s| matches!(s["state"].as_str(), Some("waiting" | "error")))
                        .count()
                });
        }
        Some("app:remote") => {
            view.clients = data["clients"].as_u64().unwrap_or(0) as usize;
        }
        Some("app:displays") => {
            view.displays = data["displays"]
                .as_array()
                .map(|all| {
                    all.iter()
                        .map(|d| {
                            let id = d["id"].as_str().unwrap_or_default().to_string();
                            let name =
                                d["name"].as_str().map(str::to_string).unwrap_or_else(|| {
                                    format!("Display {}", d["number"].as_u64().unwrap_or(0))
                                });
                            let main = if d["primary"].as_bool() == Some(true) {
                                " · main"
                            } else {
                                ""
                            };
                            let row = format!(
                                "{name} · {} × {}{main}",
                                d["width"].as_u64().unwrap_or(0),
                                d["height"].as_u64().unwrap_or(0)
                            );
                            (id, name, row)
                        })
                        .collect()
                })
                .unwrap_or_default();
            view.current = data["current"].as_str().map(str::to_string);
            view.fill = data["fill"].as_bool().unwrap_or(false);
        }
        Some("app:update") => {
            let latest = data["latest"].as_str().unwrap_or_default().to_string();
            let installable = data["installable"].as_bool() == Some(true);
            view.update = match data["state"].as_str() {
                Some("checking") => Update::Checking,
                Some("available") if installable => Update::Install(latest),
                Some("downloading" | "installing") => Update::Installing(latest),
                _ => Update::Check,
            };
        }
        _ => {}
    }
    *view != before
}

/// Follows the bus for as long as Kehai runs: agents waiting, displays,
/// remote panels and updates all show in the tray.
fn watch(app: AppHandle) {
    thread::spawn(move || loop {
        let (retained, rx) = bus::tap();
        let Some(shell) = SHELL.get() else { return };
        let mut changed = false;
        {
            let mut view = lock(&shell.view);
            for envelope in &retained {
                changed |= observe(&mut view, envelope);
            }
        }
        if changed {
            refresh(&app, shell);
        }
        // Ends only if the bus cut this tap off for falling behind; then it
        // starts again from the retained values.
        while let Ok(envelope) = rx.recv() {
            let changed = observe(&mut lock(&shell.view), &envelope);
            if changed {
                refresh(&app, shell);
            }
        }
    });
}

fn build_tray(app: &AppHandle, menu: &Menu<Wry>) -> tauri::Result<TrayIcon<Wry>> {
    TrayIconBuilder::with_id("kehai")
        .icon(icon(false))
        .tooltip("Kehai")
        .menu(menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle(tray.app_handle());
            }
        })
        .build(app)
}

/// Puts the icon in the tray and sets the window up to sit there. Returns
/// whether to show the panel now. Call from setup, on the main thread, before
/// the window is first shown, so it never flashes a taskbar button.
pub fn setup(app: &AppHandle) -> bool {
    let store = app.path().app_data_dir().ok().map(|d| d.join(STORE_FILE));
    let stored = store.as_deref().and_then(load).unwrap_or_default();

    let built = (|| -> tauri::Result<_> {
        let toggle = MenuItem::with_id(app, "toggle", "Hide the panel", true, None::<&str>)?;
        let move_to = Submenu::with_id(app, "move", "Move to", true)?;
        let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
        let report = MenuItem::with_id(app, "report", "Report a bug", true, None::<&str>)?;
        let log_folder = MenuItem::with_id(app, "log", "Open the log folder", true, None::<&str>)?;
        let updates = MenuItem::with_id(app, "updates", "Check for updates", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit Kehai", true, None::<&str>)?;
        let menu = Menu::with_items(
            app,
            &[
                &toggle,
                &move_to,
                &settings,
                &PredefinedMenuItem::separator(app)?,
                &report,
                &log_folder,
                &PredefinedMenuItem::separator(app)?,
                &updates,
                &PredefinedMenuItem::separator(app)?,
                &quit,
            ],
        )?;
        Ok((toggle, move_to, updates, menu))
    })();
    let Ok((toggle, move_to, updates, menu)) = built else {
        log::error(SRC, "the tray menu could not be made");
        return true;
    };

    let tray = match build_tray(app, &menu) {
        Ok(tray) => Some(tray),
        Err(err) => {
            log::problem(
                SRC,
                "This desktop has no tray for Kehai's icon.",
                Some("Kehai keeps its taskbar button, and closing it quits."),
                err,
            );
            None
        }
    };
    let tray_ok = tray.is_some();

    let _ = SHELL.set(Shell {
        tray,
        toggle,
        move_to,
        updates,
        stored: Mutex::new(stored),
        store,
        view: Mutex::new(View::default()),
        shown: Mutex::new(None),
    });

    if tray_ok {
        if let Some(window) = window(app) {
            platform::hold(&window);
            platform::set_taskbar(&window, stored.taskbar);
            let _ = window.set_skip_taskbar(!stored.taskbar);
        }
    }

    let commands = app.clone();
    app.listen("window:command", move |event| {
        match serde_json::from_str::<Command>(event.payload()) {
            Ok(c) => command(&commands, c),
            Err(err) => log::warn(SRC, format!("ignored a command: {err}")),
        }
    });

    bus::publish(app, TOPIC, SRC, payload(&stored));
    watch(app.clone());

    let show = stored.start == Start::Panel || !tray_ok;
    log::info(
        SRC,
        format!(
            "{}, taskbar button {}, starting {}",
            if tray_ok { "in the tray" } else { "no tray" },
            if stored.taskbar || !tray_ok {
                "on"
            } else {
                "off"
            },
            if show {
                "with the panel"
            } else {
                "in the tray only"
            }
        ),
    );
    if let Some(shell) = SHELL.get() {
        lock(&shell.view).visible = show;
        refresh(app, shell);
    }
    show
}

/// Windows decides a taskbar button and a place in Alt+Tab from the window's
/// extended style: a tool window has neither. The window library rewrites
/// that style whenever it shows, hides or resizes the window, so a hook on
/// the window keeps the tool style in place while the button is off, rather
/// than putting it back after each change and letting the button flash.
#[cfg(windows)]
mod platform {
    use std::sync::atomic::{AtomicBool, Ordering};

    use tauri::WebviewWindow;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetWindowLongPtrW, SetWindowLongPtrW, WindowFromPoint, GA_ROOT, GWL_EXSTYLE,
        STYLESTRUCT, WM_STYLECHANGING, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
    };

    use crate::log;

    /// Whether the window is kept a tool window: the taskbar button is off.
    static TOOL: AtomicBool = AtomicBool::new(false);

    fn hwnd(window: &WebviewWindow) -> Option<HWND> {
        // Tauri's handle comes from a newer release of the same bindings; the
        // pointer inside is the same.
        window.hwnd().ok().map(|h| HWND(h.0))
    }

    fn styled(style: u32, tool: bool) -> u32 {
        if tool {
            (style | WS_EX_TOOLWINDOW.0) & !WS_EX_APPWINDOW.0
        } else {
            (style & !WS_EX_TOOLWINDOW.0) | WS_EX_APPWINDOW.0
        }
    }

    #[allow(unsafe_code)]
    unsafe extern "system" fn keep_style(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        if msg == WM_STYLECHANGING
            && wparam.0 as i32 == GWL_EXSTYLE.0
            && TOOL.load(Ordering::Relaxed)
        {
            // SAFETY: for WM_STYLECHANGING, lparam points at the style change
            // being made, which the system lets the window adjust before it lands.
            let change = unsafe { &mut *(lparam.0 as *mut STYLESTRUCT) };
            change.styleNew = styled(change.styleNew, true);
        }
        // SAFETY: passes the message on to the window's own procedure.
        unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
    }

    /// Hooks the window. On the thread that owns it, which setup runs on.
    #[allow(unsafe_code)]
    pub fn hold(window: &WebviewWindow) {
        let Some(hwnd) = hwnd(window) else { return };
        // SAFETY: a live window of this process, subclassed from its own
        // thread, with a procedure that lives as long as the program.
        let held = unsafe { SetWindowSubclass(hwnd, Some(keep_style), 1, 0) };
        if !held.as_bool() {
            log::warn(
                "shell",
                "the window's style could not be held; Alt+Tab may list Kehai",
            );
        }
    }

    #[allow(unsafe_code)]
    pub fn set_taskbar(window: &WebviewWindow, on: bool) {
        TOOL.store(!on, Ordering::Relaxed);
        let Some(hwnd) = hwnd(window) else { return };
        // SAFETY: reads and writes the extended style of a live window of this
        // process. The style is 32 bits wide whatever the pointer size.
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, styled(style, !on) as isize);
        }
    }

    /// Whether another window lies over the middle of this one.
    #[allow(unsafe_code)]
    pub fn covered(window: &WebviewWindow) -> bool {
        let (Ok(at), Ok(size), Some(hwnd)) =
            (window.outer_position(), window.outer_size(), hwnd(window))
        else {
            return false;
        };
        let middle = POINT {
            x: at.x + size.width as i32 / 2,
            y: at.y + size.height as i32 / 2,
        };
        // SAFETY: plain queries; a point with no window under it gives a null
        // handle, which is checked.
        unsafe {
            let found = WindowFromPoint(middle);
            !found.is_invalid() && GetAncestor(found, GA_ROOT) != hwnd
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use tauri::WebviewWindow;

    pub fn hold(_window: &WebviewWindow) {}

    pub fn set_taskbar(_window: &WebviewWindow, _on: bool) {}

    pub fn covered(_window: &WebviewWindow) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_what_matters_most_first() {
        let mut view = View {
            visible: true,
            displays: vec![("d2".into(), "WaveShare".into(), String::new())],
            current: Some("d2".into()),
            ..View::default()
        };
        assert_eq!(tooltip(&view), "Kehai · on WaveShare");
        view.clients = 1;
        assert_eq!(tooltip(&view), "Kehai · on WaveShare · 1 remote panel");
        view.visible = false;
        assert_eq!(tooltip(&view), "Kehai · panel hidden · 1 remote panel");
        view.waiting = 2;
        assert_eq!(
            tooltip(&view),
            "Kehai · 2 agents are waiting · 1 remote panel"
        );
    }

    #[test]
    fn counts_only_agents_waiting_on_you() {
        let mut view = View::default();
        let agents = json!({ "topic": "dev:agents", "data": { "available": true, "sessions": [
            { "state": "waiting" }, { "state": "working" }, { "state": "error" }, { "state": "tool" }
        ] } });
        assert!(observe(&mut view, &agents));
        assert_eq!(view.waiting, 2);
        assert!(
            !observe(&mut view, &agents),
            "the same news twice changes nothing"
        );
    }

    #[test]
    fn offers_an_install_only_to_a_copy_that_can() {
        let mut view = View::default();
        let found = |installable| json!({ "topic": "app:update", "data": { "state": "available", "latest": "0.10.1", "installable": installable } });
        observe(&mut view, &found(true));
        assert!(view.update == Update::Install("0.10.1".into()));
        observe(&mut view, &found(false));
        assert!(view.update == Update::Check);
    }

    #[test]
    fn draws_the_diamond_filled_only_when_asked() {
        let middle = |image: &Image<'_>| image.rgba()[(16 * 32 + 16) * 4];
        assert_eq!(middle(&icon(false)), DARK[0] as u8);
        assert_eq!(middle(&icon(true)), AMBER[0] as u8);
        // The corners are rounded off, so they are see-through.
        assert_eq!(icon(false).rgba()[3], 0);
    }
}
