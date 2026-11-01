//! Widget files you add yourself: `*.widget.json` in Kehai's widgets folder.
//!
//! The engine only hands their text to the local panel, which checks each one
//! the way it checks the widgets Kehai ships, and lists any it cannot load with
//! why. Nothing in a widget file is run. A file asking for a game's state still
//! needs SET UP before anything is written or listened for.

use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Listener, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::bus;
use crate::log;

/// Private to the local panel: it names a folder on this PC.
const TOPIC: &str = "widgets:local";
const SRC: &str = "widgets";
const FOLDER: &str = "widgets";
/// Checked this often, so a file dropped in shows without a restart.
const CHECK_EVERY: Duration = Duration::from_secs(5);
/// A widget's file is a page of text. Anything past these is listed, not read.
const MAX_FILES: usize = 64;
const MAX_BYTES: u64 = 64 * 1024;

/// Mirrors `LocalWidgetsPayload` in `src/core/payloads.ts`.
#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Payload {
    folder: String,
    files: Vec<File>,
}

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct File {
    name: String,
    /// The file as written, for the panel to check.
    text: Option<String>,
    /// Why it was not read.
    error: Option<String>,
}

/// Renderer → engine on `widgets:command`.
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Command {
    /// Show the folder, making it first if it is not there yet.
    Open,
}

fn scan(folder: &PathBuf) -> Vec<File> {
    let Ok(entries) = fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|e| Some(e.ok()?.path()))
        .filter(|p| p.is_file() && p.to_string_lossy().ends_with(".widget.json"))
        .collect();
    paths.sort();
    paths
        .iter()
        .enumerate()
        .map(|(i, path)| {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if i >= MAX_FILES {
                return File {
                    name,
                    text: None,
                    error: Some(format!("Only the first {MAX_FILES} files are read.")),
                };
            }
            let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            if size > MAX_BYTES {
                return File {
                    name,
                    text: None,
                    error: Some(format!(
                        "Larger than {} KB, which no widget file needs.",
                        MAX_BYTES / 1024
                    )),
                };
            }
            match fs::read_to_string(path) {
                Ok(text) => File {
                    name,
                    text: Some(text),
                    error: None,
                },
                Err(err) => File {
                    name,
                    text: None,
                    error: Some(format!("Could not be read: {err}")),
                },
            }
        })
        .collect()
}

pub fn spawn(app: AppHandle) {
    let Some(folder) = app.path().app_data_dir().ok().map(|d| d.join(FOLDER)) else {
        return;
    };
    let (tx, rx) = mpsc::channel::<Command>();
    app.listen("widgets:command", move |event| {
        match serde_json::from_str::<Command>(event.payload()) {
            Ok(command) => {
                let _ = tx.send(command);
            }
            Err(err) => log::warn(SRC, format!("ignored a command: {err}")),
        }
    });

    thread::spawn(move || {
        let mut last: Option<Payload> = None;
        loop {
            let next = Payload {
                folder: folder.display().to_string(),
                files: scan(&folder),
            };
            if last.as_ref() != Some(&next) {
                if !next.files.is_empty() {
                    log::info(
                        SRC,
                        format!("{} widget files in the folder", next.files.len()),
                    );
                }
                bus::publish(&app, TOPIC, SRC, next.clone());
                last = Some(next);
            }
            match rx.recv_timeout(CHECK_EVERY) {
                Ok(Command::Open) => {
                    if let Err(err) = fs::create_dir_all(&folder) {
                        log::warn(SRC, format!("could not make the widgets folder: {err}"));
                        continue;
                    }
                    if let Err(err) = app
                        .opener()
                        .open_path(folder.display().to_string(), None::<&str>)
                    {
                        log::warn(SRC, format!("the widgets folder did not open: {err}"));
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => thread::sleep(CHECK_EVERY),
            }
        }
    });
}
