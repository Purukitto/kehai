//! What Steam keeps on this PC: where it is, its library folders, the games
//! installed in them and the art it caches for each. Read from Steam's own
//! files, never from a running game. The CS2 widget's setup and the dock both
//! come through here.

use std::fs;
use std::path::{Path, PathBuf};

/// Valve's KeyValues text, as `libraryfolders.vdf` and the app manifests are
/// written: quoted keys, quoted values or braced blocks, `//` comments.
#[derive(Debug, PartialEq)]
pub enum Kv {
    Text(String),
    Block(Vec<(String, Kv)>),
}

impl Kv {
    pub fn get(&self, key: &str) -> Option<&Kv> {
        match self {
            Kv::Block(items) => items
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(key))
                .map(|(_, v)| v),
            Kv::Text(_) => None,
        }
    }

    pub fn text(&self) -> Option<&str> {
        match self {
            Kv::Text(t) => Some(t),
            Kv::Block(_) => None,
        }
    }
}

pub fn parse_kv(text: &str) -> Option<Kv> {
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
pub fn steam_root() -> Option<PathBuf> {
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
pub fn steam_root() -> Option<PathBuf> {
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
/// One installed game, as its manifest describes it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Game {
    /// Steam's app number, as text.
    pub id: String,
    pub name: String,
    /// Where it is installed: a running game's program is somewhere under it.
    pub folder: PathBuf,
    /// When Steam last started it, 0 for never.
    pub played_ms: u64,
}

/// Steam installs these beside games. Nobody starts one from a dock.
fn not_a_game(id: &str, name: &str) -> bool {
    id == "228980"
        || ["Steamworks", "Proton", "Steam Linux Runtime"]
            .iter()
            .any(|p| name.starts_with(p))
}

/// Steam's app numbers are digits and nothing else, which also keeps one out
/// of a path or a link.
pub fn is_app_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 12 && id.bytes().all(|b| b.is_ascii_digit())
}

/// A game from its manifest's text, in the library whose `steamapps` folder
/// holds it. None for anything that isn't an installed game.
fn game_from(manifest: &str, steamapps: &Path) -> Option<Game> {
    let kv = parse_kv(manifest)?;
    let state = kv.get("AppState")?;
    let id = state.get("appid")?.text()?.to_string();
    let name = state.get("name")?.text()?.trim().to_string();
    let dir = state.get("installdir")?.text()?;
    if !is_app_id(&id) || name.is_empty() || dir.is_empty() || not_a_game(&id, &name) {
        return None;
    }
    let played = state
        .get("LastPlayed")
        .and_then(Kv::text)
        .and_then(|t| t.parse::<u64>().ok())
        .unwrap_or(0);
    Some(Game {
        id,
        name,
        folder: steamapps.join("common").join(dir),
        played_ms: played.saturating_mul(1000),
    })
}

/// Every library folder Steam lists, its own first.
fn libraries(root: &Path) -> Vec<PathBuf> {
    let mut found = vec![root.to_path_buf()];
    let list = fs::read_to_string(root.join("steamapps").join("libraryfolders.vdf"))
        .ok()
        .and_then(|t| parse_kv(&t));
    if let Some(Kv::Block(entries)) = list.as_ref().and_then(|l| l.get("libraryfolders")) {
        for (_, entry) in entries {
            if let Some(path) = entry.get("path").and_then(Kv::text) {
                let path = PathBuf::from(path);
                if !found.iter().any(|f| same_folder(f, &path)) {
                    found.push(path);
                }
            }
        }
    }
    found
}

fn same_folder(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| {
        p.to_string_lossy()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_ascii_lowercase()
    };
    norm(a) == norm(b)
}

/// Where Steam is, and every game installed in any of its libraries, last
/// played first. None when Steam isn't on this PC.
pub fn games() -> Option<(PathBuf, Vec<Game>)> {
    let root = steam_root()?;
    let mut all: Vec<Game> = Vec::new();
    for library in libraries(&root) {
        let steamapps = library.join("steamapps");
        let Ok(dir) = fs::read_dir(&steamapps) else {
            continue;
        };
        for file in dir.flatten() {
            let name = file.file_name().to_string_lossy().to_ascii_lowercase();
            if !(name.starts_with("appmanifest_") && name.ends_with(".acf")) {
                continue;
            }
            let Ok(text) = fs::read_to_string(file.path()) else {
                continue;
            };
            if let Some(game) = game_from(&text, &steamapps) {
                if !all.iter().any(|g| g.id == game.id) {
                    all.push(game);
                }
            }
        }
    }
    all.sort_by(|a, b| {
        b.played_ms
            .cmp(&a.played_ms)
            .then_with(|| a.name.cmp(&b.name))
    });
    Some((root, all))
}

/// The cover Steam shows for a game in its library, from its own cache:
/// `library_600x900` for older games, `library_capsule` for newer ones, either
/// at the top of the game's folder or one folder down.
pub fn cover(root: &Path, id: &str) -> Option<PathBuf> {
    if !is_app_id(id) {
        return None;
    }
    let base = root.join("appcache").join("librarycache").join(id);
    let mut files: Vec<PathBuf> = Vec::new();
    for entry in fs::read_dir(&base).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Ok(inner) = fs::read_dir(&path) {
                files.extend(inner.flatten().map(|e| e.path()).filter(|p| p.is_file()));
            }
        } else {
            files.push(path);
        }
    }
    best_cover(&files)
}

