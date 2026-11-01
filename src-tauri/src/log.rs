//! Kehai's log: what the engine started, what failed and why, in a file on
//! this PC. A release build has no console, so before this the reason for a
//! failure was simply gone: the 0.8.0 update that "could not reach GitHub" took
//! a debug build to explain.
//!
//! What goes in is what Kehai did, never what it read: no notification text,
//! no transcript content, no track titles, no remote key or pairing link.
//! Callers keep to that, and `docs/privacy.md` says so.
//!
//! The problems someone at the panel can act on are also kept apart, the last
//! few of them, for Settings → About and for a bug report.

use std::fmt::Display;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::utils::config::BundleType;
use tauri::utils::platform::bundle_type;
use tauri::{AppHandle, Listener, Manager, Url};
use tauri_plugin_opener::OpenerExt;

use crate::bus;

const TOPIC: &str = "app:log";
/// The tail of the log, sent once when COPY asks for it.
const COPY_TOPIC: &str = "app:log-copy";
const SRC: &str = "log";
const FILE: &str = "kehai.log";
/// A file this size starts the next one. Three are kept: a few weeks of a
/// quiet panel, and enough of a noisy day to see how it started.
const MAX_BYTES: u64 = 1_000_000;
const KEEP: usize = 3;
const PROBLEMS_FILE: &str = "problems.json";
const PROBLEMS_KEPT: usize = 5;
const COPY_LINES: usize = 200;
/// Long enough for a stack's first frames, short enough that a report link
/// stays well inside what a browser and GitHub accept.
const DETAIL_CHARS: usize = 300;
const ISSUE_URL: &str = "https://github.com/Purukitto/kehai/issues/new";

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    fn label(self) -> &'static str {
        match self {
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        }
    }
}

/// One thing that went wrong that someone at the panel could do something
/// about, or should at least know of. Mirrors `LogProblem` in
/// `src/core/payloads.ts`.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    at_ms: u64,
    /// Which part of Kehai: `poller.update`, `remote`, `panel`, `kehai`.
    src: String,
    level: Level,
    /// In words for the panel.
    what: String,
    /// What happens now, or what to do.
    then: Option<String>,
    /// The cause as the code saw it, for a bug report.
    detail: String,
    /// The same problem again, counted rather than listed again.
    count: u32,
}

/// Kept on disk so a crash, and what led up to it, is still there next time.
#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct Stored {
    /// Newest first.
    problems: Vec<Problem>,
    /// When Kehai last closed by panicking, until someone dismisses it.
    crashed_at_ms: Option<u64>,
}

/// Engine → local renderer on `app:log`. Mirrors `LogPayload` in
/// `src/core/payloads.ts`. Never sent to a remote panel.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LogPayload {
    file: Option<String>,
    detail: bool,
    problems: Vec<Problem>,
    crashed_at_ms: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CopyPayload {
    text: String,
    at_ms: u64,
}

/// Renderer → engine on `log:command`. Mirrors `LogCommand` in
/// `src/core/payloads.ts`.
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Command {
    /// An error in the panel's own page.
    Write {
        level: Level,
        what: String,
        detail: String,
    },
    Detail {
        on: bool,
    },
    OpenFolder,
    Copy,
    Report,
    DismissCrash,
}

/// Renderer → engine on `log:context`: what the panel knows that the engine
/// does not, for a bug report. Its layout, displays and which sources report.
#[derive(Deserialize)]
struct Context {
    text: String,
}

struct Log {
    dir: PathBuf,
    file: Option<File>,
    written: u64,
    stored: Stored,
}

static LOG: Mutex<Option<Log>> = Mutex::new(None);
static APP: Mutex<Option<AppHandle>> = Mutex::new(None);
static CONTEXT: Mutex<String> = Mutex::new(String::new());
/// More detail: on until Kehai restarts, so it is never left on by mistake.
static DETAIL: AtomicBool = AtomicBool::new(false);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A panic elsewhere must not take the log down with it.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn path(dir: &Path, n: usize) -> PathBuf {
    if n == 0 {
        dir.join(FILE)
    } else {
        dir.join(format!("kehai.{n}.log"))
    }
}

