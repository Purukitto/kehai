//! Games that tell Kehai what their HUD shows, through Valve's game state
//! integration (GSI).
//!
//! A widget whose description file brings a `valve-gsi` source names the Steam
//! app, the game's cfg folder and the blocks of state to ask for. SET UP in
//! Settings finds the game through Steam's own library list and writes one
//! small file into that folder. From the game's next start, it POSTs its state
//! to Kehai on 127.0.0.1. That is the route Valve documents for peripherals and
//! overlays on the player's PC.
//!
//! Kehai listens only while a game is set up, only on this PC, and only for
//! posts carrying the key written into that game's file. It never reads, hooks
//! or starts the game, and REMOVE takes the file out again.

use std::collections::BTreeMap;
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Listener, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::bus;
use crate::log;
use crate::remote::same;

/// Where each set-up game is, and the listener. Private to the local panel:
/// it names folders on this PC.
const SETUP_TOPIC: &str = "game:setup";
const SRC: &str = "game";
const STORE_FILE: &str = "games.json";
/// Picked once, at the first SET UP, and written into every game's file. The
/// first free one from here.
const FIRST_PORT: u16 = 41730;
const PORTS_TO_TRY: u16 = 40;
/// Written into the file: the game sends at least this often while it runs,
/// menu included.
const HEARTBEAT_S: u64 = 60;
/// Nothing for a heartbeat and half a minute more: the game has closed.
const QUIET_AFTER: Duration = Duration::from_secs(HEARTBEAT_S + 30);
/// How often the files are checked for, and silence noticed.
const CHECK_EVERY: Duration = Duration::from_secs(5);
const HEAD_LIMIT: usize = 16 * 1024;
/// A full CS2 payload with weapons is a few kilobytes.
const BODY_LIMIT: usize = 512 * 1024;
const POLL: Duration = Duration::from_millis(100);
/// The first line of every file Kehai writes, so REMOVE knows its own.
const MARK: &str = "// Written by Kehai";

/// A game's part of a widget's description file. Mirrors `GameSource` in
/// `src/core/widget.ts`, which checks it first; checked again here, since the
/// engine is the one writing into the game's folder.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Source {
    kind: String,
    steam_app: u32,
    /// Inside the game's install folder, such as `game/csgo/cfg`.
    cfg_dir: String,
    /// The blocks of state to ask for, as the game names them.
    data: Vec<String>,
}

impl Source {
    fn check(&self) -> Result<(), String> {
        if self.kind != "valve-gsi" {
            return Err(format!("no source kind called {}", self.kind));
        }
        if self.steam_app == 0 {
            return Err("steamApp must be the game's Steam app id".into());
        }
        if relative(&self.cfg_dir).is_none() {
            return Err("cfgDir must be a folder inside the game's".into());
        }
        if self.data.is_empty() || self.data.len() > 24 {
            return Err("data must name 1 to 24 blocks".into());
        }
        if let Some(bad) = self.data.iter().find(|d| {
            d.is_empty() || d.len() > 32 || !d.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
        }) {
            return Err(format!("{bad} is not a block name"));
        }
        Ok(())
    }

    /// The top-level keys the asked-for blocks arrive under. Anything else in a
    /// post is dropped, so a widget only ever sees what its file asked for.
    fn keys(&self) -> Vec<&'static str> {
        let mut keys: Vec<&'static str> = self
            .data
            .iter()
            .filter_map(|block| match block.as_str() {
                "provider" => Some("provider"),
                "map" | "map_round_wins" => Some("map"),
                "round" => Some("round"),
                "player_id" | "player_state" | "player_weapons" | "player_match_stats"
                | "player_position" => Some("player"),
                "hero" => Some("hero"),
                "abilities" => Some("abilities"),
                "items" => Some("items"),
                "buildings" => Some("buildings"),
                "draft" => Some("draft"),
                "wearables" => Some("wearables"),
                "events" => Some("events"),
                "league" => Some("league"),
                _ => None,
            })
            .collect();
        keys.sort_unstable();
        keys.dedup();
        keys
    }
}

/// A folder path that stays inside the one it is joined to, rebuilt part by
/// part so it reads with this system's own separator.
fn relative(dir: &str) -> Option<PathBuf> {
    let mut path = PathBuf::new();
    for part in dir.split(['/', '\\']) {
        // A drive is only a prefix on Windows; anywhere else it would pass as a name.
        if part.contains(':') {
            return None;
        }
        let mut one = Path::new(part).components();
        match (one.next(), one.next()) {
            (Some(c @ Component::Normal(_)), None) => path.push(c),
            _ => return None,
        }
    }
    Some(path)
}

