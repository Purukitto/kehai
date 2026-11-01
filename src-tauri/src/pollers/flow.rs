use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Listener, Manager};

use crate::bus;
use crate::log;

const TOPIC: &str = "flow:pomodoro";
const SRC: &str = "poller.flow";

/// How long the first publish waits for the renderer to say how long a sprint
/// is. Publishing the defaults first would show 25:00 to someone who chose 50,
/// and correct it a second later.
const FIRST_CONFIG_GRACE: Duration = Duration::from_millis(3_000);
/// Nothing counts down while idle or paused, but today still has to become
/// tomorrow for the daily total to reset.
const IDLE_WAKE: Duration = Duration::from_secs(30);
/// A running timer ticks every second. A gap this long between two ticks means
/// the machine slept, and time spent asleep is not time spent focusing.
const SLEPT_AFTER_MS: i64 = 15_000;
/// While a focus block runs, today's total is written this often, so quitting
/// or a crash loses at most this much of it.
const SAVE_EVERY_MS: i64 = 60_000;
const STORE_FILE: &str = "flow.json";

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum State {
    /// Waiting to be started. The countdown shows the full block.
    Idle,
    Running,
    Paused,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Mode {
    Focus,
    Break,
}

/// Mirrors `SprintPayload` in `src/core/payloads.ts`.
#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SprintPayload {
    state: State,
    mode: Mode,
    remaining_sec: u64,
    /// The length of the block on screen, which is not always the configured
    /// one: a changed setting applies from the next block, not mid-countdown.
    length_sec: u64,
    /// Which focus block this is, or which one the break follows. 1-based.
    index: u32,
    total: u32,
    focused_today_sec: u64,
}

/// Renderer → engine on `flow:command`. Mirrors `FlowCommand` in
/// `src/core/payloads.ts`. Start and pause are separate rather than one toggle,
/// so a command that arrives twice cannot undo itself.
#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum Command {
    Start,
    Pause,
    /// Ends the current block now, as if it had run out.
    Skip,
    /// Back to the first focus block. Today's total is history and stays.
    Reset,
    Configure {
        focus_min: u64,
        break_min: u64,
        sprints: u32,
    },
}

/// Today's total as written to disk. The countdown itself is not kept: a
/// timer that was running when the app closed has not been running since.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    day: String,
    focused_ms: i64,
}

struct Config {
    focus_ms: i64,
    break_ms: i64,
    sprints: u32,
}

impl Config {
    fn length(&self, mode: Mode) -> i64 {
        match mode {
            Mode::Focus => self.focus_ms,
            Mode::Break => self.break_ms,
        }
    }
}

struct Timer {
    config: Config,
    state: State,
    mode: Mode,
    index: u32,
    /// Fixed when the block began.
    length_ms: i64,
    /// While running, when the block ends. Kept as a wall-clock instant rather
    /// than decremented per tick, so a late tick cannot make the timer drift.
    deadline_ms: i64,
    /// While idle or paused, what is left of the block.
    left_ms: i64,
    /// The last time a running timer was looked at.
    last_tick_ms: i64,
    day: String,
    focused_ms: i64,
}

impl Timer {
    fn new(stored: Option<Stored>) -> Self {
        let config = Config {
            focus_ms: 25 * 60_000,
            break_ms: 5 * 60_000,
            sprints: 4,
        };
        let day = today();
        let focused_ms = stored
            .filter(|s| s.day == day)
            .map(|s| s.focused_ms.max(0))
            .unwrap_or(0);
        Self {
            state: State::Idle,
            mode: Mode::Focus,
            index: 1,
            length_ms: config.focus_ms,
            deadline_ms: 0,
            left_ms: config.focus_ms,
            last_tick_ms: 0,
            config,
            day,
            focused_ms,
        }
    }