/// kehai.log becomes kehai.1.log, and so on, and the oldest goes.
fn rotate(dir: &Path) {
    let _ = fs::remove_file(path(dir, KEEP - 1));
    for n in (0..KEEP - 1).rev() {
        let _ = fs::rename(path(dir, n), path(dir, n + 1));
    }
}

fn open(dir: &Path) -> (Option<File>, u64) {
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path(dir, 0))
        .ok();
    let written = file
        .as_ref()
        .and_then(|f| f.metadata().ok())
        .map_or(0, |m| m.len());
    (file, written)
}

impl Log {
    fn append(&mut self, line: &str) {
        if self.written + line.len() as u64 > MAX_BYTES {
            self.file = None;
            rotate(&self.dir);
            (self.file, self.written) = open(&self.dir);
        }
        if let Some(file) = self.file.as_mut() {
            if file.write_all(line.as_bytes()).is_ok() {
                self.written += line.len() as u64;
            }
        }
    }

    /// Written beside itself and renamed into place, as the display choice is.
    fn save(&self) {
        let Ok(text) = serde_json::to_string(&self.stored) else {
            return;
        };
        let file = self.dir.join(PROBLEMS_FILE);
        let tmp = file.with_extension("json.tmp");
        if fs::write(&tmp, text)
            .and_then(|()| fs::rename(&tmp, &file))
            .is_err()
        {
            let _ = fs::remove_file(&tmp);
        }
    }

    fn note(&mut self, problem: Problem) {
        let problems = &mut self.stored.problems;
        match problems.first_mut() {
            Some(last) if last.src == problem.src && last.what == problem.what => {
                last.count += 1;
                last.at_ms = problem.at_ms;
                last.detail = problem.detail;
            }
            _ => {
                problems.insert(0, problem);
                problems.truncate(PROBLEMS_KEPT);
            }
        }
        self.save();
    }

    fn payload(&self) -> LogPayload {
        LogPayload {
            file: Some(path(&self.dir, 0).display().to_string()),
            detail: DETAIL.load(Ordering::Relaxed),
            problems: self.stored.problems.clone(),
            crashed_at_ms: self.stored.crashed_at_ms,
        }
    }
}

fn line(level: Level, src: &str, msg: &str) -> String {
    // A stack or a multi-line reason stays one entry, indented under its first line.
    let msg = msg.trim_end().replace('\n', "\n    ");
    format!(
        "{} {:<5} {}  {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
        level.label(),
        src,
        msg
    )
}

fn write(level: Level, src: &str, msg: &str) {
    let line = line(level, src, msg);
    // A debug build keeps its console, which is where a developer looks first.
    if cfg!(debug_assertions) {
        eprint!("{line}");
    }
    if let Some(log) = lock(&LOG).as_mut() {
        log.append(&line);
    }
}

pub fn info(src: &str, msg: impl Display) {
    write(Level::Info, src, &msg.to_string());
}

pub fn warn(src: &str, msg: impl Display) {
    write(Level::Warn, src, &msg.to_string());
}

pub fn error(src: &str, msg: impl Display) {
    write(Level::Error, src, &msg.to_string());
}

/// Only while More detail is on. Built only then, too.
pub fn detail(src: &str, msg: impl FnOnce() -> String) {
    if detailed() {
        write(Level::Info, src, &msg());
    }
}

pub fn detailed() -> bool {
    DETAIL.load(Ordering::Relaxed)
}

fn clip(text: &str, max: usize) -> String {
    match text.char_indices().nth(max) {
        Some((at, _)) => format!("{}…", &text[..at]),
        None => text.to_string(),
    }
}

fn add(level: Level, src: &str, what: &str, then: Option<&str>, detail: &str) {
    write(level, src, &format!("{what} {detail}"));
    let problem = Problem {
        at_ms: now_ms(),
        src: src.to_string(),
        level,
        what: what.to_string(),
        then: then.map(str::to_string),
        detail: clip(detail, DETAIL_CHARS),
        count: 1,
    };
    let payload = lock(&LOG).as_mut().map(|log| {
        log.note(problem);
        log.payload()
    });
    publish(payload);
}

