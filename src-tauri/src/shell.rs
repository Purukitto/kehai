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
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::thread;
use std::time::Duration;

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
    /// Of those, the ones open in a window the menu can go to.
    go_to: Vec<Waiting>,
    clients: usize,
    /// Each display's id, its name for the tooltip, and its row in Move to.
    displays: Vec<(String, String, String)>,
    current: Option<String>,
    fill: bool,
    update: Update,
}

/// A session waiting on you that the menu offers to go to.
#[derive(Clone, PartialEq, Debug)]
struct Waiting {
    id: String,
    name: String,
    error: bool,
    since_ms: i64,
}

/// How many sessions the menu offers at most. More would push the menu's own
/// items off the bottom of a short display.
const GO_TO_MAX: usize = 3;

/// How often the menu's "waiting 4 min" is brought up to date while anything
/// waits. Nothing else changes it.
const GO_TO_TICK: Duration = Duration::from_secs(20);

/// How long, the way the menu says it.
fn ago(ms: i64) -> String {
    let s = (ms / 1000).max(0);
    if s < 60 {
        format!("{s} s")
    } else if s < 3600 {
        format!("{} min", s / 60)
    } else {
        format!("{} h", s / 3600)
    }
}

/// One "Go to" line. A menu reads `&` as a shortcut marker, so a project's own
/// is doubled. The time sits in the menu's right-hand column on Windows.
fn go_to_label(w: &Waiting, now: i64) -> String {
    let gap = if cfg!(windows) { "\t" } else { " · " };
    format!(
        "Go to {}{gap}{} {}",
        w.name.replace('&', "&&"),
        if w.error { "error" } else { "waiting" },
        ago(now - w.since_ms)
    )
}

#[derive(Clone, Default, PartialEq)]
enum Update {
    #[default]
    Check,
    Checking,
    Install(String),
    Installing(String),
}

/// The "Go to" lines at the top of the menu, the line under them, and what
/// they say, so lines that read the same are left alone.
#[derive(Default)]
struct GoToLines {
    items: Vec<MenuItem<Wry>>,
    line: Option<PredefinedMenuItem<Wry>>,
    shown: Vec<String>,
}

struct Shell {
    tray: Option<TrayIcon<Wry>>,
    menu: Menu<Wry>,
    go_to: Mutex<GoToLines>,
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
            if let Some(session) = id.strip_prefix("jump:") {
                // The click on the menu is what lets Windows bring another
                // program's window forward, so it goes straight there.
                let (app, session) = (app.clone(), session.to_string());
                thread::spawn(move || crate::pollers::agents::jump(&app, &session));
            } else if let Some(display) = id.strip_prefix("move:") {
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
            let yours: Vec<&Value> = data["sessions"]
                .as_array()
                .filter(|_| data["available"].as_bool() == Some(true))
                .map(|sessions| {
                    sessions
                        .iter()
                        .filter(|s| matches!(s["state"].as_str(), Some("waiting" | "error")))
                        .collect()
                })
                .unwrap_or_default();
            view.waiting = yours.len();
            // Longest waiting first, errors among them: whichever has waited
            // longest is the one most likely forgotten.
            let mut go_to: Vec<Waiting> = yours
                .iter()
                .filter(|s| s["via"].is_string())
                .filter_map(|s| {
                    let project = s["project"].as_str()?;
                    Some(Waiting {
                        id: s["id"].as_str()?.to_string(),
                        name: match s["worktree"].as_str() {
                            Some(w) => format!("{project} ({w})"),
                            None => project.to_string(),
                        },
                        error: s["state"].as_str() == Some("error"),
                        since_ms: s["sinceMs"].as_i64().unwrap_or(0),
                    })
                })
                .collect();
            go_to.sort_by_key(|w| w.since_ms);
            go_to.truncate(GO_TO_MAX);
            view.go_to = go_to;
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

/// Puts the "Go to" lines at the top of the menu as they should read now,
/// touching the menu only when a line changes. A line under them parts them
/// from the menu's own items, and goes when they do.
fn refresh_go_to(app: &AppHandle, shell: &Shell) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64);
    let wanted: Vec<(String, String)> = lock(&shell.view)
        .go_to
        .iter()
        .map(|w| (w.id.clone(), go_to_label(w, now)))
        .collect();
    let labels: Vec<String> = wanted.iter().map(|(id, l)| format!("{id}\n{l}")).collect();

    let mut go_to = lock(&shell.go_to);
    let GoToLines { items, line, shown } = &mut *go_to;
    if *shown == labels {
        return;
    }
    for item in items.drain(..) {
        let _ = shell.menu.remove(&item);
    }
    if let Some(sep) = line.take() {
        let _ = shell.menu.remove(&sep);
    }
    for (at, (id, label)) in wanted.iter().enumerate() {
        if let Ok(item) = MenuItem::with_id(app, format!("jump:{id}"), label, true, None::<&str>) {
            if shell.menu.insert(&item, at).is_ok() {
                items.push(item);
            }
        }
    }
    if !items.is_empty() {
        if let Ok(sep) = PredefinedMenuItem::separator(app) {
            if shell.menu.insert(&sep, items.len()).is_ok() {
                *line = Some(sep);
            }
        }
    }
    *shown = labels;
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
        refresh_go_to(&app, shell);
        // Ends only if the bus cut this tap off for falling behind; then it
        // starts again from the retained values.
        loop {
            match rx.recv_timeout(GO_TO_TICK) {
                Ok(envelope) => {
                    let changed = observe(&mut lock(&shell.view), &envelope);
                    if changed {
                        refresh(&app, shell);
                        refresh_go_to(&app, shell);
                    }
                }
                // Only the times have moved on.
                Err(RecvTimeoutError::Timeout) => refresh_go_to(&app, shell),
                Err(RecvTimeoutError::Disconnected) => break,
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
        menu,
        go_to: Mutex::new(GoToLines::default()),
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
    fn offers_to_go_to_open_sessions_waiting_longest_first() {
        let mut view = View::default();
        let s = |id: &str, state: &str, since: i64, via: Value| json!({ "id": id, "project": "kehai", "worktree": null, "state": state, "sinceMs": since, "via": via });
        let agents = json!({ "topic": "dev:agents", "data": { "available": true, "sessions": [
            s("a", "error", 300, json!("vscode")),
            s("b", "waiting", 100, json!("desktop")),
            s("c", "waiting", 200, Value::Null),
            s("d", "working", 50, json!("terminal")),
            s("e", "waiting", 400, json!("terminal")),
            s("f", "waiting", 500, json!("terminal")),
        ] } });
        observe(&mut view, &agents);
        assert_eq!(
            view.waiting, 5,
            "the count still takes in every one waiting"
        );
        let ids: Vec<&str> = view.go_to.iter().map(|w| w.id.as_str()).collect();
        // Not c, which can't be gone to; not d, which is at work; three at most.
        assert_eq!(ids, ["b", "a", "e"]);
        assert!(view.go_to[1].error);
    }

    #[test]
    fn a_go_to_line_says_how_long() {
        let w = Waiting {
            id: "x".into(),
            name: "R&D (main)".into(),
            error: false,
            since_ms: 0,
        };
        let gap = if cfg!(windows) { "\t" } else { " · " };
        assert_eq!(
            go_to_label(&w, 4 * 60_000 + 5_000),
            format!("Go to R&&D (main){gap}waiting 4 min")
        );
        assert_eq!(ago(12_000), "12 s");
        assert_eq!(ago(2 * 3_600_000), "2 h");
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