fn widget_id(id: &str) -> bool {
    let mut bytes = id.bytes();
    bytes.next().is_some_and(|b| b.is_ascii_lowercase())
        && id.len() <= 48
        && bytes.all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Renderer → engine on `game:command`. Mirrors `GameCommand` in
/// `src/core/payloads.ts`.
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Command {
    /// Look for the game through Steam, for the SET UP sheet.
    Find { widget: String, source: Source },
    /// Ask for the game's folder instead, in Windows' own folder picker.
    Choose { widget: String, source: Source },
    /// Write the file into the folder found or chosen, and listen.
    Setup {
        widget: String,
        name: String,
        source: Source,
        folder: String,
    },
    /// Take the file out again.
    Remove { widget: String },
    /// Show the game's cfg folder, with Kehai's file selected.
    Open { widget: String },
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Game {
    /// The game, as the widget's file names its source.
    name: String,
    source: Source,
    /// The game's install folder.
    folder: String,
    token: String,
    written_ms: u64,
}

impl Game {
    fn file(&self, widget: &str) -> PathBuf {
        cfg_dir(Path::new(&self.folder), &self.source).join(file_name(widget))
    }
}

#[derive(Serialize, Deserialize, Default)]
struct Stored {
    port: Option<u16>,
    games: BTreeMap<String, Game>,
}

/// What the tile reads, on `game:<widget>`. Mirrors `GamePayload` in
/// `src/core/payloads.ts`. Remote panels see it too: it is the player's own
/// HUD, and the key never reaches it.
#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct GamePayload {
    /// `none` once removed, `waiting` until the game first sends, `set` after,
    /// `gone` when Kehai's file has gone from the game's folder.
    setup: &'static str,
    heard_ms: Option<u64>,
    /// Heard from within the last heartbeat and a half.
    live: bool,
    /// The game's last post, without the key and without what was not asked for.
    data: Option<Value>,
}

/// On `game:setup`, for Settings. Mirrors `GameSetupPayload`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SetupPayload {
    /// Whether this system can find games and pick folders at all.
    supported: bool,
    port: Option<u16>,
    listening: bool,
    error: Option<String>,
    games: Vec<SetupGame>,
    found: Option<Found>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SetupGame {
    widget: String,
    name: String,
    folder: String,
    file: String,
    written_ms: u64,
}

/// Where a game was found for a widget, or why it was not.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Found {
    widget: String,
    /// The game's install folder, through Steam or as chosen.
    folder: Option<String>,
    /// How it was found: `steam` or `chosen`.
    by: &'static str,
    /// Where Kehai's file would go.
    file: Option<String>,
    /// Other programs' files already in that folder, left as they are.
    others: Vec<String>,
    reason: Option<String>,
}

/// What the listener's threads and the main loop share.
struct Live {
    /// By token: the widget it was written for, and the keys it may send.
    tokens: Vec<(String, String, Vec<&'static str>)>,
    heard: BTreeMap<String, (u64, Value)>,
}

static LIVE: Mutex<Option<Live>> = Mutex::new(None);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn new_token() -> Option<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).ok()?;
    Some(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn cfg_dir(folder: &Path, source: &Source) -> PathBuf {
    folder.join(relative(&source.cfg_dir).unwrap_or_default())
}

fn file_name(widget: &str) -> String {
    format!("gamestate_integration_kehai_{widget}.cfg")
}

/// The file the game reads at its start. Valve's KeyValues, with no byte-order
/// mark: the game skips a file that has one.
fn cfg_text(widget: &str, name: &str, port: u16, token: &str, source: &Source) -> String {
    let mut text = format!(
        "{MARK} for its {name} widget. Remove it in Kehai under Settings > Widgets, or delete this file.\n\
         \"Kehai {widget}\"\n{{\n \"uri\" \"http://127.0.0.1:{port}/\"\n \"timeout\" \"5.0\"\n \"buffer\" \"0.1\"\n \"throttle\" \"0.5\"\n \"heartbeat\" \"{HEARTBEAT_S}.0\"\n \"auth\"\n {{\n  \"token\" \"{token}\"\n }}\n \"data\"\n {{\n"
    );
    for block in &source.data {
        text.push_str(&format!("  \"{block}\" \"1\"\n"));
    }
    text.push_str(" }\n}\n");
    text
}

/// Kehai's own file, by its first line and its key, and nothing else.
fn ours(path: &Path, token: &str) -> bool {
    fs::read_to_string(path).is_ok_and(|text| text.starts_with(MARK) && text.contains(token))
}

/// Other programs' game state files beside Kehai's, by name.
fn others(dir: &Path, widget: &str) -> Vec<String> {
    let mine = file_name(widget);
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.starts_with("gamestate_integration_") && n.ends_with(".cfg") && *n != mine)
        .collect();
    names.sort();
    names
}

