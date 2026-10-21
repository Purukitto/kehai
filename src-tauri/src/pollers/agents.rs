use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::mpsc::RecvTimeoutError;
use std::thread;
use std::time::Duration;

use serde::de::{SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use tauri::AppHandle;

use super::transcripts::{self, now_ms, parse_iso, transcript_root, Transcripts};
use crate::bus;

/// How often the transcripts already followed are read on. An agent that has
/// stopped to wait should say so about as soon as a glance would catch it.
const TICK: Duration = Duration::from_millis(2_000);
/// The folder is walked once in this many ticks, which is how a new session
/// is found. Walking every tick would stat every transcript ever kept.
const WALK_EVERY: u32 = 5;
/// A session nothing has been written to for this long is left off the list.
const RECENT_MS: i64 = 60 * 60 * 1000;
/// A sub-agent this quiet is taken to be gone, whatever its last line says:
/// one cut off mid-task never writes another.
const SUBAGENT_QUIET_MS: i64 = 10 * 60 * 1000;
/// How much of a transcript is read the first time it is seen. Only how it
/// ends decides its state, and a long session runs to tens of megabytes.
const FIRST_READ_BYTES: u64 = 1024 * 1024;

/// Mirrors `AgentsPayload` in `src/core/payloads.ts`.
#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentsPayload {
    /// False when there is nothing to read — not the same as no sessions.
    pub available: bool,
    pub reason: Option<String>,
    /// The ones waiting on you first, longest-waiting first within each state.
    pub sessions: Vec<AgentSession>,
}

impl AgentsPayload {
    fn unavailable(reason: String) -> Self {
        Self {
            available: false,
            reason: Some(reason),
            sessions: Vec::new(),
        }
    }
}

/// Mirrors `AgentSession` in `src/core/payloads.ts`.
#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    /// The transcript's name, which is the session's id.
    pub id: String,
    /// The folder the agent works in, or the repository a worktree belongs to.
    pub project: String,
    pub worktree: Option<String>,
    pub state: State,
    /// When it entered `state`: the prompt that started the turn, the oldest
    /// tool call still unanswered, or the line that stopped it.
    pub since_ms: i64,
    /// Sub-agents it started that are still at work.
    pub subagents: u32,
}

/// Declared in the order the list sorts in: whatever needs you first.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
#[serde(rename_all = "snake_case")]
pub enum State {
    /// Stopped on an error from the provider.
    Error,
    /// Finished, interrupted, or told no at a tool prompt. The next move is yours.
    Waiting,
    /// Called a tool that has not returned. A permission prompt looks exactly
    /// like this — nothing is written until it is answered — so the state
    /// never claims to be one.
    Tool,
    /// The model's turn.
    Working,
}

/// What one transcript's lines add up to so far.
#[derive(Default)]
struct Session {
    cwd: Option<String>,
    /// When the turn under way began, if its prompt was among the lines read.
    turn_from: Option<i64>,
    /// The first line read, standing in for `turn_from` when the prompt came
    /// before the part of a long transcript that was read.
    first_ms: Option<i64>,
    /// Tool calls made and not yet answered, by id, with when.
    pending: HashMap<String, i64>,
    stopped: Option<(State, i64)>,
}

/// One transcript line, reduced to what says whose turn it is.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    #[serde(rename = "type")]
    kind: String,
    timestamp: Option<String>,
    cwd: Option<String>,
    #[serde(default)]
    is_meta: bool,
    #[serde(default)]
    is_api_error_message: bool,
    tool_denial_kind: Option<String>,
    message: Option<Message>,
}

#[derive(Deserialize)]
struct Message {
    stop_reason: Option<String>,
    #[serde(default, deserialize_with = "blocks")]
    content: Vec<Block>,
}

/// Which tool call is which, and nothing else. Text, tool input and results
/// are passed over by the parser and never kept.
#[derive(Deserialize)]
struct Block {
    #[serde(rename = "type")]
    kind: String,
    id: Option<String>,
    tool_use_id: Option<String>,
}

