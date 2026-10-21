use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::utils::platform::bundle_type;
use tauri::{async_runtime, AppHandle, Listener, Url};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Error as UpdaterError, Update, Updater, UpdaterExt};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

use crate::bus;

const TOPIC: &str = "app:update";
const SRC: &str = "poller.update";

/// How long after launch the first automatic check waits. It keeps the request
/// out of startup, and gives the renderer time to say whether automatic checks
/// are on at all.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(60);
/// The panel can stay up for weeks, so checking only at launch would miss most
/// releases.
const AUTO_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
/// The plugin sets no timeout of its own, and a connection that hangs would
/// wedge this thread for good.
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);
/// Covers the whole transfer, not just the connect.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);
/// The chunk callback fires per network read; the renderer needs far fewer.
const PROGRESS_EVERY: Duration = Duration::from_millis(250);
/// Where a build that cannot install itself sends people instead.
const RELEASES_URL: &str = "https://github.com/Purukitto/kehai/releases/latest";
/// Points the check at another manifest, to exercise an install end to end
/// against a prerelease. Safe to honour in a release build: whatever it serves
/// must still be signed by the release key, for the version it claims, and be
/// newer than what is running.
const ENDPOINT_ENV: &str = "KEHAI_UPDATE_ENDPOINT";

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum State {
    /// No check has run yet.
    Idle,
    Checking,
    /// The last check found nothing newer.
    Current,
    Available,
    Downloading,
    /// The installer is running and this process is about to exit.
    Installing,
    /// The last check failed and nothing newer is known.
    Failed,
}

/// Mirrors `UpdatePayload` in `src/core/payloads.ts`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UpdatePayload {
    current: String,
    state: State,
    latest: Option<String>,
    notes: Option<String>,
    installable: bool,
    reason: Option<String>,
    progress: Option<f64>,
    checked_at_ms: Option<u64>,
    error: Option<String>,
    auto: bool,
}