// ----------------------------------------------------------------- Steam

/// Valve's KeyValues text, as `libraryfolders.vdf` and the app manifests are
/// written: quoted keys, quoted values or braced blocks, `//` comments.
#[derive(Debug, PartialEq)]
enum Kv {
    Text(String),
    Block(Vec<(String, Kv)>),
}

impl Kv {
    fn get(&self, key: &str) -> Option<&Kv> {
        match self {
            Kv::Block(items) => items
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(key))
                .map(|(_, v)| v),
            Kv::Text(_) => None,
        }
    }

    fn text(&self) -> Option<&str> {
        match self {
            Kv::Text(t) => Some(t),
            Kv::Block(_) => None,
        }
    }
}

fn parse_kv(text: &str) -> Option<Kv> {
    let mut tokens = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                let mut s = String::new();
                while let Some(c) = chars.next() {
                    match c {
                        // Steam writes a backslash in a path as two.
                        '\\' => {
                            if let Some(next) = chars.next() {
                                s.push(next);
                            }
                        }
                        '"' => break,
                        c => s.push(c),
                    }
                }
                tokens.push(Token::Str(s));
            }
            '{' => tokens.push(Token::Open),
            '}' => tokens.push(Token::Close),
            '/' if chars.peek() == Some(&'/') => {
                for c in chars.by_ref() {
                    if c == '\n' {
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    let mut at = 0;
    Some(Kv::Block(block(&tokens, &mut at)?))
}

enum Token {
    Str(String),
    Open,
    Close,
}

fn block(tokens: &[Token], at: &mut usize) -> Option<Vec<(String, Kv)>> {
    let mut items = Vec::new();
    while *at < tokens.len() {
        match &tokens[*at] {
            Token::Close => {
                *at += 1;
                return Some(items);
            }
            Token::Open => return None,
            Token::Str(key) => {
                *at += 1;
                match tokens.get(*at)? {
                    Token::Str(value) => {
                        *at += 1;
                        items.push((key.clone(), Kv::Text(value.clone())));
                    }
                    Token::Open => {
                        *at += 1;
                        items.push((key.clone(), Kv::Block(block(tokens, at)?)));
                    }
                    Token::Close => return None,
                }
            }
        }
    }
    Some(items)
}

#[cfg(windows)]
#[allow(unsafe_code)]
fn steam_root() -> Option<PathBuf> {
    use windows::core::w;
    use windows::Win32::System::Registry::{
        RegGetValueW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ,
    };

    let read = |hkey, key: windows::core::PCWSTR, value: windows::core::PCWSTR| -> Option<String> {
        let mut buf = vec![0u16; 1024];
        let mut size = (buf.len() * 2) as u32;
        let status = unsafe {
            RegGetValueW(
                hkey,
                key,
                value,
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        if status.is_err() {
            return None;
        }
        let len = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..len]))
    };
    read(
        HKEY_CURRENT_USER,
        w!("Software\\Valve\\Steam"),
        w!("SteamPath"),
    )
    .or_else(|| {
        read(
            HKEY_LOCAL_MACHINE,
            w!("SOFTWARE\\WOW6432Node\\Valve\\Steam"),
            w!("InstallPath"),
        )
    })
    .map(|p| PathBuf::from(p.replace('/', "\\")))
    .filter(|p| p.is_dir())
}

#[cfg(not(windows))]
fn steam_root() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    [
        ".local/share/Steam",
        ".steam/steam",
        ".var/app/com.valvesoftware.Steam/.local/share/Steam",
    ]
    .iter()
    .map(|p| home.join(p))
    .find(|p| p.join("steamapps").is_dir())
}