/// A prompt typed as plain text is a string rather than a list of blocks. It
/// is skipped, not kept.
fn blocks<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<Block>, D::Error> {
    struct Blocks;

    impl<'de> Visitor<'de> for Blocks {
        type Value = Vec<Block>;

        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            f.write_str("a string or a list of content blocks")
        }

        fn visit_str<E>(self, _: &str) -> Result<Self::Value, E> {
            Ok(Vec::new())
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E> {
            Ok(Vec::new())
        }

        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
            let mut out = Vec::new();
            while let Some(block) = seq.next_element()? {
                out.push(block);
            }
            Ok(out)
        }
    }

    deserializer.deserialize_any(Blocks)
}

impl Session {
    fn read(&mut self, line: &str) {
        // Most lines are neither side of the conversation: snapshots, titles,
        // hook reports. A substring test is far cheaper than parsing them.
        if !line.contains(r#""type":"user""#) && !line.contains(r#""type":"assistant""#) {
            return;
        }
        let Ok(record) = serde_json::from_str::<Record>(line) else {
            return;
        };
        let Some(at) = record.timestamp.as_deref().and_then(parse_iso) else {
            return;
        };
        if record.cwd.is_some() {
            self.cwd = record.cwd;
        }
        self.first_ms.get_or_insert(at);
        let Some(message) = record.message else {
            return;
        };

        match record.kind.as_str() {
            // Meta lines are the agent's own notes in the user's place, not
            // anything the user did.
            "user" if !record.is_meta => {
                let mut answered = false;
                for block in message.content.iter().filter(|b| b.kind == "tool_result") {
                    answered = true;
                    if let Some(id) = &block.tool_use_id {
                        self.pending.remove(id);
                    }
                }
                if answered {
                    // Told no at the prompt: the agent stops and asks what to
                    // do instead. Any other refusal it works around by itself.
                    if record.tool_denial_kind.as_deref() == Some("user-rejected") {
                        self.stop(State::Waiting, at);
                    } else {
                        self.stopped = None;
                    }
                } else if line.contains("[Request interrupted by user") || ran_locally(line) {
                    // Nothing answers either, so the session waits from here,
                    // or from when it stopped if it already had.
                    if self.stopped.is_none() {
                        self.stop(State::Waiting, at);
                    }
                } else {
                    self.turn_from = Some(at);
                    self.pending.clear();
                    self.stopped = None;
                }
            }
            "assistant" if record.is_api_error_message => self.stop(State::Error, at),
            "assistant" => {
                self.stopped = None;
                for block in &message.content {
                    if let ("tool_use", Some(id)) = (block.kind.as_str(), &block.id) {
                        self.pending.insert(id.clone(), at);
                    }
                }
                // Every line of a reply carries the reply's stop reason.
                if let Some("end_turn" | "stop_sequence" | "refusal") =
                    message.stop_reason.as_deref()
                {
                    self.stop(State::Waiting, at);
                }
            }
            _ => {}
        }
    }

    fn stop(&mut self, state: State, at: i64) {
        self.stopped = Some((state, at));
        self.pending.clear();
    }

    /// Where it stands, and since when. `None` before anything readable.
    fn state(&self) -> Option<(State, i64)> {
        if let Some(stopped) = self.stopped {
            return Some(stopped);
        }
        if let Some(&oldest) = self.pending.values().min() {
            return Some((State::Tool, oldest));
        }
        self.turn_from
            .or(self.first_ms)
            .map(|at| (State::Working, at))
    }
}

/// A slash command or shell escape the agent's own front end ran, which no
/// reply follows. A command that becomes a prompt opens with
/// `<command-message>` instead, and counts as one.
///
/// This and the interrupt marker are the agent's text written in the user's
/// place, matched rather than read.
fn ran_locally(line: &str) -> bool {
    [
        r#"":"<command-name>"#,
        r#"":"<local-command-"#,
        r#"":"<bash-"#,
    ]
    .iter()
    .any(|marker| line.contains(marker))
}

