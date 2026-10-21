//! What the pollers that read agent session transcripts share: which folder to
//! read, following each transcript as it grows, and the timestamps inside.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::{AppHandle, Listener};

/// How long the first read waits for the renderer to say which folder to use.
/// The renderer sends its choice once its bridge is up, which is after the
/// pollers start. Reading the default first would publish another folder's
/// figures, or its absence, only to replace them a second later.
pub const FIRST_ROOT_GRACE: Duration = Duration::from_millis(5_000);
/// `<root>/<project>/<session>/subagents/<agent>.jsonl` is three folders down.
/// Sub-agents draw on the same limit as the session that started them.
const MAX_DEPTH: usize = 3;

/// Mirrors `QuotaCommand` in `src/core/payloads.ts`. The folder is kept in the
/// renderer's settings, so this is the only way the engine learns it.
#[derive(Deserialize)]
struct Command {
    action: String,
    /// `None` means the default location.
    path: Option<String>,
}

/// Every folder the renderer picks, as it picks it. `None` is the default.
///
/// Each poller that reads transcripts asks for its own, so a slow tally in one
/// cannot hold up the other.
pub fn chosen_roots(app: &AppHandle) -> Receiver<Option<PathBuf>> {
    let (tx, rx) = mpsc::channel();
    app.listen("quota:command", move |event| {
        let Ok(cmd) = serde_json::from_str::<Command>(event.payload()) else {
            return;
        };
        if cmd.action != "set_root" {
            return;
        }
        let path = cmd.path.filter(|p| !p.trim().is_empty()).map(PathBuf::from);
        // The read itself happens on the poller thread, which this wakes; a
        // folder with a lot of recent transcripts takes a while to tally.
        let _ = tx.send(path);
    });
    rx
}

/// What has been read of one transcript, and what its lines have added up to.
#[derive(Default)]
pub struct Tail<T> {
    read_to: u64,
    /// Reading started partway into the file, so the first line is a fragment.
    mid_line: bool,
    pub modified_ms: i64,
    pub state: T,
}

impl<T: Default> Tail<T> {
    fn starting(len: u64, first_read: Option<u64>) -> Self {
        let read_to = first_read.map_or(0, |n| len.saturating_sub(n));
        Self {
            read_to,
            mid_line: read_to > 0,
            ..Self::default()
        }
    }
}

/// Every transcript being followed, for one folder. Transcripts only ever
/// grow, so each pass reads on from where the last one stopped instead of from
/// the top.
pub struct Transcripts<T> {
    root: PathBuf,
    first_read: Option<u64>,
    files: HashMap<PathBuf, Tail<T>>,
}

impl<T: Default> Transcripts<T> {
    /// `first_read` is how much of a transcript seen for the first time is
    /// read, from its end, for a poller that only cares how it ends. `None`
    /// reads the whole of it.
    pub fn new(first_read: Option<u64>) -> Self {
        Self {
            root: PathBuf::new(),
            first_read,
            files: HashMap::new(),
        }
    }

    /// Follows the transcripts under `root` from now on, forgetting anything
    /// read from another folder.
    pub fn point_at(&mut self, root: &Path) {
        if self.root != root {
            self.root = root.to_path_buf();
            self.files.clear();
        }
    }

    /// Brings every transcript changed since `since` up to date, and forgets
    /// the rest. False when there is not a single transcript, however old.
    pub fn collect(&mut self, since: i64, mut on_line: impl FnMut(&mut T, &str)) -> bool {
        let mut found = Vec::new();
        walk(&self.root, 0, &mut found);
        if found.is_empty() {
            self.files.clear();
            return false;
        }

        let mut live = HashSet::new();
        for (path, modified, len) in found {
            if modified < since {
                continue;
            }
            let first_read = self.first_read;
            let tail = self
                .files
                .entry(path.clone())
                .or_insert_with(|| Tail::starting(len, first_read));
            tail.modified_ms = modified;
            follow(&path, len, tail, &mut on_line);
            live.insert(path);
        }
        self.files.retain(|path, _| live.contains(path));
        true
    }

    pub fn files(&self) -> impl Iterator<Item = (&Path, &Tail<T>)> {
        self.files.iter().map(|(path, tail)| (path.as_path(), tail))
    }

    pub fn states_mut(&mut self) -> impl Iterator<Item = &mut T> {
        self.files.values_mut().map(|tail| &mut tail.state)
    }
}

/// Every `.jsonl` under `dir`, with when it last changed and how long it is.
fn walk(dir: &Path, depth: usize, out: &mut Vec<(PathBuf, i64, u64)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let path = entry.path();
        if meta.is_dir() {
            if depth < MAX_DEPTH {
                walk(&path, depth + 1, out);
            }
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            out.push((path, modified_ms(&meta), meta.len()));
        }
    }
}