/// Something someone at the panel can act on or should know: logged, and
/// listed under Settings → About. `what` and `then` are read on the panel, so
/// they are plain sentences; `detail` is the cause as the code saw it.
pub fn problem(src: &str, what: &str, then: Option<&str>, detail: impl Display) {
    add(Level::Warn, src, what, then, &detail.to_string());
}

/// Outside the log's lock: publishing can itself log.
fn publish(payload: Option<LogPayload>) {
    let app = lock(&APP).clone();
    if let (Some(app), Some(payload)) = (app, payload) {
        bus::publish(&app, TOPIC, SRC, payload);
    }
}

fn republish() {
    let payload = lock(&LOG).as_ref().map(Log::payload);
    publish(payload);
}

/// Which part of Kehai a panic came from, read off the file it happened in.
fn source_of(place: &str) -> String {
    let place = place.replace('\\', "/");
    let file = place.split(".rs").next().unwrap_or_default();
    match file.rsplit_once("pollers/") {
        Some((_, name)) => format!("poller.{name}"),
        None if file.ends_with("remote") => "remote".into(),
        None => "kehai".into(),
    }
}

/// A panic on the main thread ends Kehai, and the next start says so. One on
/// any other thread stops only that part, a source that goes quiet, which
/// About lists.
fn on_panic(info: &std::panic::PanicHookInfo<'_>) {
    let thread = thread::current();
    let name = thread.name().unwrap_or("unnamed");
    let message = info
        .payload()
        .downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| info.payload().downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "no message".into());
    let place = info
        .location()
        .map(|l| format!("{}:{}", l.file(), l.line()))
        .unwrap_or_default();
    let detail = format!("panicked on {name} at {place}: {message}");
    let fatal = name == "main";
    let src = if fatal {
        "kehai".to_string()
    } else {
        source_of(&place)
    };
    let (what, then) = if fatal {
        ("Kehai closed unexpectedly.", "The log has what happened.")
    } else {
        ("Stopped unexpectedly.", "Restart Kehai to start it again.")
    };

    let line = line(Level::Error, &src, &format!("{what} {detail}"));
    if cfg!(debug_assertions) {
        eprint!("{line}");
    }
    // The panic may have happened inside the log itself, holding its lock.
    // Waiting on it would hang the thread that is meant to be unwinding.
    let Ok(mut guard) = LOG.try_lock() else {
        return;
    };
    let Some(log) = guard.as_mut() else { return };
    log.append(&line);
    if fatal {
        log.stored.crashed_at_ms = Some(now_ms());
    }
    log.note(Problem {
        at_ms: now_ms(),
        src,
        level: Level::Error,
        what: what.into(),
        then: Some(then.into()),
        detail: clip(&detail, DETAIL_CHARS),
        count: 1,
    });
    drop(guard);
    if !fatal {
        // Off this thread: if it panicked while publishing, the bus is still
        // locked until it has finished unwinding.
        thread::spawn(republish);
    }
}

fn tail(dir: &Path, lines: usize) -> String {
    let mut kept: Vec<String> = Vec::new();
    for n in 0..KEEP {
        if kept.len() >= lines {
            break;
        }
        let Ok(text) = fs::read_to_string(path(dir, n)) else {
            break;
        };
        let older: Vec<String> = text.lines().map(str::to_string).collect();
        let take = (lines - kept.len()).min(older.len());
        let mut part = older[older.len() - take..].to_vec();
        part.append(&mut kept);
        kept = part;
    }
    kept.join("\n")
}

/// What the Which build list on the issue form calls this copy.
fn build() -> Option<&'static str> {
    match bundle_type() {
        Some(BundleType::Nsis) => Some("Installer (NSIS .exe)"),
        Some(BundleType::Msi) => Some("Installer (MSI)"),
        None if cfg!(debug_assertions) => Some("Built from source (debug)"),
        None if cfg!(windows) => Some("Portable .zip"),
        _ => None,
    }
}

fn os() -> String {
    let name = sysinfo::System::long_os_version().unwrap_or_else(|| "Unknown OS".into());
    match sysinfo::System::kernel_version() {
        Some(build) => format!("{name} (build {build})"),
        None => name,
    }
}

