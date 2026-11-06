//! Which agent sessions are open right now, what each runs in, and how to
//! bring one's window to the front.
//!
//! While a session is open, the agent keeps a small file for it in a
//! `sessions` folder beside the transcript folder, named for its process:
//! `<pid>.json`. Only four fields of it are read: the process id, when that
//! process started, the session id and what it was started from. Other files
//! in the folder, such as the key kept beside each one, are never opened. The format is the agent's own and undocumented, so anything
//! unexpected reads as "can't tell", and the panel then behaves as it did
//! before it read these files.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Deserializer, Serialize};

/// What a session runs in, which decides what bringing it forward means.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Via {
    /// The agent's desktop app. It has no way to open one session from
    /// outside, so its window comes forward and the session is picked there.
    Desktop,
    /// A VS Code window.
    Vscode,
    /// A terminal window. Which tab is the terminal's business.
    Terminal,
}

/// One open session, as far as Kehai needs to know.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Live {
    pub pid: u32,
    pub via: Option<Via>,
}

/// The fields read from a session's file, and no others.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    pid: u32,
    /// When the process started, in the platform's own units: on Windows the
    /// process's creation time, so a reused process id is told apart.
    #[serde(default, deserialize_with = "number_or_text")]
    proc_start: Option<u64>,
    session_id: String,
    #[serde(default)]
    entrypoint: Option<String>,
}

/// Written as text so it survives a 64-bit number in JSON; taken either way.
fn number_or_text<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
    Ok(match serde_json::Value::deserialize(d)? {
        serde_json::Value::Number(n) => n.as_u64(),
        serde_json::Value::String(s) => s.trim().parse().ok(),
        _ => None,
    })
}

/// What the session was started from. Matched by its ending, since the
/// beginning names the agent, which Kehai has no business knowing.
pub fn via(entrypoint: Option<&str>) -> Option<Via> {
    let e = entrypoint?;
    if e.ends_with("desktop") {
        Some(Via::Desktop)
    } else if e.ends_with("vscode") {
        Some(Via::Vscode)
    } else if e == "cli" {
        Some(Via::Terminal)
    } else {
        // Run by a script or another program: there is no window of its own
        // to go to.
        None
    }
}

/// The folder beside the transcript folder that holds the session files.
pub fn folder(transcripts: &Path) -> Option<PathBuf> {
    Some(transcripts.parent()?.join("sessions"))
}

/// Reads one session's file. None for anything that isn't one.
fn record(text: &str) -> Option<(String, Live, Option<u64>)> {
    let r: Record = serde_json::from_str(text).ok()?;
    if r.session_id.is_empty() || r.pid == 0 {
        return None;
    }
    let live = Live {
        pid: r.pid,
        via: via(r.entrypoint.as_deref()),
    };
    Some((r.session_id, live, r.proc_start))
}

/// The open sessions, by session id. None when there is no such folder at all,
/// which means this agent doesn't keep the files and nothing can be told about
/// which sessions are open. An empty map means none are.
pub fn open(
    folder: &Path,
    alive: impl Fn(u32, Option<u64>) -> bool,
) -> Option<HashMap<String, Live>> {
    let entries = fs::read_dir(folder).ok()?;
    let mut open = HashMap::new();
    for entry in entries.flatten() {
        let path = entry.path();
        // `<pid>.json` only. The key beside each is never opened.
        let named_for_a_process = path.extension().is_some_and(|e| e == "json")
            && path
                .file_stem()
                .and_then(|s| s.to_str())
                .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()));
        if !named_for_a_process {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let Some((id, live, started)) = record(&text) else {
            continue;
        };
        // A file left behind by a process that crashed, or whose id has since
        // gone to another process, is not an open session.
        if alive(live.pid, started) {
            open.insert(id, live);
        }
    }
    Some(open)
}

/// Whether a process is still the one that wrote its session's file.
pub fn alive(pid: u32, started: Option<u64>) -> bool {
    platform::alive(pid, started)
}