/// The game's install folder, through Steam's list of library folders and the
/// app's manifest in the library that has it.
fn find(app: u32) -> Result<PathBuf, String> {
    let root =
        steam_root().ok_or("Steam isn't installed on this PC, or Kehai can't find where.")?;
    let list = fs::read_to_string(root.join("steamapps").join("libraryfolders.vdf"))
        .map_err(|_| "Steam's list of library folders isn't where Steam keeps it.".to_string())?;
    let list = parse_kv(&list).ok_or("Steam's list of library folders can't be read.")?;
    let folders = list
        .get("libraryfolders")
        .ok_or("Steam's list of library folders is empty.")?;
    let Kv::Block(entries) = folders else {
        return Err("Steam's list of library folders is empty.".into());
    };
    let id = app.to_string();
    for (_, entry) in entries {
        let Some(path) = entry.get("path").and_then(Kv::text) else {
            continue;
        };
        let has = entry
            .get("apps")
            .is_some_and(|apps| apps.get(&id).is_some());
        if !has {
            continue;
        }
        let steamapps = PathBuf::from(path).join("steamapps");
        let manifest = fs::read_to_string(steamapps.join(format!("appmanifest_{app}.acf")))
            .map_err(|_| "Steam lists the game, but its manifest is missing.".to_string())?;
        let dir = parse_kv(&manifest)
            .and_then(|m| {
                m.get("AppState")?
                    .get("installdir")?
                    .text()
                    .map(str::to_string)
            })
            .ok_or("Steam lists the game, but not the folder it is in.")?;
        let folder = steamapps.join("common").join(dir);
        if folder.is_dir() {
            return Ok(folder);
        }
        return Err("Steam lists the game, but its folder isn't there.".into());
    }
    Err("Steam doesn't list this game as installed.".into())
}

/// Windows' own folder picker, in front of the panel.
#[cfg(windows)]
#[allow(unsafe_code)]
fn pick_folder(app: &AppHandle, title: &str) -> Option<PathBuf> {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileOpenDialog, FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
    };

    // As a number, to cross to the dialog's thread.
    let owner = app
        .get_webview_window("main")
        .and_then(|w| w.hwnd().ok())
        .map(|h| h.0 as isize);
    let title = title.to_string();
    // Its own thread: the dialog needs a single-threaded apartment and blocks
    // until it closes.
    let picked = thread::spawn(move || {
        let owner = owner.map(|h| HWND(h as *mut _));
        let title = HSTRING::from(title);
        unsafe {
            let inited = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
            let result = (|| -> Option<PathBuf> {
                let dialog: IFileOpenDialog =
                    CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).ok()?;
                let options = dialog.GetOptions().ok()?;
                dialog
                    .SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)
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
    .join();
    picked.ok().flatten()
}

#[cfg(not(windows))]
fn pick_folder(_app: &AppHandle, _title: &str) -> Option<PathBuf> {
    None
}

// ----------------------------------------------------------------- engine

fn store_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(STORE_FILE))
}

fn load(path: Option<&Path>) -> Stored {
    let Some(path) = path else {
        return Stored::default();
    };
    let Ok(text) = fs::read_to_string(path) else {
        return Stored::default();
    };
    let mut stored: Stored = serde_json::from_str(&text).unwrap_or_default();
    // One that no longer passes the checks is dropped, not trusted.
    stored
        .games
        .retain(|id, g| widget_id(id) && g.source.check().is_ok() && g.token.len() == 32);
    stored
}

fn save(path: Option<&Path>, stored: &Stored) {
    let Some(path) = path else { return };
    let Ok(text) = serde_json::to_string_pretty(stored) else {
        return;
    };
    let result = path
        .parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|()| fs::write(path, text));
    if let Err(err) = result {
        log::problem(
            SRC,
            "Could not save which games are set up.",
            Some("After a restart, games need SET UP again."),
            err,
        );
    }
}

/// One listening socket. Dropping it stops it.
struct Listening {
    stop: Arc<AtomicBool>,
    accept: Option<JoinHandle<()>>,
}

impl Drop for Listening {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.accept.take() {
            let _ = handle.join();
        }
    }
}

enum Msg {
    Command(Command),
    /// A post arrived; the main loop publishes it.
    Heard,
}

