//! The dock: buttons on the panel that open apps, Steam games, links and
//! files, and what Kehai knows about each.
//!
//! The panel keeps the buttons. It tells the engine on `dock:pins` what they
//! open, and the engine opens only those: an app by its Start entry, a game
//! through Steam, a link only if it is https, and a file or folder only if it
//! was picked here, in Windows' own picker. Nothing typed becomes a command.
//!
//! For each thing pinned it says on `dock:state` whether it has a window open,
//! whether it has the microphone, and how many agent sessions wait in it, and
//! on `dock:icons` what it looks like: the app's own icon, or the cover Steam
//! keeps for the game. The Start menu and Steam lists the add sheet offers go
//! out on `dock:apps` only when the sheet asks, and only to this PC's panel.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Listener, Manager};

use super::{agents, launch, mic, steam};
use crate::bus;
use crate::log;

const SRC: &str = "poller.dock";
const STORE_FILE: &str = "dock.json";
/// How often what is pinned is looked at again.
const TICK: Duration = Duration::from_secs(3);
/// An open asked for longer ago than this is a replay, not a tap.
const FRESH_MS: u64 = 5_000;
/// Steam's list is read again after this, for a game installed meanwhile.
const GAMES_FOR: Duration = Duration::from_secs(60);
/// Icons on the panel's buttons, and in the add sheet's list.
const BUTTON_PX: u32 = 96;
const LIST_PX: u32 = 48;
/// A cover bigger than this isn't Steam's.
const COVER_MAX: u64 = 2 * 1024 * 1024;

/// What a button opens. Mirrors `DockTarget` in `src/core/payloads.ts`.
#[derive(Deserialize, Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Target {
    App { id: String },
    Game { id: String },
    Link { url: String },
    Path { path: String, folder: bool },
}

impl Target {
    /// As the panel names it: `keyOf` in `src/core/dock.ts`.
    fn key(&self) -> String {
        match self {
            Target::App { id } => format!("app:{id}"),
            Target::Game { id } => format!("game:{id}"),
            Target::Link { url } => format!("link:{url}"),
            Target::Path { path, .. } => format!("path:{path}"),
        }
    }
}

#[derive(Deserialize)]
struct Pins {
    targets: Vec<Target>,
}

/// Mirrors `DockCommand` in `src/core/payloads.ts`.
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "lowercase")]
enum Command {
    List,
    Open {
        press: String,
        target: Target,
        at: u64,
    },
    Pick {
        folder: bool,
    },
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
struct AppItem {
    id: String,
    name: String,
    running: bool,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
struct GameItem {
    id: String,
    name: String,
    running: bool,
    played_ms: u64,
}

/// Mirrors `DockAppsPayload`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AppsPayload {
    apps: Vec<AppItem>,
    games: Vec<GameItem>,
    /// Where Steam is, or None when it isn't on this PC.
    steam: Option<String>,
    icons: BTreeMap<String, String>,
}

/// Mirrors `DockLive`.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct Live {
    running: bool,
    listening: bool,
    waiting: u32,
}

/// Mirrors `DockStatePayload`.
#[derive(Serialize, Clone, PartialEq, Debug)]
struct StatePayload {
    live: BTreeMap<String, Live>,
}

/// Mirrors `DockIconsPayload`.
#[derive(Serialize, Clone, PartialEq, Debug)]
struct IconsPayload {
    icons: BTreeMap<String, String>,
}

/// Mirrors `DockOpened`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Opened {
    press: String,
    ok: bool,
    how: Option<&'static str>,
    reason: Option<String>,
}

/// Mirrors `DockPicked`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Picked {
    path: String,
    folder: bool,
    name: String,
}

/// A file or folder picked in Windows' picker: the only ones the dock opens.
#[derive(Deserialize, Serialize, Clone, PartialEq, Eq, Debug)]
struct Chosen {
    path: String,
    folder: bool,
}

#[derive(Deserialize, Serialize, Default)]
struct Stored {
    #[serde(default)]
    picked: Vec<Chosen>,
}

/// Where Steam is, and its games.
type Library = (PathBuf, Vec<steam::Game>);