pub fn spawn(app: AppHandle) {
    let chosen_rx = transcripts::chosen_roots(&app);

    thread::spawn(move || {
        let mut chosen = chosen_rx
            .recv_timeout(transcripts::FIRST_ROOT_GRACE)
            .ok()
            .flatten();
        let mut followed = Transcripts::new(Some(FIRST_READ_BYTES));
        let mut unavailable: Option<String> = None;
        let mut last: Option<AgentsPayload> = None;
        let mut last_said = String::new();
        let mut tick = 0u32;

        loop {
            let now = now_ms();
            if tick % WALK_EVERY == 0 {
                let walked = walk(chosen.as_deref(), &mut followed, now);
                let said = match &walked {
                    Ok(root) => format!("following transcripts in {}", root.display()),
                    Err(reason) => reason.clone(),
                };
                if said != last_said {
                    eprintln!("poller.agents: {said}");
                    last_said = said;
                }
                unavailable = walked.err();
            } else if unavailable.is_none() {
                followed.refresh(Session::read);
            }

            let payload = match &unavailable {
                Some(reason) => AgentsPayload::unavailable(reason.clone()),
                None => AgentsPayload {
                    available: true,
                    reason: None,
                    sessions: summarise(&followed, now),
                },
            };
            // Times in it are absolute, so an unchanged list needs no resend:
            // the bus retains the last one for whoever attaches later.
            if last.as_ref() != Some(&payload) {
                bus::publish(&app, "dev:agents", "poller.agents", payload.clone());
                last = Some(payload);
            }

            tick = tick.wrapping_add(1);
            match chosen_rx.recv_timeout(TICK) {
                Ok(path) => {
                    chosen = chosen_rx.try_iter().last().unwrap_or(path);
                    // A new folder is walked straight away.
                    tick = 0;
                }
                Err(RecvTimeoutError::Timeout) => {}
                // Only if the listener is gone. Without the sleep this would spin.
                Err(RecvTimeoutError::Disconnected) => thread::sleep(TICK),
            }
        }
    });
}

fn walk(
    chosen: Option<&Path>,
    followed: &mut Transcripts<Session>,
    now: i64,
) -> Result<PathBuf, String> {
    let root = transcript_root(chosen)?;
    followed.point_at(&root);
    if followed.collect(now - RECENT_MS, Session::read) {
        Ok(root)
    } else {
        Err(format!(
            "no agent session transcripts at {}",
            root.display()
        ))
    }
}

fn summarise(followed: &Transcripts<Session>, now: i64) -> Vec<AgentSession> {
    let mut busy: HashMap<String, u32> = HashMap::new();
    let mut sessions = Vec::new();

    for (path, tail) in followed.files() {
        let Some((state, since_ms)) = tail.state.state() else {
            continue;
        };
        if let Some(parent) = started_by(path) {
            let at_work = matches!(state, State::Tool | State::Working);
            if at_work && now - tail.modified_ms < SUBAGENT_QUIET_MS {
                *busy.entry(parent).or_default() += 1;
            }
            continue;
        }
        if now - tail.modified_ms > RECENT_MS {
            continue;
        }
        let Some(id) = path.file_stem().map(|s| s.to_string_lossy().into_owned()) else {
            continue;
        };
        let (project, worktree) = place(tail.state.cwd.as_deref(), path);
        sessions.push(AgentSession {
            id,
            project,
            worktree,
            state,
            since_ms,
            subagents: 0,
        });
    }

    for session in &mut sessions {
        session.subagents = busy.get(&session.id).copied().unwrap_or(0);
    }
    sessions.sort_by_key(|s| (s.state, s.since_ms));
    sessions
}