pub fn spawn(app: AppHandle) {
    let (tx, rx) = mpsc::channel::<Msg>();
    let commands = tx.clone();
    app.listen("game:command", move |event| {
        match serde_json::from_str::<Command>(event.payload()) {
            Ok(command) => {
                let _ = commands.send(Msg::Command(command));
            }
            Err(err) => log::warn(SRC, format!("ignored a command: {err}")),
        }
    });

    thread::spawn(move || {
        let store = store_path(&app);
        let mut stored = load(store.as_deref());
        let mut found: Option<Found> = None;
        let mut listening: Option<Listening> = None;
        let mut error: Option<String> = None;
        let mut last: BTreeMap<String, GamePayload> = BTreeMap::new();
        let mut last_setup = String::new();

        loop {
            // Listen while a game is set up, and only then.
            if stored.games.is_empty() {
                listening = None;
            } else if listening.is_none() {
                match listen(&stored, &tx) {
                    Ok((port, l)) => {
                        if stored.port != Some(port) {
                            stored.port = Some(port);
                            save(store.as_deref(), &stored);
                        }
                        listening = Some(l);
                        error = None;
                    }
                    Err(e) => {
                        if error.as_deref() != Some(e.as_str()) {
                            log::problem(
                                SRC,
                                &e,
                                Some("Set-up games can't reach Kehai until it can."),
                                "",
                            );
                        }
                        error = Some(e);
                    }
                }
            }
            set_tokens(&stored);

            // Each game's tile.
            for (widget, game) in &stored.games {
                let heard = heard(widget);
                let payload = GamePayload {
                    setup: if !game.file(widget).is_file() {
                        "gone"
                    } else if heard.is_some() {
                        "set"
                    } else {
                        "waiting"
                    },
                    heard_ms: heard.as_ref().map(|(at, _)| *at),
                    live: heard.as_ref().is_some_and(|(at, _)| {
                        now_ms().saturating_sub(*at) < QUIET_AFTER.as_millis() as u64
                    }),
                    data: heard.map(|(_, v)| v),
                };
                if last.get(widget) != Some(&payload) {
                    bus::publish(&app, &format!("game:{widget}"), SRC, payload.clone());
                    last.insert(widget.clone(), payload);
                }
            }
            // A removed one says so once, so its tile does not keep the last match.
            let removed: Vec<String> = last
                .keys()
                .filter(|w| !stored.games.contains_key(*w))
                .cloned()
                .collect();
            for widget in removed {
                bus::publish(
                    &app,
                    &format!("game:{widget}"),
                    SRC,
                    GamePayload {
                        setup: "none",
                        heard_ms: None,
                        live: false,
                        data: None,
                    },
                );
                last.remove(&widget);
            }

            let setup = SetupPayload {
                supported: cfg!(any(windows, target_os = "linux")),
                port: stored.port,
                listening: listening.is_some(),
                error: error.clone(),
                games: stored
                    .games
                    .iter()
                    .map(|(widget, g)| SetupGame {
                        widget: widget.clone(),
                        name: g.name.clone(),
                        folder: g.folder.clone(),
                        file: g.file(widget).display().to_string(),
                        written_ms: g.written_ms,
                    })
                    .collect(),
                found: found.clone(),
            };
            // Posts arrive twice a second; Settings only needs to hear a change.
            let text = serde_json::to_string(&setup).unwrap_or_default();
            if text != last_setup {
                bus::publish(&app, SETUP_TOPIC, SRC, setup);
                last_setup = text;
            }

            let msg = match rx.recv_timeout(CHECK_EVERY) {
                Ok(msg) => msg,
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => return,
            };
            match msg {
                Msg::Heard => {}
                Msg::Command(Command::Find { widget, source }) => {
                    found = Some(look(&widget, &source, find(source.steam_app), "steam"));
                }
                Msg::Command(Command::Choose { widget, source }) => {
                    if let Some(folder) = pick_folder(&app, "The game's install folder") {
                        // The folder itself, or one inside it someone picked by mistake.
                        let game = folder
                            .ancestors()
                            .find(|f| cfg_dir(f, &source).is_dir())
                            .map(Path::to_path_buf)
                            .ok_or_else(|| {
                                format!(
                                    "That folder has no {} inside it. Pick the game's own folder.",
                                    source.cfg_dir
                                )
                            });
                        found = Some(look(&widget, &source, game, "chosen"));
                    }
                }
                Msg::Command(Command::Setup {
                    widget,
                    name,
                    source,
                    folder,
                }) => match set_up(&mut stored, &widget, &name, &source, Path::new(&folder)) {
                    Ok(()) => {
                        save(store.as_deref(), &stored);
                        // The port is in the file, so a listener that has not
                        // started yet picks it now.
                        listening = None;
                        found = None;
                        log::info(SRC, format!("set up {widget}"));
                    }
                    Err(e) => {
                        log::problem(SRC, &format!("Could not set up {name}."), None, &e);
                        if let Some(f) = found.as_mut().filter(|f| f.widget == widget) {
                            f.reason = Some(e);
                        }
                    }
                },
                Msg::Command(Command::Remove { widget }) => {
                    if let Some(game) = stored.games.remove(&widget) {
                        let file = game.file(&widget);
                        if ours(&file, &game.token) {
                            if let Err(err) = fs::remove_file(&file) {
                                log::warn(
                                    SRC,
                                    format!("could not remove {}: {err}", file.display()),
                                );
                            }
                        }
                        save(store.as_deref(), &stored);
                        if let Ok(mut live) = LIVE.lock() {
                            if let Some(live) = live.as_mut() {
                                live.heard.remove(&widget);
                            }
                        }
                        log::info(SRC, format!("removed {widget}"));
                    }
                }
                Msg::Command(Command::Open { widget }) => {
                    if let Some(game) = stored.games.get(&widget) {
                        let file = game.file(&widget);
                        let opened = if file.is_file() {
                            app.opener().reveal_item_in_dir(&file)
                        } else {
                            app.opener().open_path(
                                cfg_dir(Path::new(&game.folder), &game.source)
                                    .display()
                                    .to_string(),
                                None::<&str>,
                            )
                        };
                        if let Err(err) = opened {
                            log::warn(SRC, format!("the folder did not open: {err}"));
                        }
                    }
                }
            }
        }
    });
}