    /// Brings the timer up to `now`: banks focus time, notices sleep, and ends
    /// a block that has run out. Everything else calls this first.
    fn advance(&mut self, now: i64) {
        let day = today();
        if day != self.day {
            self.day = day;
            self.focused_ms = 0;
        }

        if self.state != State::Running {
            return;
        }

        let delta = now - self.last_tick_ms;
        if delta < 0 {
            // The clock was set back. The block keeps the time it had left
            // rather than growing by however far the clock moved.
            self.deadline_ms += delta;
            self.last_tick_ms = now;
            return;
        }
        if delta > SLEPT_AFTER_MS {
            // Stop where it was when the machine went to sleep. Waking to a
            // block that finished unattended would count the nap as focus.
            self.left_ms = (self.deadline_ms - self.last_tick_ms).max(0);
            self.state = State::Paused;
            log::info(
                "poller.flow",
                format!("paused after a {} s gap", delta / 1000),
            );
            return;
        }

        if self.mode == Mode::Focus {
            self.focused_ms += (now.min(self.deadline_ms) - self.last_tick_ms).max(0);
        }
        self.last_tick_ms = now;

        if now >= self.deadline_ms {
            self.finish(now, true);
        }
    }

    /// Moves on to the next block. A break follows straight on from a focus
    /// block that was running; the next focus block always waits to be started,
    /// because the timer cannot know you are back.
    fn finish(&mut self, now: i64, running: bool) {
        match self.mode {
            Mode::Focus => {
                self.mode = Mode::Break;
                self.length_ms = self.config.break_ms;
                if running {
                    self.run(now, self.length_ms);
                } else {
                    self.idle();
                }
            }
            Mode::Break => {
                self.mode = Mode::Focus;
                self.index = if self.index >= self.config.sprints {
                    1
                } else {
                    self.index + 1
                };
                self.length_ms = self.config.focus_ms;
                self.idle();
            }
        }
    }

    fn run(&mut self, now: i64, left_ms: i64) {
        self.state = State::Running;
        self.deadline_ms = now + left_ms;
        self.last_tick_ms = now;
    }

    fn idle(&mut self) {
        self.state = State::Idle;
        self.left_ms = self.length_ms;
    }

    fn apply(&mut self, command: Command, now: i64) {
        self.advance(now);

        match command {
            Command::Start => {
                if self.state != State::Running {
                    self.run(now, self.left_ms);
                }
            }
            Command::Pause => {
                if self.state == State::Running {
                    self.left_ms = (self.deadline_ms - now).max(0);
                    self.state = State::Paused;
                }
            }
            Command::Skip => {
                let running = self.state == State::Running;
                self.finish(now, running);
            }
            Command::Reset => {
                self.mode = Mode::Focus;
                self.index = 1;
                self.length_ms = self.config.focus_ms;
                self.idle();
            }
            Command::Configure {
                focus_min,
                break_min,
                sprints,
            } => {
                self.config = Config {
                    focus_ms: focus_min.clamp(1, 180) as i64 * 60_000,
                    break_ms: break_min.clamp(1, 60) as i64 * 60_000,
                    sprints: sprints.clamp(1, 12),
                };
                self.index = self.index.min(self.config.sprints);
                // A block in progress keeps its length. One not yet started
                // takes the new one, or the countdown would show a stale number.
                if self.state == State::Idle {
                    self.length_ms = self.config.length(self.mode);
                    self.left_ms = self.length_ms;
                }
            }
        }
    }

    fn remaining_ms(&self, now: i64) -> i64 {
        match self.state {
            State::Running => (self.deadline_ms - now).max(0),
            State::Idle | State::Paused => self.left_ms,
        }
    }

    fn payload(&self, now: i64) -> SprintPayload {
        SprintPayload {
            state: self.state,
            mode: self.mode,
            // Rounded up, so a fresh block reads 25:00 rather than 24:59 and
            // 00:00 only shows once it has actually run out.
            remaining_sec: (self.remaining_ms(now).max(0) as u64).div_ceil(1000),
            length_sec: (self.length_ms / 1000) as u64,
            index: self.index,
            total: self.config.sprints,
            focused_today_sec: (self.focused_ms / 1000) as u64,
        }
    }