#[derive(Default)]
struct Shared {
    pins: Vec<Target>,
    picked: Vec<Chosen>,
    store: Option<PathBuf>,
    /// Data URLs by key, and by key and size for the add sheet's list.
    icons: HashMap<String, String>,
    games: Option<(Instant, Option<Library>)>,
}

static SHARED: LazyLock<Mutex<Shared>> = LazyLock::new(|| Mutex::new(Shared::default()));
/// A list being made: another ask meanwhile gets the same one when it is out.
static LISTING: AtomicBool = AtomicBool::new(false);

fn shared() -> MutexGuard<'static, Shared> {
    SHARED.lock().unwrap_or_else(|e| e.into_inner())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A tap just now, not a command replayed from earlier.
fn fresh(at: u64, now: u64) -> bool {
    now.saturating_sub(at) <= FRESH_MS && at <= now + FRESH_MS
}

/// A web page and nothing else: https, a host, no spaces or quotes that could
/// make Windows read it as something more.
fn link_ok(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    url.len() <= 2048
        && !host.is_empty()
        && !url
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '"' | '<' | '>' | '`'))
}

fn chosen_ok(picked: &[Chosen], path: &str) -> bool {
    picked.iter().any(|c| c.path.eq_ignore_ascii_case(path))
}

/// The last part of a path, without a file's extension.
fn name_of(path: &str, folder: bool) -> String {
    let last = path
        .trim_end_matches(['\\', '/'])
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(path);
    let name = if folder {
        last
    } else {
        last.rsplit_once('.').map_or(last, |(stem, _)| stem)
    };
    if name.is_empty() {
        path.to_string()
    } else {
        name.to_string()
    }
}

/// Steam's games, read again once a minute at most.
fn games() -> Option<Library> {
    let mut s = shared();
    if let Some((at, games)) = &s.games {
        if at.elapsed() < GAMES_FOR {
            return games.clone();
        }
    }
    let games = steam::games();
    s.games = Some((Instant::now(), games.clone()));
    games
}

fn cover_url(root: &Path, id: &str) -> Option<String> {
    use base64::Engine;
    let file = steam::cover(root, id)?;
    if fs::metadata(&file).ok()?.len() > COVER_MAX {
        return None;
    }
    let bytes = fs::read(&file).ok()?;
    Some(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// An icon from the cache, or made and kept.
fn icon_for(key: &str, make: impl FnOnce() -> Option<String>) -> Option<String> {
    if let Some(found) = shared().icons.get(key) {
        return Some(found.clone());
    }
    let made = make()?;
    shared().icons.insert(key.to_string(), made.clone());
    Some(made)
}

// ----------------------------------------------------------------- windows

/// The windows of programs under a game's folder: which games run, and the
/// one to bring forward.
#[cfg(windows)]
mod game_windows {
    use std::path::Path;

    use super::super::front;

    pub type Handle = windows::Win32::Foundation::HWND;

    /// Every window with the program it runs, front to back.
    pub fn all() -> Vec<(Handle, String)> {
        let own = std::process::id();
        let mut images = std::collections::HashMap::new();
        front::windows()
            .into_iter()
            .filter(|w| w.pid != own)
            .filter_map(|w| {
                let image = images
                    .entry(w.pid)
                    .or_insert_with(|| front::image(w.pid))
                    .clone()?;
                Some((w.hwnd, image.to_ascii_lowercase()))
            })
            .collect()
    }

    pub fn under(windows: &[(Handle, String)], folder: &Path) -> Option<Handle> {
        let mut prefix = folder.to_string_lossy().to_ascii_lowercase();
        if !prefix.ends_with('\\') {
            prefix.push('\\');
        }
        windows
            .iter()
            .find(|(_, image)| image.starts_with(&prefix))
            .map(|(h, _)| *h)
    }

    pub fn raise(h: Handle) -> Result<(), String> {
        front::raise(h)
    }
}

#[cfg(not(windows))]
mod game_windows {
    use std::path::Path;

    pub type Handle = ();

    pub fn all() -> Vec<(Handle, String)> {
        Vec::new()
    }

    pub fn under(_windows: &[(Handle, String)], _folder: &Path) -> Option<Handle> {
        None
    }

    pub fn raise(_h: Handle) -> Result<(), String> {
        Err("the dock opens games only on Windows so far".to_string())
    }
}

// ----------------------------------------------------------------- opening

/// Opens what a button names, if the dock holds it. Straight from a tap on
/// this PC, which is what lets Windows hand the front to it.
fn open(target: &Target) -> Result<&'static str, String> {
    let (pinned, picked) = {
        let s = shared();
        (s.pins.contains(target), s.picked.clone())
    };
    if !pinned {
        return Err("it isn't on the dock".to_string());
    }
    match target {
        Target::App { id } => launch::open_app(id).map(|how| match how {
            launch::How::Front => "front",
            _ => "started",
        }),
        Target::Game { id } => {
            if !steam::is_app_id(id) {
                return Err("not a Steam game".to_string());
            }
            let folder = games()
                .and_then(|(_, all)| all.into_iter().find(|g| &g.id == id))
                .map(|g| g.folder)
                .ok_or_else(|| "Steam doesn't list it as installed".to_string())?;
            if let Some(window) = game_windows::under(&game_windows::all(), &folder) {
                return game_windows::raise(window).map(|()| "front");
            }
            launch::open_thing(&format!("steam://rungameid/{id}")).map(|()| "launched")
        }
        Target::Link { url } => {
            if !link_ok(url) {
                return Err("only https links open".to_string());
            }
            launch::open_thing(url).map(|()| "link")
        }
        Target::Path { path, .. } => {
            if !chosen_ok(&picked, path) {
                return Err("it wasn't picked here".to_string());
            }
            if !Path::new(path).exists() {
                return Err("it isn't there any more".to_string());
            }
            launch::open_thing(path).map(|()| "link")
        }
    }
}

fn kind(target: &Target) -> &'static str {
    match target {
        Target::App { .. } => "an app",
        Target::Game { .. } => "a game",
        Target::Link { .. } => "a link",
        Target::Path { folder: true, .. } => "a folder",
        Target::Path { .. } => "a file",
    }
}