/// The session a sub-agent's transcript belongs to:
/// `<project>/<session>/subagents/<agent>.jsonl`.
fn started_by(path: &Path) -> Option<String> {
    let folder = path.parent()?;
    if folder.file_name()? != "subagents" {
        return None;
    }
    Some(folder.parent()?.file_name()?.to_string_lossy().into_owned())
}

/// Names a session for where it works. A worktree kept inside its repository,
/// under a hidden folder's `worktrees`, is named for the repository with the
/// worktree beside it: a list of worktree names alone would not say which
/// project each belongs to.
fn place(cwd: Option<&str>, transcript: &Path) -> (String, Option<String>) {
    let Some(cwd) = cwd else {
        // The transcript's folder is the working folder with its separators
        // flattened. Better than nothing.
        let folder = transcript
            .parent()
            .and_then(|p| p.file_name())
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        return (folder, None);
    };

    let parts: Vec<&str> = cwd.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    if let Some(i) = parts.iter().rposition(|p| *p == "worktrees") {
        if i >= 2 && parts[i - 1].starts_with('.') && i + 1 < parts.len() {
            return (parts[i - 2].to_string(), Some(parts[i + 1].to_string()));
        }
    }
    (parts.last().copied().unwrap_or(cwd).to_string(), None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(at: &str, content: &str) -> String {
        format!(
            r#"{{"type":"user","timestamp":"{at}","cwd":"/src/kehai","message":{{"role":"user","content":{content}}}}}"#
        )
    }

    fn assistant(at: &str, stop: &str, content: &str) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{at}","message":{{"role":"assistant","stop_reason":"{stop}","content":{content}}}}}"#
        )
    }

    fn after(lines: &[String]) -> Option<(State, i64)> {
        let mut session = Session::default();
        for line in lines {
            session.read(line);
        }
        session.state()
    }

    const T0: &str = "2026-10-21T10:00:00.000Z";
    const T1: &str = "2026-10-21T10:00:05.000Z";
    const T2: &str = "2026-10-21T10:00:09.000Z";
    const T3: &str = "2026-10-21T10:00:12.000Z";

    fn at(s: &str) -> i64 {
        parse_iso(s).expect("test timestamps parse")
    }

    #[test]
    fn a_prompt_starts_a_working_turn() {
        assert_eq!(
            after(&[user(T0, r#""fix the build""#)]),
            Some((State::Working, at(T0)))
        );
    }

    #[test]
    fn a_tool_call_is_pending_until_its_result_arrives() {
        let call = assistant(
            T1,
            "tool_use",
            r#"[{"type":"tool_use","id":"a","name":"Bash","input":{}}]"#,
        );
        let result = user(
            T2,
            r#"[{"type":"tool_result","tool_use_id":"a","content":"ok"}]"#,
        );

        assert_eq!(
            after(&[user(T0, r#""go""#), call.clone()]),
            Some((State::Tool, at(T1)))
        );
        assert_eq!(
            after(&[user(T0, r#""go""#), call, result]),
            Some((State::Working, at(T0)))
        );
    }

    #[test]
    fn parallel_calls_wait_on_the_oldest_unanswered() {
        let lines = [
            user(T0, r#""go""#),
            assistant(T1, "tool_use", r#"[{"type":"tool_use","id":"a"}]"#),
            assistant(T2, "tool_use", r#"[{"type":"tool_use","id":"b"}]"#),
            user(T3, r#"[{"type":"tool_result","tool_use_id":"a"}]"#),
        ];
        assert_eq!(after(&lines), Some((State::Tool, at(T2))));
    }

    #[test]
    fn a_finished_reply_waits_on_you() {
        let lines = [
            user(T0, r#""go""#),
            assistant(T1, "end_turn", r#"[{"type":"thinking"}]"#),
            assistant(T1, "end_turn", r#"[{"type":"text","text":"done"}]"#),
        ];
        assert_eq!(after(&lines), Some((State::Waiting, at(T1))));
    }

    #[test]
    fn an_interrupt_waits_on_you() {
        let lines = [
            user(T0, r#""go""#),
            user(
                T1,
                r#"[{"type":"text","text":"[Request interrupted by user]"}]"#,
            ),
        ];
        assert_eq!(after(&lines), Some((State::Waiting, at(T1))));
    }

    #[test]
    fn a_tool_refused_at_the_prompt_waits_on_you() {
        let refused = r#"{"type":"user","timestamp":"2026-10-21T10:00:09.000Z","toolDenialKind":"user-rejected","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"a","is_error":true}]}}"#;
        let lines = [
            user(T0, r#""go""#),
            assistant(T1, "tool_use", r#"[{"type":"tool_use","id":"a"}]"#),
            refused.to_string(),
        ];
        assert_eq!(after(&lines), Some((State::Waiting, at(T2))));
    }

    #[test]
    fn a_provider_error_stops_the_session() {
        let error = r#"{"type":"assistant","timestamp":"2026-10-21T10:00:05.000Z","isApiErrorMessage":true,"message":{"role":"assistant","content":[{"type":"text","text":"overloaded"}]}}"#;
        assert_eq!(
            after(&[user(T0, r#""go""#), error.to_string()]),
            Some((State::Error, at(T1)))
        );
    }

    #[test]
    fn meta_lines_and_other_records_change_nothing() {
        let meta = r#"{"type":"user","isMeta":true,"timestamp":"2026-10-21T10:00:09.000Z","message":{"role":"user","content":"caveat"}}"#;
        let title = r#"{"type":"custom-title","customTitle":"x","sessionId":"s"}"#;
        let lines = [
            user(T0, r#""go""#),
            assistant(T1, "end_turn", r#"[{"type":"text","text":"done"}]"#),
            meta.to_string(),
            title.to_string(),
        ];
        assert_eq!(after(&lines), Some((State::Waiting, at(T1))));
    }

    #[test]
    fn a_local_command_waits_on_you_but_a_command_prompt_works() {
        let finished = [
            user(T0, r#""go""#),
            assistant(T1, "end_turn", r#"[{"type":"text","text":"done"}]"#),
        ];
        let local = [
            user(T2, r#""<command-name>/model</command-name>""#),
            user(T3, r#""<local-command-stdout>set</local-command-stdout>""#),
        ];
        assert_eq!(
            after(&[finished.as_slice(), local.as_slice()].concat()),
            Some((State::Waiting, at(T1)))
        );
        assert_eq!(after(&local), Some((State::Waiting, at(T2))));

        let prompted = [
            user(
                T2,
                r#""<command-message>review is running</command-message>""#,
            ),
            assistant(T3, "tool_use", r#"[{"type":"text","text":"looking"}]"#),
        ];
        assert_eq!(
            after(&[finished.as_slice(), prompted.as_slice()].concat()),
            Some((State::Working, at(T2)))
        );
    }

    #[test]
    fn names_a_worktree_for_its_repository() {
        let transcript = Path::new("/x/D--Code-kehai/s.jsonl");
        assert_eq!(
            place(
                Some(r"D:\Code\kehai\.agents\worktrees\next-feature"),
                transcript
            ),
            ("kehai".to_string(), Some("next-feature".to_string()))
        );
        assert_eq!(
            place(Some("/home/me/src/kehai"), transcript),
            ("kehai".to_string(), None)
        );
        assert_eq!(place(None, transcript), ("D--Code-kehai".to_string(), None));
    }

    #[test]
    fn finds_the_session_a_subagent_belongs_to() {
        assert_eq!(
            started_by(Path::new("/root/proj/abc/subagents/agent-1.jsonl")),
            Some("abc".to_string())
        );
        assert_eq!(started_by(Path::new("/root/proj/abc.jsonl")), None);
    }
}