    /// Until the displayed second next changes, a hair late so the rounding
    /// has flipped by the time it is read.
    fn wait(&self, now: i64) -> Duration {
        if self.state != State::Running {
            return IDLE_WAKE;
        }
        let left = self.remaining_ms(now);
        let to_next = if left <= 0 { 0 } else { (left - 1) % 1000 + 1 };
        Duration::from_millis(to_next as u64 + 5)
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The local calendar day. "Today" is the one on the wall, not UTC's.
fn today() -> String {
    chrono::Local::now().date_naive().to_string()
}

fn store_path(app: &AppHandle) -> Option<PathBuf> {
    match app.path().app_data_dir() {
        Ok(dir) => Some(dir.join(STORE_FILE)),
        Err(err) => {
            log::warn(
                "poller.flow",
                format!("no app data folder, today's total will not survive a restart: {err}"),
            );
            None
        }
    }
}

fn load(path: &Path) -> Option<Stored> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Written beside itself and renamed into place, so a crash mid-write leaves
/// yesterday's file rather than half of today's.
fn save(path: &Path, timer: &Timer) {
    let stored = Stored {
        day: timer.day.clone(),
        focused_ms: timer.focused_ms,
    };
    let Ok(text) = serde_json::to_string(&stored) else {
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
            "poller.flow",
            "Could not save today's focus total.",
            Some("A restart would start today's count again."),
            err,
        );
    }
}

pub fn spawn(app: AppHandle) {
    let (command_tx, command_rx) = mpsc::channel::<Command>();

    let commands = app.clone();
    commands.listen("flow:command", move |event| {
        match serde_json::from_str::<Command>(event.payload()) {
            Ok(command) => {
                let _ = command_tx.send(command);
            }
            Err(err) => log::warn("poller.flow", format!("ignored a command: {err}")),
        }
    });

    thread::spawn(move || {
        let store = store_path(&app);
        let mut timer = Timer::new(store.as_deref().and_then(load));
        log::info(
            "poller.flow",
            format!("{} s focused today so far", timer.focused_ms / 1000),
        );

        // The renderer sends its sprint lengths once its bridge is up. Whatever
        // arrives first — usually that, possibly a click — is applied before
        // anything is shown.
        if let Ok(command) = command_rx.recv_timeout(FIRST_CONFIG_GRACE) {
            timer.apply(command, now_ms());
        }

        let mut last: Option<SprintPayload> = None;
        let mut saved = (timer.day.clone(), timer.focused_ms);
        let mut saved_at = now_ms();

        loop {
            let now = now_ms();
            timer.advance(now);

            let payload = timer.payload(now);
            if last.as_ref() != Some(&payload) {
                bus::publish(&app, TOPIC, SRC, payload.clone());
                last = Some(payload);
            }

            // Every second while focusing would be a write a second for a
            // number that only matters across a restart. Once a block stops,
            // though, there is no reason to wait.
            let unsaved = saved != (timer.day.clone(), timer.focused_ms);
            if unsaved && (timer.state != State::Running || now - saved_at >= SAVE_EVERY_MS) {
                if let Some(path) = &store {
                    save(path, &timer);
                }
                saved = (timer.day.clone(), timer.focused_ms);
                saved_at = now;
            }

            match command_rx.recv_timeout(timer.wait(now)) {
                Ok(command) => {
                    timer.apply(command, now_ms());
                    // Several clicks queued behind each other all count, in order.
                    for command in command_rx.try_iter() {
                        timer.apply(command, now_ms());
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                // Only if the listener is gone. Without the sleep this would spin.
                Err(RecvTimeoutError::Disconnected) => thread::sleep(IDLE_WAKE),
            }
        }
    });
}