// ----------------------------------------------------------------- reading

/// What the engine knows of each thing pinned.
fn live(pins: &[Target]) -> BTreeMap<String, Live> {
    let mut out = BTreeMap::new();
    let apps: Vec<String> = pins
        .iter()
        .filter_map(|t| match t {
            Target::App { id } => Some(id.clone()),
            _ => None,
        })
        .collect();
    if !apps.is_empty() {
        let running = launch::running(&apps);
        let holders = mic::holders();
        let waiting = agents::waiting();
        for id in &apps {
            let listening = holders
                .iter()
                .any(|h| launch::is_holder(id, h.package.as_deref(), h.exe.as_deref()));
            let waiting = waiting
                .iter()
                .filter(|pid| launch::hosts(id, **pid))
                .count() as u32;
            out.insert(
                format!("app:{id}"),
                Live {
                    running: running.contains(id),
                    listening,
                    waiting,
                },
            );
        }
    }
    let wanted: Vec<&String> = pins
        .iter()
        .filter_map(|t| match t {
            Target::Game { id } => Some(id),
            _ => None,
        })
        .collect();
    if !wanted.is_empty() {
        let windows = game_windows::all();
        let installed = games().map(|(_, g)| g).unwrap_or_default();
        for id in wanted {
            let running = installed
                .iter()
                .find(|g| &g.id == id)
                .is_some_and(|g| game_windows::under(&windows, &g.folder).is_some());
            out.insert(
                format!("game:{id}"),
                Live {
                    running,
                    ..Live::default()
                },
            );
        }
    }
    out
}

/// The icon or cover of each app or game pinned.
fn icons(pins: &[Target]) -> BTreeMap<String, String> {
    let root = pins
        .iter()
        .any(|t| matches!(t, Target::Game { .. }))
        .then(games)
        .flatten()
        .map(|(root, _)| root);
    let mut out = BTreeMap::new();
    for t in pins {
        let key = t.key();
        let got = match t {
            Target::App { id } => icon_for(&key, || launch::icon(id, BUTTON_PX)),
            Target::Game { id } => root
                .as_deref()
                .and_then(|r| icon_for(&key, || cover_url(r, id))),
            _ => None,
        };
        if let Some(url) = got {
            out.insert(key, url);
        }
    }
    out
}