/// What SET UP shows for a folder found or chosen.
fn look(widget: &str, source: &Source, folder: Result<PathBuf, String>, by: &'static str) -> Found {
    let checked = source.check().and(folder);
    match checked {
        Ok(folder) => {
            let dir = cfg_dir(&folder, source);
            if !dir.is_dir() {
                return Found {
                    widget: widget.into(),
                    folder: Some(folder.display().to_string()),
                    by,
                    file: None,
                    others: Vec::new(),
                    reason: Some(format!(
                        "The game's folder has no {} inside it.",
                        source.cfg_dir
                    )),
                };
            }
            Found {
                widget: widget.into(),
                folder: Some(folder.display().to_string()),
                by,
                file: Some(dir.join(file_name(widget)).display().to_string()),
                others: others(&dir, widget),
                reason: None,
            }
        }
        Err(reason) => Found {
            widget: widget.into(),
            folder: None,
            by,
            file: None,
            others: Vec::new(),
            reason: Some(reason),
        },
    }
}

fn set_up(
    stored: &mut Stored,
    widget: &str,
    name: &str,
    source: &Source,
    folder: &Path,
) -> Result<(), String> {
    if !widget_id(widget) {
        return Err("not a widget id".into());
    }
    source.check()?;
    let dir = cfg_dir(folder, source);
    if !dir.is_dir() {
        return Err(format!(
            "There is no {} in {}.",
            source.cfg_dir,
            folder.display()
        ));
    }
    let port = match stored.port {
        Some(port) => port,
        None => free_port().ok_or("No free port for games to reach Kehai on.")?,
    };
    // A fresh key each time: an old file somebody kept stops working.
    let token = new_token().ok_or("No randomness available for a key.")?;
    let name: String = name
        .chars()
        .filter(|c| !c.is_control() && *c != '"')
        .take(60)
        .collect();
    let file = dir.join(file_name(widget));
    // Someone else's file of the same name is not overwritten.
    if file.is_file() && !fs::read_to_string(&file).is_ok_and(|t| t.starts_with(MARK)) {
        return Err(format!(
            "{} is there already, and Kehai didn't write it.",
            file.display()
        ));
    }
    fs::write(&file, cfg_text(widget, &name, port, &token, source))
        .map_err(|e| format!("Could not write {}: {e}", file.display()))?;
    stored.port = Some(port);
    stored.games.insert(
        widget.to_string(),
        Game {
            name,
            source: source.clone(),
            folder: folder.display().to_string(),
            token,
            written_ms: now_ms(),
        },
    );
    if let Ok(mut live) = LIVE.lock() {
        if let Some(live) = live.as_mut() {
            live.heard.remove(widget);
        }
    }
    Ok(())
}