/// Of the files in a game's cache, the tall cover, in the order Steam prefers them.
fn best_cover(files: &[PathBuf]) -> Option<PathBuf> {
    ["library_600x900.jpg", "library_capsule.jpg"]
        .iter()
        .find_map(|want| {
            files.iter().find(|f| {
                f.file_name()
                    .is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(want))
            })
        })
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &str = "\"AppState\"\n{\n\t\"appid\"\t\t\"1422450\"\n\t\"name\"\t\t\"Deadlock\"\n\t\"installdir\"\t\t\"Deadlock\"\n\t\"LastPlayed\"\t\t\"1793996057\"\n}\n";

    #[test]
    fn a_manifest_gives_the_game_and_where_it_is() {
        let lib = Path::new(r"E:\SteamLibrary\steamapps");
        let game = game_from(MANIFEST, lib).expect("a game");
        assert_eq!(game.id, "1422450");
        assert_eq!(game.name, "Deadlock");
        assert_eq!(game.folder, lib.join("common").join("Deadlock"));
        assert_eq!(game.played_ms, 1_793_996_057_000);
    }

    #[test]
    fn steams_own_tools_and_broken_manifests_are_left_out() {
        let lib = Path::new("x");
        let tool = MANIFEST.replace("1422450", "228980").replace(
            "\"name\"\t\t\"Deadlock\"",
            "\"name\"\t\t\"Steamworks Common Redistributables\"",
        );
        assert_eq!(game_from(&tool, lib), None);
        let proton = MANIFEST.replace("\"name\"\t\t\"Deadlock\"", "\"name\"\t\t\"Proton 9.0\"");
        assert_eq!(game_from(&proton, lib), None);
        assert_eq!(game_from(&MANIFEST.replace("1422450", "12a"), lib), None);
        assert_eq!(game_from("\"AppState\" { \"name\" \"x\" }", lib), None);
        let never = MANIFEST.replace("\t\"LastPlayed\"\t\t\"1793996057\"\n", "");
        assert_eq!(game_from(&never, lib).map(|g| g.played_ms), Some(0));
    }

    #[test]
    fn the_tall_cover_is_found_under_either_name() {
        let old = [
            PathBuf::from("a/header.jpg"),
            PathBuf::from("a/library_600x900.jpg"),
        ];
        assert_eq!(
            best_cover(&old),
            Some(PathBuf::from("a/library_600x900.jpg"))
        );
        let new = [
            PathBuf::from("a/f6/logo.png"),
            PathBuf::from("a/43/library_capsule.jpg"),
        ];
        assert_eq!(
            best_cover(&new),
            Some(PathBuf::from("a/43/library_capsule.jpg"))
        );
        assert_eq!(best_cover(&[PathBuf::from("a/library_hero.jpg")]), None);
        assert_eq!(cover(Path::new("nowhere"), "../730"), None);
    }

    #[test]
    fn only_digits_are_an_app_id() {
        assert!(is_app_id("730"));
        assert!(!is_app_id(""));
        assert!(!is_app_id("730/../x"));
        assert!(!is_app_id("1e3"));
    }

    #[test]
    fn a_library_listed_twice_is_read_once() {
        assert!(same_folder(Path::new(r"D:\Steam"), Path::new("d:/steam/")));
        assert!(!same_folder(
            Path::new(r"D:\Steam"),
            Path::new(r"E:\SteamLibrary")
        ));
    }
}