/// Renderer → engine on `update:command`. Mirrors `UpdateCommand` in
/// `src/core/payloads.ts`. Nothing here names a URL or a path: where updates
/// come from, and the key they must be signed with, are compiled in.
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Command {
    Check,
    Install,
    SetAuto { on: bool },
    OpenRelease,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn publish(app: &AppHandle, payload: &UpdatePayload) {
    bus::publish(app, TOPIC, SRC, payload.clone());
}

/// Only an installed copy has an installer to hand over to. The bundler stamps
/// the installer type into the exe while it packages and restores the original
/// afterwards, so the portable zip — which ships that original — reports none,
/// as does a dev build.
fn installability() -> (bool, Option<String>) {
    if bundle_type().is_some() {
        (true, None)
    } else if cfg!(debug_assertions) {
        (
            false,
            Some("Development build. Only an installed copy can update itself.".into()),
        )
    } else {
        (
            false,
            Some("Portable build. New versions come from the release page.".into()),
        )
    }
}

/// The plugin's messages are written for whoever configured it. These are the
/// failures someone looking at the panel can do something about.
fn describe(err: &UpdaterError) -> String {
    match err {
        UpdaterError::Reqwest(_) | UpdaterError::Network(_) => "Could not reach GitHub.".into(),
        UpdaterError::ReleaseNotFound => "GitHub has no update information yet.".into(),
        UpdaterError::Minisign(_)
        | UpdaterError::SignedVersionMismatch { .. }
        | UpdaterError::MissingSignedVersion => {
            "The download did not carry a valid signature, so it was not installed.".into()
        }
        other => other.to_string(),
    }
}

fn updater(app: &AppHandle) -> tauri_plugin_updater::Result<Updater> {
    let mut builder = app.updater_builder().timeout(CHECK_TIMEOUT);
    if let Ok(endpoint) = std::env::var(ENDPOINT_ENV) {
        eprintln!("poller.update: checking {endpoint} instead of the release feed");
        builder = builder.endpoints(vec![Url::parse(&endpoint)?])?;
    }
    builder.build()
}

fn check(app: &AppHandle) -> tauri_plugin_updater::Result<Option<Update>> {
    async_runtime::block_on(updater(app)?.check())
}

/// Downloads, verifies and hands over to the installer. On Windows success
/// does not return: the plugin exits the process once the installer is
/// running, and the installer starts the new version when it is done.
fn install(
    app: &AppHandle,
    payload: &mut UpdatePayload,
    mut update: Update,
) -> Result<(), UpdaterError> {
    update.timeout = Some(DOWNLOAD_TIMEOUT);

    payload.state = State::Downloading;
    payload.progress = Some(0.0);
    payload.error = None;
    publish(app, payload);

    let mut received: u64 = 0;
    let mut last = Instant::now();
    let bytes = async_runtime::block_on(update.download(
        |chunk, total| {
            received += chunk as u64;
            if last.elapsed() >= PROGRESS_EVERY {
                last = Instant::now();
                // No length from the server means no percentage, not a made-up one.
                payload.progress = total
                    .filter(|t| *t > 0)
                    .map(|t| (received as f64 / t as f64).min(1.0));
                publish(app, payload);
            }
        },
        || {},
    ))?;

    payload.state = State::Installing;
    payload.progress = Some(1.0);
    publish(app, payload);

    // The plugin ends the process with `exit`, which skips the window-state
    // plugin's save on exit, and the new version would open wherever the window
    // was at launch rather than where it was left.
    if let Err(err) = app.save_window_state(StateFlags::all()) {
        eprintln!("poller.update: window state not saved: {err}");
    }

    update.install(bytes)?;

    // Only reachable off Windows, where the files are replaced in place but
    // this process is still the old version.
    app.restart();
}

pub fn spawn(app: AppHandle) {
    let (command_tx, command_rx) = mpsc::channel::<Command>();

    let commands = app.clone();
    commands.listen("update:command", move |event| {
        match serde_json::from_str::<Command>(event.payload()) {
            Ok(command) => {
                // The work happens on the poller thread, which this wakes. A
                // download takes far longer than an event handler should.
                let _ = command_tx.send(command);
            }
            Err(err) => eprintln!("poller.update: ignored a command: {err}"),
        }
    });

    thread::spawn(move || {
        let (installable, reason) = installability();
        let mut payload = UpdatePayload {
            current: app.package_info().version.to_string(),
            state: State::Idle,
            latest: None,
            notes: None,
            installable,
            reason,
            progress: None,
            checked_at_ms: None,
            error: None,
            // The renderer holds the setting and says so once its bridge is up.
            // Until then nothing goes out.
            auto: false,
        };
        publish(&app, &payload);
        eprintln!(
            "poller.update: running {}, {}",
            payload.current,
            if installable {
                "can self-install"
            } else {
                "cannot self-install"
            }
        );

        let mut pending: Option<Update> = None;
        let mut next_auto = Instant::now() + FIRST_CHECK_DELAY;

        loop {
            let wait = next_auto.saturating_duration_since(Instant::now());
            let command = match command_rx.recv_timeout(wait) {
                Ok(command) => command,
                Err(RecvTimeoutError::Timeout) => {
                    next_auto = Instant::now() + AUTO_INTERVAL;
                    if !payload.auto {
                        continue;
                    }
                    Command::Check
                }
                // Only if the listener is gone. Without the sleep this would spin.
                Err(RecvTimeoutError::Disconnected) => {
                    thread::sleep(AUTO_INTERVAL);
                    continue;
                }
            };

            match command {
                Command::Check => {
                    // A check by hand counts: the next automatic one is a full
                    // interval from now, not a few minutes later.
                    next_auto = Instant::now() + AUTO_INTERVAL;
                    payload.state = State::Checking;
                    publish(&app, &payload);

                    match check(&app) {
                        Ok(Some(update)) => {
                            eprintln!("poller.update: {} is available", update.version);
                            payload.state = State::Available;
                            payload.latest = Some(update.version.clone());
                            payload.notes = update.body.clone().filter(|n| !n.trim().is_empty());
                            payload.checked_at_ms = Some(now_ms());
                            payload.error = None;
                            pending = Some(update);
                        }
                        Ok(None) => {
                            payload.state = State::Current;
                            payload.latest = None;
                            payload.notes = None;
                            payload.checked_at_ms = Some(now_ms());
                            payload.error = None;
                            pending = None;
                        }
                        Err(err) => {
                            eprintln!("poller.update: check failed: {err}");
                            payload.error = Some(describe(&err));
                            // A failed check says nothing about a release already
                            // found. An offline morning should not hide it.
                            payload.state = if pending.is_some() {
                                State::Available
                            } else {
                                State::Failed
                            };
                        }
                    }
                    publish(&app, &payload);
                }

                Command::Install => {
                    let Some(update) = pending.clone() else {
                        eprintln!("poller.update: install asked for with nothing to install");
                        continue;
                    };
                    if !payload.installable {
                        eprintln!(
                            "poller.update: install asked for by a build that cannot install"
                        );
                        continue;
                    }

                    eprintln!("poller.update: installing {}", update.version);
                    if let Err(err) = install(&app, &mut payload, update) {
                        eprintln!("poller.update: install failed: {err}");
                        payload.state = State::Available;
                        payload.progress = None;
                        payload.error = Some(describe(&err));
                        publish(&app, &payload);
                    }
                }

                Command::SetAuto { on } => {
                    if on && !payload.auto {
                        // On launch this is the stored setting arriving; later it
                        // is the toggle. Either way the first check comes a minute
                        // from now, not a day after the last one.
                        next_auto = Instant::now() + FIRST_CHECK_DELAY;
                    }
                    payload.auto = on;
                    publish(&app, &payload);
                }

                Command::OpenRelease => {
                    if let Err(err) = app.opener().open_url(RELEASES_URL, None::<&str>) {
                        eprintln!("poller.update: release page did not open: {err}");
                    }
                }
            }
        }
    });
}