fn free_port() -> Option<u16> {
    (FIRST_PORT..FIRST_PORT + PORTS_TO_TRY)
        .find(|p| TcpListener::bind((Ipv4Addr::LOCALHOST, *p)).is_ok())
}

fn set_tokens(stored: &Stored) {
    let tokens = stored
        .games
        .iter()
        .map(|(widget, g)| (g.token.clone(), widget.clone(), g.source.keys()))
        .collect();
    if let Ok(mut live) = LIVE.lock() {
        let live = live.get_or_insert_with(|| Live {
            tokens: Vec::new(),
            heard: BTreeMap::new(),
        });
        live.tokens = tokens;
        // Only set-up games are remembered.
        live.heard.retain(|w, _| stored.games.contains_key(w));
    }
}

fn heard(widget: &str) -> Option<(u64, Value)> {
    LIVE.lock().ok()?.as_ref()?.heard.get(widget).cloned()
}

fn listen(stored: &Stored, tx: &Sender<Msg>) -> Result<(u16, Listening), String> {
    let port = stored
        .port
        .or_else(free_port)
        .ok_or("No free port for games to reach Kehai on.")?;
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).map_err(|e| match e.kind() {
        ErrorKind::AddrInUse => {
            format!("Port {port}, which set-up games send to, is in use by another program.")
        }
        _ => format!("Could not listen for games on port {port}: {e}"),
    })?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Could not listen for games on port {port}: {e}"))?;
    log::info(SRC, format!("listening for games on 127.0.0.1:{port}"));

    let stop = Arc::new(AtomicBool::new(false));
    let accept = {
        let stop = Arc::clone(&stop);
        let tx = tx.clone();
        thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let tx = tx.clone();
                        thread::spawn(move || serve(stream, &tx));
                    }
                    Err(e) if e.kind() == ErrorKind::WouldBlock => thread::sleep(POLL),
                    Err(e) => {
                        log::warn(SRC, format!("accept failed: {e}"));
                        thread::sleep(POLL);
                    }
                }
            }
            log::info(SRC, format!("stopped listening for games on port {port}"));
        })
    };
    Ok((
        port,
        Listening {
            stop,
            accept: Some(accept),
        },
    ))
}

/// One post from a game. Answered at once, since the game sends nothing more
/// until it hears back.
fn serve(mut stream: TcpStream, tx: &Sender<Msg>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let status = match read(&mut stream) {
        Some(body) => match take(&body) {
            Some(_) => {
                let _ = tx.send(Msg::Heard);
                "200 OK"
            }
            None => "403 Forbidden",
        },
        None => "400 Bad Request",
    };
    let _ = stream.write_all(
        format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes(),
    );
    let _ = stream.flush();
}

/// The body of a POST, if that is what this is.
fn read(stream: &mut TcpStream) -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let end = loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        if buf.len() > HEAD_LIMIT {
            return None;
        }
    };
    let mut headers = [httparse::EMPTY_HEADER; 32];
    let mut request = httparse::Request::new(&mut headers);
    if !request.parse(&buf[..end]).ok()?.is_complete() || request.method != Some("POST") {
        return None;
    }
    let length: usize = request
        .headers
        .iter()
        .find(|h| h.name.eq_ignore_ascii_case("content-length"))
        .and_then(|h| std::str::from_utf8(h.value).ok()?.trim().parse().ok())?;
    if length > BODY_LIMIT {
        return None;
    }
    let mut body = buf.split_off(end);
    while body.len() < length {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(length);
    Some(body)
}