/// What goes in the issue's Diagnostics box: this copy, what the panel said
/// about itself, and the last problems.
fn report_text(
    version: &str,
    os: &str,
    context: &str,
    problems: &[Problem],
    has_log: bool,
) -> String {
    let mut text = format!(
        "Kehai {version}, {} · {os}\n",
        build().unwrap_or("unknown build")
    );
    if !context.is_empty() {
        text.push_str(context.trim_end());
        text.push('\n');
    }
    if problems.is_empty() {
        text.push_str("\nNo problems logged.");
    } else {
        text.push_str("\nLast problems:\n");
        for p in problems {
            let at = chrono::DateTime::from_timestamp_millis(p.at_ms as i64)
                .map(|t| {
                    t.with_timezone(&chrono::Local)
                        .format("%Y-%m-%d %H:%M:%S")
                        .to_string()
                })
                .unwrap_or_default();
            let times = if p.count > 1 {
                format!(" (×{})", p.count)
            } else {
                String::new()
            };
            text.push_str(&format!(
                "{at} {} {}  {}{times} {}\n",
                p.level.label().to_lowercase(),
                p.src,
                p.what,
                p.detail
            ));
        }
    }
    if has_log {
        text.push_str("\nThe whole log is in Settings → About → Log on the reporter's PC.");
    }
    text
}

/// The issue form's fields go in the link by their ids in
/// `.github/ISSUE_TEMPLATE/bug_report.yml`.
fn issue_url(version: &str, os: &str, text: &str) -> Option<Url> {
    let mut url = Url::parse(ISSUE_URL).ok()?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("template", "bug_report.yml")
            .append_pair("version", version)
            .append_pair("os", os)
            .append_pair("header", "ENGINE (green dot)");
        if let Some(build) = build() {
            query.append_pair("build", build);
        }
        query.append_pair("logs", text);
    }
    Some(url)
}

/// Opens a new issue on GitHub with what Kehai knows filled in. Nothing is
/// sent from here: the browser shows the form, and the person reads it and
/// presses Create, or doesn't.
pub fn report_bug(app: &AppHandle) {
    let version = app.package_info().version.to_string();
    let (problems, has_log) = {
        let guard = lock(&LOG);
        match guard.as_ref() {
            Some(log) => (log.stored.problems.clone(), true),
            None => (Vec::new(), false),
        }
    };
    let context = lock(&CONTEXT).clone();
    let os = os();
    let text = report_text(&version, &os, &context, &problems, has_log);
    let Some(url) = issue_url(&version, &os, &text) else {
        return;
    };
    info(SRC, "opening a bug report in the browser");
    if let Err(err) = app.opener().open_url(url.as_str(), None::<&str>) {
        warn(SRC, format!("the bug report did not open: {err}"));
    }
}

/// Selects kehai.log in the file manager, rather than only opening its folder.
pub fn open_log_folder(app: &AppHandle) {
    let Some(file) = lock(&LOG).as_ref().map(|log| path(&log.dir, 0)) else {
        return;
    };
    if let Err(err) = app.opener().reveal_item_in_dir(&file) {
        warn(SRC, format!("the log folder did not open: {err}"));
    }
}

fn command(app: &AppHandle, command: Command) {
    match command {
        Command::Write {
            level,
            what,
            detail,
        } => {
            let level = if level == Level::Info {
                Level::Warn
            } else {
                level
            };
            add(
                level,
                "panel",
                &clip(&what, 160),
                Some("The log has where it happened."),
                &clip(&detail, 2000),
            );
        }
        Command::Detail { on } => {
            DETAIL.store(on, Ordering::Relaxed);
            info(
                SRC,
                if on {
                    "more detail on until restart"
                } else {
                    "more detail off"
                },
            );
            republish();
        }
        Command::OpenFolder => open_log_folder(app),
        Command::Copy => {
            let text = lock(&LOG).as_ref().map(|log| tail(&log.dir, COPY_LINES));
            if let Some(text) = text {
                bus::publish(
                    app,
                    COPY_TOPIC,
                    SRC,
                    CopyPayload {
                        text,
                        at_ms: now_ms(),
                    },
                );
            }
        }
        Command::Report => report_bug(app),
        Command::DismissCrash => {
            if let Some(log) = lock(&LOG).as_mut() {
                log.stored.crashed_at_ms = None;
                log.save();
            }
            republish();
        }
    }
}