/// The Start menu and Steam's games for the add sheet, with their icons. The
/// first time, making every app's icon takes seconds, so the list goes out at
/// once with the icons already made (`make` false), and again with all of them.
fn list(make: bool) -> AppsPayload {
    let menu = launch::start_menu();
    let ids: Vec<String> = menu.iter().map(|a| a.id.clone()).collect();
    let running = launch::running(&ids);
    let mut icons = BTreeMap::new();
    for a in &menu {
        let key = format!("app:{}", a.id);
        let sized = format!("{key}@{LIST_PX}");
        let got = if make {
            icon_for(&sized, || launch::icon(&a.id, LIST_PX))
        } else {
            shared().icons.get(&sized).cloned()
        };
        if let Some(url) = got {
            icons.insert(key, url);
        }
    }
    let found = games();
    let windows = if found.is_some() {
        game_windows::all()
    } else {
        Vec::new()
    };
    let mut games_out = Vec::new();
    if let Some((root, all)) = &found {
        for g in all {
            let key = format!("game:{}", g.id);
            if let Some(url) = icon_for(&key, || cover_url(root, &g.id)) {
                icons.insert(key, url);
            }
            games_out.push(GameItem {
                id: g.id.clone(),
                name: g.name.clone(),
                running: game_windows::under(&windows, &g.folder).is_some(),
                played_ms: g.played_ms,
            });
        }
    }
    AppsPayload {
        apps: menu
            .into_iter()
            .map(|a| AppItem {
                running: running.contains(&a.id),
                id: a.id,
                name: a.name,
            })
            .collect(),
        games: games_out,
        steam: found.map(|(root, _)| root.to_string_lossy().into_owned()),
        icons,
    }
}

// ----------------------------------------------------------------- picking

/// Windows' own file or folder picker, in front of the panel.
#[cfg(windows)]
#[allow(unsafe_code)]
fn pick(app: &AppHandle, folder: bool) -> Option<PathBuf> {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileOpenDialog, FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS,
        SIGDN_FILESYSPATH,
    };

    // As a number, to cross to the dialog's thread.
    let owner = app
        .get_webview_window("main")
        .and_then(|w| w.hwnd().ok())
        .map(|h| h.0 as isize);
    // Its own thread: the dialog needs a single-threaded apartment and blocks
    // until it closes.
    thread::spawn(move || {
        let owner = owner.map(|h| HWND(h as *mut _));
        let title = HSTRING::from(if folder {
            "A folder for the dock"
        } else {
            "A file for the dock"
        });
        // SAFETY: COM on this thread, balanced below; the dialog and the item
        // it returns are released as they go, and the name freed straight after.
        unsafe {
            let inited = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
            let result = (|| -> Option<PathBuf> {
                let dialog: IFileOpenDialog =
                    CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).ok()?;
                let options = dialog.GetOptions().ok()?;
                let kind = if folder {
                    FOS_PICKFOLDERS
                } else {
                    FOS_FILEMUSTEXIST
                };
                dialog
                    .SetOptions(options | kind | FOS_FORCEFILESYSTEM)
                    .ok()?;
                let _ = dialog.SetTitle(&title);
                dialog.Show(owner).ok()?;
                let item = dialog.GetResult().ok()?;
                let name = item.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
                let path = name.to_string().ok();
                CoTaskMemFree(Some(name.0 as *const _));
                path.map(PathBuf::from)
            })();
            if inited {
                CoUninitialize();
            }
            result
        }
    })
    .join()
    .ok()
    .flatten()
}

#[cfg(not(windows))]
fn pick(_app: &AppHandle, _folder: bool) -> Option<PathBuf> {
    None
}