/// Keeps a post that carries a set-up game's key, without the key and without
/// anything its file did not ask for. Returns the widget it was for.
fn take(body: &[u8]) -> Option<String> {
    let Value::Object(mut post) = serde_json::from_slice::<Value>(body).ok()? else {
        return None;
    };
    let token = post.remove("auth")?.get("token")?.as_str()?.to_string();
    let mut guard = LIVE.lock().ok()?;
    let live = guard.as_mut()?;
    let (_, widget, keys) = live
        .tokens
        .iter()
        .find(|(t, _, _)| same(t.as_bytes(), token.as_bytes()))?
        .clone();
    post.retain(|key, _| keys.contains(&key.as_str()));
    live.heard
        .insert(widget.clone(), (now_ms(), Value::Object(post)));
    Some(widget)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cs2() -> Source {
        Source {
            kind: "valve-gsi".into(),
            steam_app: 730,
            cfg_dir: "game/csgo/cfg".into(),
            data: vec![
                "provider".into(),
                "map".into(),
                "map_round_wins".into(),
                "player_state".into(),
            ],
        }
    }

    #[test]
    fn reads_steams_library_list() {
        let text = r#""libraryfolders"
{
	"0"
	{
		"path"		"D:\\Steam"
		"apps"
		{
			"228980"		"0"
		}
	}
	"1"
	{
		"path"		"E:\\SteamLibrary"  // a comment
		"apps"
		{
			"730"		"107047291721"
		}
	}
}"#;
        let kv = parse_kv(text).expect("parses");
        let folders = kv.get("libraryfolders").expect("has folders");
        let Kv::Block(entries) = folders else {
            panic!("a block")
        };
        assert_eq!(entries.len(), 2);
        assert_eq!(
            entries[1].1.get("path").and_then(Kv::text),
            Some("E:\\SteamLibrary")
        );
        assert!(entries[1]
            .1
            .get("apps")
            .and_then(|a| a.get("730"))
            .is_some());
        assert!(entries[0]
            .1
            .get("apps")
            .and_then(|a| a.get("730"))
            .is_none());
    }

    #[test]
    fn checks_a_source() {
        assert!(cs2().check().is_ok());
        let mut bad = cs2();
        bad.cfg_dir = "../../Windows".into();
        assert!(bad.check().is_err());
        let mut bad = cs2();
        bad.cfg_dir = "C:\\Windows".into();
        assert!(bad.check().is_err());
        let mut bad = cs2();
        bad.data.push("\"uri\" \"http://elsewhere".into());
        assert!(bad.check().is_err());
        let mut bad = cs2();
        bad.kind = "udp".into();
        assert!(bad.check().is_err());
    }

    #[test]
    fn writes_the_file_valve_documents() {
        let text = cfg_text("cs2", "Counter-Strike 2", 41730, "abc", &cs2());
        assert!(text.starts_with(MARK));
        assert!(!text.starts_with('\u{feff}'));
        assert!(text.contains("\"uri\" \"http://127.0.0.1:41730/\""));
        assert!(text.contains("\"token\" \"abc\""));
        assert!(text.contains("  \"map_round_wins\" \"1\"\n"));
        assert_eq!(text.matches('{').count(), text.matches('}').count());
        // Kehai's own reader takes it, as the game would.
        let kv = parse_kv(&text).expect("parses");
        assert_eq!(
            kv.get("Kehai cs2")
                .and_then(|k| k.get("heartbeat"))
                .and_then(Kv::text),
            Some("60.0")
        );
    }

    #[test]
    fn keeps_only_what_was_asked_for() {
        assert_eq!(cs2().keys(), vec!["map", "player", "provider"]);
        if let Ok(mut live) = LIVE.lock() {
            *live = Some(Live {
                tokens: vec![("k".repeat(32), "cs2".into(), cs2().keys())],
                heard: BTreeMap::new(),
            });
        }
        let post = format!(
            r#"{{"auth":{{"token":"{}"}},"provider":{{"appid":730}},"allplayers":{{"x":1}},"previously":{{}},"map":{{"phase":"live"}}}}"#,
            "k".repeat(32)
        );
        assert_eq!(take(post.as_bytes()).as_deref(), Some("cs2"));
        let (_, kept) = heard("cs2").expect("heard");
        assert!(kept.get("auth").is_none());
        assert!(kept.get("allplayers").is_none());
        assert!(kept.get("previously").is_none());
        assert_eq!(kept["map"]["phase"], "live");
        assert!(take(br#"{"auth":{"token":"wrong"},"map":{}}"#).is_none());
        assert!(take(br#"{"map":{}}"#).is_none());
    }

    #[test]
    #[ignore = "reads the Steam install on the PC it runs on; run by hand"]
    fn finds_cs2_here() {
        let folder = find(730).expect("found through Steam");
        println!("{}", folder.display());
        assert!(cfg_dir(&folder, &cs2()).is_dir());
    }

    #[test]
    fn stays_inside_the_game_folder() {
        assert!(relative("game/csgo/cfg").is_some());
        assert!(relative("game\\dota\\cfg\\gamestate_integration").is_some());
        assert!(relative("").is_none());
        assert!(relative("/etc").is_none());
        assert!(relative("game/../..").is_none());
    }
}