/// Opens the log and starts listening. Call first in setup, so everything
/// after it is written down. A copy with nowhere to write logs to the
/// console only, as before.
pub fn init(app: &AppHandle) {
    *lock(&APP) = Some(app.clone());

    match app.path().app_log_dir() {
        Ok(dir) => {
            let _ = fs::create_dir_all(&dir);
            if fs::metadata(path(&dir, 0)).is_ok_and(|m| m.len() >= MAX_BYTES) {
                rotate(&dir);
            }
            let (file, written) = open(&dir);
            let stored = fs::read_to_string(dir.join(PROBLEMS_FILE))
                .ok()
                .and_then(|text| serde_json::from_str(&text).ok())
                .unwrap_or_default();
            *lock(&LOG) = Some(Log {
                dir,
                file,
                written,
                stored,
            });
        }
        Err(err) => eprintln!("log: no folder to write to, logging to the console only: {err}"),
    }

    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        on_panic(info);
        previous(info);
    }));

    info(
        "kehai",
        format!(
            "{} {} started, {} · {}",
            app.package_info().name,
            app.package_info().version,
            build().unwrap_or("unknown build"),
            os()
        ),
    );

    let commands = app.clone();
    app.listen("log:command", move |event| {
        match serde_json::from_str::<Command>(event.payload()) {
            Ok(c) => command(&commands, c),
            Err(err) => warn(SRC, format!("ignored a command: {err}")),
        }
    });
    app.listen("log:context", move |event| {
        if let Ok(context) = serde_json::from_str::<Context>(event.payload()) {
            *lock(&CONTEXT) = clip(&context.text, 1500);
        }
    });

    republish();
}

/// The last line of a clean exit, so a log that ends without one shows where
/// Kehai stopped.
pub fn stopped() {
    info("kehai", "quit");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_source_a_panic_came_from() {
        assert_eq!(source_of(r"src\pollers\media.rs:120"), "poller.media");
        assert_eq!(source_of("src/pollers/notify.rs:7"), "poller.notify");
        assert_eq!(source_of(r"src\remote.rs:88"), "remote");
        assert_eq!(source_of(r"src\main.rs:40"), "kehai");
    }

    #[test]
    fn fills_the_issue_form_by_its_field_ids() {
        let problem = Problem {
            at_ms: 0,
            src: "poller.update".into(),
            level: Level::Warn,
            what: "Checking for updates failed.".into(),
            then: None,
            detail: "no answer & more".into(),
            count: 3,
        };
        let text = report_text(
            "0.10.0",
            "Windows 11 Pro (build 26300)",
            "Layout: Panel",
            &[problem],
            true,
        );
        assert!(text.starts_with("Kehai 0.10.0, "));
        assert!(text.contains("Layout: Panel\n"));
        assert!(
            text.contains("warn poller.update  Checking for updates failed. (×3) no answer & more")
        );

        let url = issue_url("0.10.0", "Windows 11 Pro (build 26300)", &text).expect("a link");
        assert_eq!(url.host_str(), Some("github.com"));
        assert_eq!(url.path(), "/Purukitto/kehai/issues/new");
        let fields: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(fields["template"], "bug_report.yml");
        assert_eq!(fields["version"], "0.10.0");
        assert_eq!(fields["os"], "Windows 11 Pro (build 26300)");
        // An & in the text stays in the text rather than starting a field.
        assert_eq!(fields["logs"], text);
    }

    #[test]
    fn clips_on_a_character_boundary() {
        assert_eq!(clip("añb", 2), "añ…");
        assert_eq!(clip("ab", 2), "ab");
    }

    #[test]
    fn rotates_and_keeps_three() {
        let dir = std::env::temp_dir().join(format!("kehai-log-test-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap_or_default();
        for n in 0..4 {
            fs::write(path(&dir, 0), format!("{n}")).unwrap_or_default();
            rotate(&dir);
        }
        assert!(!path(&dir, 0).exists());
        assert_eq!(fs::read_to_string(path(&dir, 1)).unwrap_or_default(), "3");
        assert_eq!(fs::read_to_string(path(&dir, 2)).unwrap_or_default(), "2");
        assert!(!dir.join("kehai.3.log").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