fn load(path: Option<&Path>) -> Stored {
    path.and_then(|p| fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save(path: Option<&Path>, stored: &Stored) {
    let Some(path) = path else { return };
    let Ok(text) = serde_json::to_string_pretty(stored) else {
        return;
    };
    if let Err(err) = fs::write(path, text) {
        log::warn(SRC, format!("picked files not saved: {err}"));
    }
}

// ----------------------------------------------------------------- engine

pub fn spawn(app: AppHandle) {
    let store = app.path().app_data_dir().ok().map(|d| d.join(STORE_FILE));
    {
        let mut s = shared();
        s.picked = load(store.as_deref()).picked;
        s.store = store;
    }

    // Pins wake the reader at once, so a button added shows its state now.
    let (wake, woken) = mpsc::channel::<()>();
    app.listen("dock:pins", move |event| {
        let Ok(pins) = serde_json::from_str::<Pins>(event.payload()) else {
            return;
        };
        let mut s = shared();
        if s.pins != pins.targets {
            s.pins = pins.targets;
            drop(s);
            let _ = wake.send(());
        }
    });

    let commands = app.clone();
    app.listen("dock:command", move |event| {
        let Ok(cmd) = serde_json::from_str::<Command>(event.payload()) else {
            return;
        };
        let app = commands.clone();
        match cmd {
            Command::List => {
                if LISTING.swap(true, Ordering::SeqCst) {
                    return;
                }
                thread::spawn(move || {
                    // Cleared however this ends, so the next ask is heard.
                    struct Done;
                    impl Drop for Done {
                        fn drop(&mut self) {
                            LISTING.store(false, Ordering::SeqCst);
                        }
                    }
                    let _done = Done;
                    let quick = list(false);
                    let missing = quick.apps.len().saturating_sub(
                        quick.icons.keys().filter(|k| k.starts_with("app:")).count(),
                    );
                    bus::publish(&app, "dock:apps", SRC, quick);
                    if missing == 0 {
                        return;
                    }
                    let started = Instant::now();
                    let payload = list(true);
                    log::info(
                        SRC,
                        format!(
                            "made {missing} icons for {} apps and {} games in {} ms",
                            payload.apps.len(),
                            payload.games.len(),
                            started.elapsed().as_millis()
                        ),
                    );
                    bus::publish(&app, "dock:apps", SRC, payload);
                });
            }
            Command::Open { press, target, at } => {
                if !fresh(at, now_ms()) {
                    return;
                }
                thread::spawn(move || {
                    let result = open(&target);
                    // What kind of thing and how, never which: that is the
                    // person's own business.
                    match &result {
                        Ok(how) => log::info(SRC, format!("opened {} ({how})", kind(&target))),
                        Err(why) => {
                            log::warn(SRC, format!("could not open {}: {why}", kind(&target)))
                        }
                    }
                    bus::publish(
                        &app,
                        "dock:opened",
                        SRC,
                        Opened {
                            press,
                            ok: result.is_ok(),
                            how: result.as_ref().ok().copied(),
                            reason: result.err(),
                        },
                    );
                });
            }
            Command::Pick { folder } => {
                thread::spawn(move || {
                    let Some(path) = pick(&app, folder) else {
                        return;
                    };
                    let path = path.to_string_lossy().into_owned();
                    {
                        let mut s = shared();
                        if !chosen_ok(&s.picked, &path) {
                            s.picked.push(Chosen {
                                path: path.clone(),
                                folder,
                            });
                        }
                        let stored = Stored {
                            picked: s.picked.clone(),
                        };
                        save(s.store.as_deref(), &stored);
                    }
                    log::info(
                        SRC,
                        if folder {
                            "a folder was picked"
                        } else {
                            "a file was picked"
                        },
                    );
                    bus::publish(
                        &app,
                        "dock:picked",
                        SRC,
                        Picked {
                            name: name_of(&path, folder),
                            path,
                            folder,
                        },
                    );
                });
            }
        }
    });

    thread::spawn(move || {
        let mut last_state: Option<StatePayload> = None;
        let mut last_icons: Option<IconsPayload> = None;
        loop {
            let pins = shared().pins.clone();
            let icons = IconsPayload {
                icons: icons(&pins),
            };
            if last_icons.as_ref() != Some(&icons) {
                bus::publish(&app, "dock:icons", SRC, icons.clone());
                last_icons = Some(icons);
            }
            let state = StatePayload { live: live(&pins) };
            if last_state.as_ref() != Some(&state) {
                bus::publish(&app, "dock:state", SRC, state.clone());
                last_state = Some(state);
            }
            match woken.recv_timeout(TICK) {
                Ok(()) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => thread::sleep(TICK),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What the dock would offer and show on this PC, in counts. Opens
    /// nothing. Run by hand: `cargo test dock_on_this_pc -- --ignored --nocapture`.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn dock_on_this_pc() {
        let started = Instant::now();
        let menu = launch::start_menu();
        println!(
            "start menu: {} apps in {} ms",
            menu.len(),
            started.elapsed().as_millis()
        );
        let started = Instant::now();
        let icons = menu
            .iter()
            .filter(|a| launch::icon(&a.id, LIST_PX).is_some())
            .count();
        println!(
            "icons: {icons} of {} in {} ms",
            menu.len(),
            started.elapsed().as_millis()
        );
        let ids: Vec<String> = menu.iter().map(|a| a.id.clone()).collect();
        println!("open now: {}", launch::running(&ids).len());
        if let Some((root, all)) = steam::games() {
            let covers = all
                .iter()
                .filter(|g| steam::cover(&root, &g.id).is_some())
                .count();
            println!("steam: {} games, {covers} covers", all.len());
        }
        let holders = mic::holders();
        let named = holders
            .iter()
            .filter(|h| launch::name_for(h.package.as_deref(), h.exe.as_deref()).is_some())
            .count();
        println!("mic: {} listening, {named} named", holders.len());
        // Set KEHAI_ICONS_TO to a folder to look at a few of them.
        if let Some(dir) = std::env::var_os("KEHAI_ICONS_TO") {
            use base64::Engine;
            for (i, a) in menu.iter().take(6).enumerate() {
                let Some(url) = launch::icon(&a.id, BUTTON_PX) else {
                    continue;
                };
                let b64 = url.trim_start_matches("data:image/png;base64,");
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(b64)
                    .expect("base64");
                fs::write(Path::new(&dir).join(format!("icon{i}.png")), bytes).expect("written");
            }
        }
        assert!(!menu.is_empty());
        assert!(icons > menu.len() / 2);
    }

    #[test]
    fn only_a_tap_from_just_now_opens() {
        assert!(fresh(10_000, 10_500));
        assert!(!fresh(1_000, 10_000));
        assert!(!fresh(20_000, 10_000));
    }

    #[test]
    fn only_plain_https_links_open() {
        assert!(link_ok("https://github.com/Purukitto/kehai"));
        assert!(link_ok("https://example.com"));
        assert!(!link_ok("http://example.com"));
        assert!(!link_ok("file:///C:/Windows/system32/cmd.exe"));
        assert!(!link_ok("https://"));
        assert!(!link_ok("https://example.com/a b"));
        assert!(!link_ok("https://example.com/\"x"));
        assert!(!link_ok(&format!("https://e.com/{}", "a".repeat(3000))));
    }

    #[test]
    fn a_path_opens_only_if_it_was_picked_here() {
        let picked = [Chosen {
            path: r"C:\Notes\Plan.md".into(),
            folder: false,
        }];
        assert!(chosen_ok(&picked, r"c:\notes\plan.md"));
        assert!(!chosen_ok(&picked, r"C:\Windows\System32\cmd.exe"));
    }

    #[test]
    fn a_picked_thing_is_named_after_its_last_part() {
        assert_eq!(name_of(r"C:\Notes\Plan.md", false), "Plan");
        assert_eq!(name_of(r"D:\Code\kehai\", true), "kehai");
        assert_eq!(name_of(r"D:\Code\v1.2", true), "v1.2");
    }

    #[test]
    fn targets_read_as_the_panel_writes_them() {
        let t: Target = serde_json::from_str(r#"{"kind":"game","id":"730"}"#).expect("a game");
        assert_eq!(t.key(), "game:730");
        let p: Target = serde_json::from_str(r#"{"kind":"path","path":"C:\\x","folder":true}"#)
            .expect("a path");
        assert_eq!(p.key(), r"path:C:\x");
        let c: Command = serde_json::from_str(
            r#"{"action":"open","press":"a:1","at":5,"target":{"kind":"link","url":"https://e.com"}}"#,
        )
        .expect("an open");
        assert!(matches!(c, Command::Open { at: 5, .. }));
        assert!(serde_json::from_str::<Command>(r#"{"action":"run","cmd":"x"}"#).is_err());
    }
}