/// Brings the window a session runs in to the front. Windows lets only the
/// program that took the last input do this, so call it straight from a tap or
/// a click on this PC.
pub fn bring_forward(live: Live, cwd_hint: Option<&str>) -> Result<(), String> {
    platform::bring_forward(live, cwd_hint)
}

#[cfg(windows)]
mod platform {
    use std::collections::HashMap;

    use windows::core::BOOL;
    use windows::Win32::Foundation::{CloseHandle, FILETIME, HWND, LPARAM, STILL_ACTIVE};
    use windows::Win32::System::Console::{
        AttachConsole, FreeConsole, GetConsoleWindow, SetConsoleCtrlHandler,
    };
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetAncestor, GetForegroundWindow, GetWindow, GetWindowLongPtrW,
        GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        SetForegroundWindow, ShowWindow, GA_ROOTOWNER, GWL_EXSTYLE, GW_OWNER, SW_RESTORE,
        WS_EX_TOOLWINDOW,
    };

    use super::{Live, Via};

    /// How far up from the agent's own process its window may be. A terminal
    /// is a shell or two above it; an editor's window, a helper or two.
    const MAX_UP: usize = 8;

    #[allow(unsafe_code)]
    pub fn alive(pid: u32, started: Option<u64>) -> bool {
        // SAFETY: querying a process by id; a failure is an error value.
        let Ok(handle) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) })
        else {
            return false;
        };
        let mut code = 0u32;
        let (mut created, mut exited, mut kernel, mut user) = (
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
        );
        // SAFETY: a live handle and out-pointers to locals.
        let running = unsafe { GetExitCodeProcess(handle, &mut code) }.is_ok()
            && code == STILL_ACTIVE.0 as u32;
        // SAFETY: as above.
        let times =
            unsafe { GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user) }
                .is_ok();
        // SAFETY: opened above and not used after this.
        let _ = unsafe { CloseHandle(handle) };
        let created = (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
        running
            && match started {
                Some(started) => times && created == started,
                None => true,
            }
    }

    /// Every process's parent and name, from one snapshot.
    #[allow(unsafe_code)]
    fn processes() -> HashMap<u32, (u32, String)> {
        let mut all = HashMap::new();
        // SAFETY: a snapshot of the process list, closed below.
        let Ok(snap) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
            return all;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        // SAFETY: a live snapshot and an entry with its size set.
        let mut more = unsafe { Process32FirstW(snap, &mut entry) }.is_ok();
        while more {
            let len = entry
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..len]).to_ascii_lowercase();
            all.insert(entry.th32ProcessID, (entry.th32ParentProcessID, name));
            // SAFETY: as above.
            more = unsafe { Process32NextW(snap, &mut entry) }.is_ok();
        }
        // SAFETY: opened above and not used after this.
        let _ = unsafe { CloseHandle(snap) };
        all
    }

    struct Window {
        hwnd: HWND,
        pid: u32,
        title: String,
    }

    /// The windows a person would call windows: shown, owned by nobody, titled,
    /// and not a tool palette.
    #[allow(unsafe_code)]
    fn windows() -> Vec<Window> {
        unsafe extern "system" fn each(hwnd: HWND, found: LPARAM) -> BOOL {
            // SAFETY: the pointer is the Vec passed to EnumWindows below, which
            // outlives the enumeration.
            let found = unsafe { &mut *(found.0 as *mut Vec<Window>) };
            // SAFETY: plain queries on a window handle Windows just gave us.
            unsafe {
                let tool = (GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32) & WS_EX_TOOLWINDOW.0 != 0;
                let owned = GetWindow(hwnd, GW_OWNER).is_ok_and(|o| !o.is_invalid());
                if IsWindowVisible(hwnd).as_bool() && !tool && !owned {
                    let len = GetWindowTextLengthW(hwnd);
                    if len > 0 {
                        let mut buf = vec![0u16; len as usize + 1];
                        let n = GetWindowTextW(hwnd, &mut buf);
                        let mut pid = 0u32;
                        GetWindowThreadProcessId(hwnd, Some(&mut pid));
                        found.push(Window {
                            hwnd,
                            pid,
                            title: String::from_utf16_lossy(&buf[..n.max(0) as usize]),
                        });
                    }
                }
            }
            true.into()
        }
        let mut found: Vec<Window> = Vec::new();
        // SAFETY: the callback only touches `found`, which lives past the call.
        let _ = unsafe { EnumWindows(Some(each), LPARAM(&mut found as *mut _ as isize)) };
        found
    }

    /// The console a terminal session writes to, and the window that shows it.
    /// A terminal app owns the console's stand-in window; the old console host
    /// shows it itself.
    #[allow(unsafe_code)]
    fn console_window(pid: u32) -> Option<HWND> {
        // SAFETY: Kehai has no console of its own in a release build. While
        // attached for this one look, Ctrl+C in that console must not stop
        // Kehai, so it is ignored until the console is let go again.
        unsafe {
            let _ = SetConsoleCtrlHandler(None, true);
            let attached = AttachConsole(pid).is_ok();
            let hwnd = if attached {
                GetConsoleWindow()
            } else {
                HWND::default()
            };
            if attached {
                let _ = FreeConsole();
            }
            let _ = SetConsoleCtrlHandler(None, false);
            if hwnd.is_invalid() {
                return None;
            }
            let top = GetAncestor(hwnd, GA_ROOTOWNER);
            let top = if top.is_invalid() { hwnd } else { top };
            IsWindowVisible(top).as_bool().then_some(top)
        }
    }

    /// The nearest process above the agent's that has a window. Stops at the
    /// desktop shell: what is above it is not the session's window, and the
    /// shell's own windows are the taskbar and the desktop.
    fn walk_up(pid: u32, wins: &[Window], cwd_hint: Option<&str>) -> Option<HWND> {
        let procs = processes();
        let mut at = pid;
        for _ in 0..MAX_UP {
            let (parent, name) = procs.get(&at)?;
            if name == "explorer.exe" || name == "services.exe" {
                return None;
            }
            let mine: Vec<&Window> = wins.iter().filter(|w| w.pid == at).collect();
            if !mine.is_empty() {
                // An editor has a window per folder. The one titled with the
                // session's folder is the one it runs in.
                let named = cwd_hint
                    .and_then(|f| mine.iter().find(|w| w.title.contains(f)))
                    .copied();
                return Some(named.unwrap_or(mine[0]).hwnd);
            }
            if *parent == 0 || *parent == at {
                return None;
            }
            at = *parent;
        }
        None
    }

    #[allow(unsafe_code)]
    pub fn bring_forward(live: Live, cwd_hint: Option<&str>) -> Result<(), String> {
        let wins = windows();
        let hwnd = match live.via {
            Some(Via::Terminal) => {
                console_window(live.pid).or_else(|| walk_up(live.pid, &wins, None))
            }
            Some(Via::Vscode) => walk_up(live.pid, &wins, cwd_hint),
            Some(Via::Desktop) => walk_up(live.pid, &wins, None),
            None => None,
        }
        .ok_or_else(|| "found no window for the session".to_string())?;

        // SAFETY: plain calls on a window handle found just now. A window that
        // has closed since only makes them fail.
        unsafe {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            let before = GetForegroundWindow();
            // Windows says at once whether it agrees. The switch itself finishes
            // on the other program's thread a moment later, so asking which
            // window is in front straight after would find none.
            if SetForegroundWindow(hwnd).as_bool() {
                return Ok(());
            }
            // Which program held the front, for the log: a program's name,
            // never a window's title.
            let mut pid = 0u32;
            GetWindowThreadProcessId(before, Some(&mut pid));
            let holder = processes()
                .remove(&pid)
                .map_or_else(|| "another program".to_string(), |(_, name)| name);
            Err(format!("Windows kept {holder} in front"))
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::Live;

    /// Without a way to read a process's start time here, a process that
    /// exists counts as the one that wrote the file.
    pub fn alive(pid: u32, _started: Option<u64>) -> bool {
        if cfg!(target_os = "linux") {
            std::path::Path::new("/proc").join(pid.to_string()).exists()
        } else {
            true
        }
    }

    pub fn bring_forward(_live: Live, _cwd_hint: Option<&str>) -> Result<(), String> {
        Err("going to a session's window works only on Windows so far".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_what_a_session_runs_in_by_how_it_was_started() {
        assert_eq!(via(Some("agent-desktop")), Some(Via::Desktop));
        assert_eq!(via(Some("agent-vscode")), Some(Via::Vscode));
        assert_eq!(via(Some("cli")), Some(Via::Terminal));
        assert_eq!(via(Some("sdk-ts")), None);
        assert_eq!(via(None), None);
    }

    #[test]
    fn reads_only_the_fields_it_needs() {
        let (id, live, started) = record(
            r#"{"pid":6392,"sessionId":"a9b3","cwd":"D:\\x","procStart":"134383716234947216",
                "entrypoint":"agent-desktop","name":"never read","status":"busy"}"#,
        )
        .expect("a session file");
        assert_eq!(id, "a9b3");
        assert_eq!(
            live,
            Live {
                pid: 6392,
                via: Some(Via::Desktop)
            }
        );
        assert_eq!(started, Some(134_383_716_234_947_216));
    }

    #[test]
    fn something_else_is_not_a_session() {
        assert!(record("not json").is_none());
        assert!(record(r#"{"pid":0,"sessionId":"a"}"#).is_none());
        assert!(record(r#"{"pid":5,"sessionId":""}"#).is_none());
        assert!(record(r#"{"sessionId":"a"}"#).is_none());
    }

    #[test]
    fn the_folder_sits_beside_the_transcripts() {
        assert_eq!(
            folder(Path::new("/home/me/agent/projects")),
            Some(PathBuf::from("/home/me/agent/sessions"))
        );
    }

    #[test]
    fn open_sessions_are_the_files_of_living_processes() {
        let dir = std::env::temp_dir().join(format!("kehai-sessions-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp folder");
        let write = |name: &str, text: &str| fs::write(dir.join(name), text).expect("write");
        write(
            "10.json",
            r#"{"pid":10,"sessionId":"open","procStart":"7","entrypoint":"cli"}"#,
        );
        write(
            "11.json",
            r#"{"pid":11,"sessionId":"crashed","procStart":"7","entrypoint":"cli"}"#,
        );
        write(
            "12.json",
            r#"{"pid":12,"sessionId":"reused","procStart":"8","entrypoint":"cli"}"#,
        );
        // Never opened: not named for a process.
        write("10.abc.key", "secret");
        write("notes.json", r#"{"pid":13,"sessionId":"stray"}"#);

        let alive = |pid: u32, started: Option<u64>| pid == 10 || (pid == 12 && started == Some(7));
        let open = open(&dir, alive).expect("the folder is there");
        let _ = fs::remove_dir_all(&dir);

        assert_eq!(open.len(), 1);
        assert_eq!(
            open["open"],
            Live {
                pid: 10,
                via: Some(Via::Terminal)
            }
        );
    }

    #[test]
    fn no_folder_is_not_the_same_as_none_open() {
        let missing = std::env::temp_dir().join("kehai-sessions-never-made");
        assert!(open(&missing, |_, _| true).is_none());
    }

    /// The real files and processes on the machine the tests run on. A build
    /// machine has no agent sessions, so this is run by hand:
    /// `cargo test -- --ignored reads_this_machine`.
    #[test]
    #[ignore = "reads the agent sessions open on this machine"]
    fn reads_this_machine() {
        let root = crate::pollers::transcripts::transcript_root(None).expect("a transcript folder");
        let open = open(&folder(&root).expect("a parent"), alive).expect("a sessions folder");
        eprintln!("{open:#?}");
    }
}