/// Reads whatever has been appended since the last pass. A line still being
/// written has no newline yet and is left for next time, rather than parsed
/// half-finished and then skipped as already read.
fn follow<T: Default, F: FnMut(&mut T, &str)>(
    path: &Path,
    len: u64,
    tail: &mut Tail<T>,
    on_line: &mut F,
) {
    if len < tail.read_to {
        // Shorter than what was read: rewritten, not appended to.
        *tail = Tail {
            modified_ms: tail.modified_ms,
            ..Tail::default()
        };
    }
    if len == tail.read_to {
        return;
    }

    let Ok(mut file) = File::open(path) else {
        return;
    };
    if file.seek(SeekFrom::Start(tail.read_to)).is_err() {
        return;
    }

    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    loop {
        line.clear();
        let Ok(n) = reader.read_until(b'\n', &mut line) else {
            return;
        };
        if n == 0 || line.last() != Some(&b'\n') {
            return;
        }
        tail.read_to += n as u64;
        if tail.mid_line {
            tail.mid_line = false;
            continue;
        }
        on_line(&mut tail.state, &String::from_utf8_lossy(&line));
    }
}

/// Minimal RFC 3339 reader for the shape these transcripts use, so the pollers
/// do not pull in a date library for one field.
pub fn parse_iso(s: &str) -> Option<i64> {
    let bytes = s.as_bytes();
    if bytes.len() < 19 {
        return None;
    }

    let part = |from: usize, to: usize| s.get(from..to)?.parse::<i64>().ok();

    let year = part(0, 4)?;
    let month = part(5, 7)?;
    let day = part(8, 10)?;
    let hour = part(11, 13)?;
    let min = part(14, 16)?;
    let sec = part(17, 19)?;

    let millis = s
        .get(20..23)
        .and_then(|m| m.parse::<i64>().ok())
        .filter(|_| bytes.get(19) == Some(&b'.'))
        .unwrap_or(0);

    Some(
        (days_from_civil(year, month, day) * 86_400 + hour * 3600 + min * 60 + sec) * 1000 + millis,
    )
}

/// Howard Hinnant's civil-date algorithm: days since the Unix epoch.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn modified_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The directory the pollers read, or a reason the widgets can show the user.
/// The path is worth carrying into the failure: it is the one piece of
/// information that explains what is missing.
pub fn transcript_root(chosen: Option<&Path>) -> Result<PathBuf, String> {
    let root = match chosen {
        // A relative path would resolve against wherever the app was launched
        // from, and read a different folder depending on how it was started.
        Some(path) if !path.is_absolute() => {
            return Err(format!("{} is not an absolute path", path.display()));
        }
        Some(path) => path.to_path_buf(),
        None => {
            let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))
            else {
                return Err("no home directory in the environment".to_string());
            };
            PathBuf::from(home).join(".claude").join("projects")
        }
    };

    if root.is_dir() {
        Ok(root)
    } else if root.exists() {
        Err(format!("{} is not a folder", root.display()))
    } else {
        Err(format!(
            "no agent session transcripts at {}",
            root.display()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn reads_timestamps_with_and_without_millis() {
        assert_eq!(parse_iso("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso("1970-01-01T00:00:01.250Z"), Some(1_250));
        assert_eq!(
            parse_iso("2026-10-21T09:30:00.000Z"),
            Some(1_792_575_000_000)
        );
        assert_eq!(parse_iso("2000-02-29T12:00:00Z"), Some(951_825_600_000));
        assert_eq!(parse_iso("not a time"), None);
    }

    /// A file of its own under the system temp folder, removed when dropped.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "kehai-transcripts-{}-{name}.jsonl",
                std::process::id()
            ));
            let _ = fs::remove_file(&path);
            Self(path)
        }

        fn append(&self, text: &str) -> u64 {
            let mut file = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.0)
                .expect("scratch file opens");
            file.write_all(text.as_bytes())
                .expect("scratch file writes");
            fs::metadata(&self.0).expect("scratch file exists").len()
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }

    fn lines(tail: &mut Tail<Vec<String>>, path: &Path, len: u64) {
        follow(
            path,
            len,
            tail,
            &mut |seen: &mut Vec<String>, line: &str| seen.push(line.trim_end().to_string()),
        );
    }

    #[test]
    fn leaves_a_half_written_line_for_next_time() {
        let file = Scratch::new("partial");
        let mut tail = Tail::<Vec<String>>::default();

        let len = file.append("one\ntw");
        lines(&mut tail, &file.0, len);
        assert_eq!(tail.state, ["one"]);

        let len = file.append("o\nthree\n");
        lines(&mut tail, &file.0, len);
        assert_eq!(tail.state, ["one", "two", "three"]);
    }

    #[test]
    fn starts_over_when_a_file_is_rewritten() {
        let file = Scratch::new("rewritten");
        let mut tail = Tail::<Vec<String>>::default();

        let len = file.append("first\nsecond\n");
        lines(&mut tail, &file.0, len);

        fs::write(&file.0, "new\n").expect("scratch file rewrites");
        lines(&mut tail, &file.0, 4);
        assert_eq!(tail.state, ["new"]);
    }

    #[test]
    fn a_first_read_from_the_end_skips_the_cut_line() {
        let file = Scratch::new("window");
        let len = file.append("aaaaaaaaaa\nbbbbbbbbbb\ncc\n");
        // Starts partway into the b line, which is a fragment from there.
        let mut tail = Tail::<Vec<String>>::starting(len, Some(8));
        lines(&mut tail, &file.0, len);
        assert_eq!(tail.state, ["cc"]);
    }
}
