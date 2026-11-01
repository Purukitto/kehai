use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Listener};

use crate::bus;
use crate::log;

const INTERVAL: Duration = Duration::from_millis(3000);

/// Mirrors `NotifyPayload` in `src/core/payloads.ts`.
#[derive(Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotifyPayload {
    /// False when the platform refused access. The widget says so plainly
    /// rather than showing an empty feed that looks like a quiet day.
    pub available: bool,
    /// True until Kehai has been told it may read notifications. Nothing is
    /// read, and nothing is asked of the platform, before that.
    pub pending: bool,
    pub reason: Option<String>,
    /// What the panel may show: a hidden app's notifications are left out, and
    /// a name-only app's arrive without their text. Decided here, so neither
    /// reaches the panel, let alone a remote one.
    pub items: Vec<Item>,
    /// Every app with a notification in the list, hidden ones too, for the
    /// Notifications options on this machine. A remote panel never gets these.
    pub apps: Vec<App>,
    /// Only ever true on a remote panel's copy, when the host shows remote
    /// panels none of them, so it can say so rather than look like a quiet day.
    pub withheld: bool,
}

#[derive(Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: u32,
    /// The app's own id, which stays put when its display name changes. What
    /// each app's rule is kept under.
    pub app: String,
    pub source: String,
    pub title: String,
    pub body: String,
    pub at_ms: i64,
    /// Its app shows its name only, so the title and body are empty.
    pub name_only: bool,
}

/// One app in the list. Mirrors `NotifyApp` in `src/core/payloads.ts`.
#[derive(Serialize, Clone, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct App {
    pub id: String,
    pub name: String,
    /// How many of its notifications are in the list.
    pub count: usize,
    pub last_ms: i64,
}

/// What reaches the panel from one app. Mirrors `NotifyRule`.
#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
enum Rule {
    Show,
    Name,
    Hide,
}

/// What a remote panel gets. Mirrors `NotifyRemote`.
#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
enum Remote {
    /// What this panel shows.
    Same,
    /// Each app and how many, never what they say.
    Name,
    Nothing,
}

/// The panel's choices, which it keeps and sends on `notify:rules`. An app it
/// does not name shows.
struct Rules {
    apps: HashMap<String, Rule>,
    remote: Remote,
}

/// None until the panel has said. Until then a remote panel is shown nothing:
/// an app hidden here must not reach one in the moments before.
static RULES: Mutex<Option<Rules>> = Mutex::new(None);

/// Renderer → engine on `notify:rules`. A topic of its own rather than an
/// action on `notify:command`: the renderer's bus keeps one command per topic
/// until the engine is listening, and this must not push out a `listen`.
#[derive(Deserialize)]
struct RulesCommand {
    apps: HashMap<String, Rule>,
    remote: Remote,
}

/// What the sink asks for. Dismissing removes the toast from the system tray,
/// not just from this feed — the widget is a view onto the real thing.
/// `listen` is the go-ahead to ask for access and start reading.
#[derive(Deserialize)]
struct Command {
    action: String,
    id: Option<u32>,
    /// For `clear`: the ones the tile shows. Without them, all it may show.
    ids: Option<Vec<u32>>,
}

/// Whether the platform has anything to ask. Where it has nothing, there is no
/// go-ahead to wait for, and the poller starts at once to say what is missing.
const ASKS: bool = cfg!(any(windows, target_os = "linux"));

const NOT_ASKED: u8 = 0;
const ASKING: u8 = 1;
const REFUSED: u8 = 2;
/// One listener at most. A refusal can be asked about again, once the person
/// has had a chance to change the system setting that caused it.
static ACCESS: AtomicU8 = AtomicU8::new(NOT_ASKED);
/// Set once access is granted: only then is there a list to publish.
static GRANTED: AtomicBool = AtomicBool::new(false);

/// Asks for access and reads until the app exits, unless already doing so.
fn listen(app: &AppHandle) {
    let claimed = [NOT_ASKED, REFUSED].iter().any(|&from| {
        ACCESS
            .compare_exchange(from, ASKING, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    });
    if claimed {
        let app = app.clone();
        thread::spawn(move || read_forever(app));
    }
}

fn rule_of(rules: &Option<Rules>, app: &str) -> Rule {
    rules
        .as_ref()
        .and_then(|r| r.apps.get(app).copied())
        .unwrap_or(Rule::Show)
}

/// The list as the panel may show it, and every app in it, newest first.
fn shape(raw: Vec<Item>, rule: impl Fn(&str) -> Rule) -> (Vec<Item>, Vec<App>) {
    let mut apps: Vec<App> = Vec::new();
    let mut items = Vec::new();
    for item in raw {
        match apps.iter_mut().find(|a| a.id == item.app) {
            Some(a) => {
                a.count += 1;
                a.last_ms = a.last_ms.max(item.at_ms);
            }
            None => apps.push(App {
                id: item.app.clone(),
                name: item.source.clone(),
                count: 1,
                last_ms: item.at_ms,
            }),
        }
        match rule(&item.app) {
            Rule::Show => items.push(item),
            Rule::Name => items.push(Item {
                title: String::new(),
                body: String::new(),
                name_only: true,
                ..item
            }),
            Rule::Hide => {}
        }
    }
    apps.sort_by_key(|a| std::cmp::Reverse(a.last_ms));
    (items, apps)
}

/// A fresh read, as the panel may show it.
fn current() -> NotifyPayload {
    let raw = platform::read();
    let (items, apps) = {
        let rules = RULES.lock().unwrap_or_else(|e| e.into_inner());
        shape(raw, |app| rule_of(&rules, app))
    };
    NotifyPayload {
        available: true,
        pending: false,
        reason: None,
        items,
        apps,
        withheld: false,
    }
}

/// The ids the panel may show, and so may dismiss. A hidden app's are not
/// among them: what the tile never showed, it never clears.
fn shown() -> Vec<u32> {
    current().items.iter().map(|i| i.id).collect()
}

/// A remote panel's copy of `sys:notify`, as the panel chose for remote panels.
pub fn for_remote(envelope: &serde_json::Value) -> serde_json::Value {
    let remote = RULES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|r| r.remote);
    redact(envelope, remote)
}

fn redact(envelope: &serde_json::Value, remote: Option<Remote>) -> serde_json::Value {
    let mut out = envelope.clone();
    let Some(data) = out.get_mut("data").and_then(|d| d.as_object_mut()) else {
        return out;
    };
    // Which apps there are, hidden ones included, is this machine's business.
    data.insert("apps".into(), serde_json::json!([]));
    match remote {
        Some(Remote::Same) => {}
        Some(Remote::Name) => {
            if let Some(items) = data.get_mut("items").and_then(|i| i.as_array_mut()) {
                for item in items.iter_mut().filter_map(|i| i.as_object_mut()) {
                    item.insert("title".into(), "".into());
                    item.insert("body".into(), "".into());
                    item.insert("nameOnly".into(), true.into());
                }
            }
        }
        Some(Remote::Nothing) | None => {
            data.insert("items".into(), serde_json::json!([]));
            data.insert("withheld".into(), true.into());
        }
    }
    out
}

fn publish_current(app: &AppHandle) {
    if GRANTED.load(Ordering::SeqCst) {
        bus::publish(app, "sys:notify", "poller.notify", current());
    }
}

pub fn spawn(app: AppHandle) {
    let rules_app = app.clone();
    app.listen("notify:rules", move |event| {
        let Ok(cmd) = serde_json::from_str::<RulesCommand>(event.payload()) else {
            log::warn("poller.notify", "rules not understood");
            return;
        };
        if let Ok(mut rules) = RULES.lock() {
            *rules = Some(Rules {
                apps: cmd.apps,
                remote: cmd.remote,
            });
        }
        let app = rules_app.clone();
        // A changed rule shows at once rather than at the next poll.
        thread::spawn(move || publish_current(&app));
    });

    let commands = app.clone();
    let responder = app.clone();
    commands.listen("notify:command", move |event| {
        let Ok(cmd) = serde_json::from_str::<Command>(event.payload()) else {
            return;
        };

        let app = responder.clone();
        // Off the event thread: a tray call can block.
        thread::spawn(move || {
            match cmd.action.as_str() {
                "listen" => {
                    listen(&app);
                    return;
                }
                "dismiss" => {
                    if let Some(id) = cmd.id.filter(|id| shown().contains(id)) {
                        platform::remove(&[id]);
                    }
                }
                "clear" => {
                    let shown = shown();
                    let ids: Vec<u32> = match cmd.ids {
                        Some(ids) => ids.into_iter().filter(|id| shown.contains(id)).collect(),
                        None => shown,
                    };
                    platform::remove(&ids);
                }
                _ => return,
            }

            // Publish straight away rather than leaving the row on screen until
            // the next poll — a dismiss that takes three seconds to show reads
            // as a dead button.
            publish_current(&app);
        });
    });

    if ASKS {
        bus::publish(
            &app,
            "sys:notify",
            "poller.notify",
            NotifyPayload {
                available: false,
                pending: true,
                reason: Some("not allowed yet".to_string()),
                ..Default::default()
            },
        );
    } else {
        listen(&app);
    }
}

fn read_forever(app: AppHandle) {
    match platform::request_access() {
        Ok(()) => log::info("poller.notify", "listener access granted"),
        Err(reason) => {
            log::problem(
                "poller.notify",
                "Notifications can't be read.",
                Some("Settings → Sources says why."),
                &reason,
            );
            ACCESS.store(REFUSED, Ordering::SeqCst);
            bus::publish(
                &app,
                "sys:notify",
                "poller.notify",
                NotifyPayload {
                    available: false,
                    pending: false,
                    reason: Some(reason),
                    ..Default::default()
                },
            );
            return;
        }
    }
    GRANTED.store(true, Ordering::SeqCst);

    let mut last: Option<NotifyPayload> = None;
    let mut announced = false;

    loop {
        let payload = current();

        if !announced {
            announced = true;
            log::info(
                "poller.notify",
                format!("first read returned {} items", payload.items.len()),
            );
        }

        if last.as_ref() != Some(&payload) {
            bus::publish(&app, "sys:notify", "poller.notify", payload.clone());
            last = Some(payload);
        }

        thread::sleep(INTERVAL);
    }
}

#[cfg(windows)]
mod platform {
    use super::Item;
    use crate::log;
    use windows::UI::Notifications::Management::{
        UserNotificationListener, UserNotificationListenerAccessStatus,
    };
    use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds};

    pub fn request_access() -> Result<(), String> {
        let listener = UserNotificationListener::Current()
            .map_err(|e| format!("listener unavailable: {e}"))?;

        let status = listener
            .RequestAccessAsync()
            .map_err(|e| format!("access request failed: {e}"))?
            .get()
            .map_err(|e| format!("access request failed: {e}"))?;

        match status {
            UserNotificationListenerAccessStatus::Allowed => Ok(()),
            UserNotificationListenerAccessStatus::Denied => {
                Err("access denied in Windows notification settings".to_string())
            }
            _ => Err("access not granted; the listener needs a packaged app identity".to_string()),
        }
    }

    /// Removes each from the system tray. `ClearNotifications` would take a
    /// hidden app's along with the rest, so they go one at a time.
    pub fn remove(ids: &[u32]) {
        let listener = match UserNotificationListener::Current() {
            Ok(listener) => listener,
            Err(e) => {
                log::warn("poller.notify", format!("listener unavailable: {e}"));
                return;
            }
        };
        for &id in ids {
            if let Err(e) = listener.RemoveNotification(id) {
                log::warn("poller.notify", format!("could not remove {id}: {e}"));
            }
        }
    }

    // Do Not Disturb is not followed. `ToastNotificationManager`'s
    // `NotificationMode` read it as on while Windows 11 showed it off (tried
    // 31 Oct 2026), and a tile gone quiet for no visible reason is worse than
    // one that never goes quiet for it.

    pub fn read() -> Vec<Item> {
        let Ok(listener) = UserNotificationListener::Current() else {
            return Vec::new();
        };
        let Ok(op) = listener.GetNotificationsAsync(NotificationKinds::Toast) else {
            return Vec::new();
        };
        let Ok(list) = op.get() else {
            return Vec::new();
        };

        let mut items = Vec::new();

        for notification in list.into_iter() {
            let id = notification.Id().unwrap_or(0);

            let info = notification.AppInfo().ok();
            let source = info
                .as_ref()
                .and_then(|a| a.DisplayInfo().ok())
                .and_then(|d| d.DisplayName().ok())
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Unknown".to_string());
            // The display name stands in for an app that gives no id of its own.
            let app = info
                .as_ref()
                .and_then(|a| a.AppUserModelId().ok())
                .map(|s| s.to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| source.clone());

            let at_ms = notification
                .CreationTime()
                .map(|t| (t.UniversalTime - 116_444_736_000_000_000) / 10_000)
                .unwrap_or(0);

            let mut lines: Vec<String> = Vec::new();
            if let Ok(visual) = notification.Notification().and_then(|n| n.Visual()) {
                if let Ok(binding) = visual
                    .GetBinding(&KnownNotificationBindings::ToastGeneric().unwrap_or_default())
                {
                    if let Ok(texts) = binding.GetTextElements() {
                        for text in texts.into_iter() {
                            if let Ok(t) = text.Text() {
                                let t = t.to_string();
                                if !t.is_empty() {
                                    lines.push(t);
                                }
                            }
                        }
                    }
                }
            }

            items.push(Item {
                id,
                app,
                source,
                title: lines.first().cloned().unwrap_or_default(),
                body: lines
                    .get(1..)
                    .map(|rest| rest.join(" · "))
                    .unwrap_or_default(),
                at_ms,
                name_only: false,
            });
        }

        items.sort_by_key(|i| std::cmp::Reverse(i.at_ms));
        items.truncate(40);
        items
    }
}

/// Linux has no API for reading other applications' notifications, so this
/// listens on the session bus the way `dbus-monitor` does: as a monitor, seeing
/// each `Notify` call on its way to the notification server. Only what arrives
/// while Kehai runs can be seen; there is no history to read back.
#[cfg(target_os = "linux")]
mod platform {
    use crate::log;
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::Item;
    use zbus::blocking::fdo::MonitoringProxy;
    use zbus::blocking::{Connection, MessageIterator};
    use zbus::message::Type;
    use zbus::zvariant::OwnedValue;
    use zbus::MatchRule;

    const SERVICE: &str = "org.freedesktop.Notifications";
    const PATH: &str = "/org/freedesktop/Notifications";
    /// As many as the Windows side keeps.
    const KEEP: usize = 40;
    /// `NotificationClosed` reasons. Expired means it left the screen by
    /// itself, which is exactly when a feed read later is useful, so it stays.
    const EXPIRED: u32 = 1;

    struct Seen {
        item: Item,
        /// Whether `item.id` is the server's. Until its reply to `Notify` is
        /// seen the item carries a stand-in, and closing it by that number
        /// would close someone else's notification.
        confirmed: bool,
    }

    /// Newest first.
    static FEED: Mutex<Vec<Seen>> = Mutex::new(Vec::new());

    /// The arguments of `Notify`, in order: app name, replaces id, icon,
    /// summary, body, actions, hints, timeout.
    type Notify = (
        String,
        u32,
        String,
        String,
        String,
        Vec<String>,
        HashMap<String, OwnedValue>,
        i32,
    );

    /// A monitor connection cannot send, so closing a notification needs one
    /// of its own.
    fn sender() -> Option<&'static Connection> {
        static BUS: OnceLock<Option<Connection>> = OnceLock::new();
        BUS.get_or_init(|| Connection::session().ok()).as_ref()
    }

    pub fn request_access() -> Result<(), String> {
        let rules = rules().map_err(|e| format!("could not describe what to watch: {e}"))?;
        let conn = Connection::session().map_err(|e| format!("no session bus: {e}"))?;
        let refused =
            |e: &dyn std::fmt::Display| format!("the session bus refused to let Kehai watch: {e}");
        MonitoringProxy::new(&conn)
            .map_err(|e| refused(&e))?
            .become_monitor(&rules, 0)
            .map_err(|e| refused(&e))?;
        thread::spawn(move || watch(conn));
        Ok(())
    }

    /// Notifications going in, the ids the server hands back, and their
    /// closing. Nothing else on the bus is delivered to this connection.
    fn rules() -> zbus::Result<Vec<MatchRule<'static>>> {
        Ok(vec![
            MatchRule::builder()
                .msg_type(Type::MethodCall)
                .interface(SERVICE)?
                .member("Notify")?
                .build(),
            MatchRule::builder()
                .msg_type(Type::MethodReturn)
                .sender(SERVICE)?
                .build(),
            MatchRule::builder()
                .msg_type(Type::Signal)
                .interface(SERVICE)?
                .member("NotificationClosed")?
                .build(),
        ])
    }

    fn now_ms() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    /// Notification bodies may carry a little markup. The widget shows text.
    fn plain(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        let mut in_tag = false;
        for c in s.chars() {
            match c {
                '<' => in_tag = true,
                '>' if in_tag => in_tag = false,
                c if !in_tag => out.push(c),
                _ => {}
            }
        }
        out.replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&amp;", "&")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn watch(conn: Connection) {
        // Each `Notify` waits here for the server's reply, keyed by who sent it
        // and the serial they gave it, since serials are only unique per sender.
        let mut pending: HashMap<(String, u32), u32> = HashMap::new();
        // Stand-in ids count down from the top, well clear of the server's.
        let mut next_local = u32::MAX;

        for message in MessageIterator::from(conn) {
            let Ok(message) = message else { continue };
            let header = message.header();

            match header.message_type() {
                Type::MethodCall if header.member().is_some_and(|m| m.as_str() == "Notify") => {
                    let Ok((app, replaces, _, summary, body, _, _, _)) =
                        message.body().deserialize::<Notify>()
                    else {
                        continue;
                    };
                    // The name it sends is all there is to know it by.
                    let source = if app.is_empty() {
                        "Unknown".to_string()
                    } else {
                        app
                    };
                    let item = Item {
                        id: next_local,
                        app: source.clone(),
                        source,
                        title: plain(&summary),
                        body: plain(&body),
                        at_ms: now_ms(),
                        name_only: false,
                    };
                    let Ok(mut feed) = FEED.lock() else { continue };
                    // A replacement updates the one on screen, and keeps its id.
                    if let Some(old) = feed
                        .iter()
                        .position(|s| replaces != 0 && s.confirmed && s.item.id == replaces)
                    {
                        let mut seen = feed.remove(old);
                        seen.item = Item {
                            id: replaces,
                            ..item
                        };
                        feed.insert(0, seen);
                        continue;
                    }
                    if let Some(caller) = header.sender() {
                        let serial = message.primary_header().serial_num().get();
                        pending.insert((caller.to_string(), serial), next_local);
                    }
                    next_local = next_local.wrapping_sub(1);
                    feed.insert(
                        0,
                        Seen {
                            item,
                            confirmed: false,
                        },
                    );
                    feed.truncate(KEEP);
                }

                Type::MethodReturn => {
                    let (Some(caller), Some(serial)) =
                        (header.destination(), header.reply_serial())
                    else {
                        continue;
                    };
                    let Some(local) = pending.remove(&(caller.to_string(), serial.get())) else {
                        continue;
                    };
                    let Ok(id) = message.body().deserialize::<u32>() else {
                        continue;
                    };
                    if let Ok(mut feed) = FEED.lock() {
                        if let Some(seen) =
                            feed.iter_mut().find(|s| !s.confirmed && s.item.id == local)
                        {
                            seen.item.id = id;
                            seen.confirmed = true;
                        }
                    }
                }

                Type::Signal
                    if header
                        .member()
                        .is_some_and(|m| m.as_str() == "NotificationClosed") =>
                {
                    let Ok((id, reason)) = message.body().deserialize::<(u32, u32)>() else {
                        continue;
                    };
                    if reason != EXPIRED {
                        if let Ok(mut feed) = FEED.lock() {
                            feed.retain(|s| !(s.confirmed && s.item.id == id));
                        }
                    }
                }

                _ => {}
            }

            // A server that never answers would otherwise grow this forever.
            if pending.len() > 256 {
                pending.clear();
            }
        }

        log::warn(
            "poller.notify",
            "the session bus went away; no more notifications",
        );
    }

    pub fn read() -> Vec<Item> {
        FEED.lock()
            .map(|feed| feed.iter().map(|s| s.item.clone()).collect())
            .unwrap_or_default()
    }

    /// Closes it on the server too, so the widget stays a view onto the real
    /// thing — when the server's id for it is known.
    fn close(id: u32) {
        let Some(bus) = sender() else { return };
        if let Err(err) =
            bus.call_method(Some(SERVICE), PATH, Some(SERVICE), "CloseNotification", &id)
        {
            log::warn("poller.notify", format!("close {id} refused: {err}"));
        }
    }

    fn take(keep: impl Fn(&Seen) -> bool) -> Vec<Seen> {
        let Ok(mut feed) = FEED.lock() else {
            return Vec::new();
        };
        let (kept, taken) = feed.drain(..).partition(keep);
        *feed = kept;
        taken
    }

    pub fn remove(ids: &[u32]) {
        for seen in take(|s| !ids.contains(&s.item.id)) {
            if seen.confirmed {
                close(seen.item.id);
            }
        }
    }
}

/// macOS keeps its notification centre to itself. Not wired.
#[cfg(not(any(windows, target_os = "linux")))]
mod platform {
    use super::Item;

    pub fn request_access() -> Result<(), String> {
        Err("this platform does not let other apps read its notifications".to_string())
    }

    pub fn read() -> Vec<Item> {
        Vec::new()
    }

    pub fn remove(_ids: &[u32]) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: u32, app: &str, at_ms: i64) -> Item {
        Item {
            id,
            app: app.to_string(),
            source: app.to_uppercase(),
            title: format!("title {id}"),
            body: format!("body {id}"),
            at_ms,
            name_only: false,
        }
    }

    fn rules(pairs: &[(&str, Rule)]) -> impl Fn(&str) -> Rule {
        let map: HashMap<String, Rule> = pairs.iter().map(|(a, r)| (a.to_string(), *r)).collect();
        move |app| map.get(app).copied().unwrap_or(Rule::Show)
    }

    #[test]
    fn a_hidden_app_is_left_out_but_still_counted_among_the_apps() {
        let raw = vec![
            item(1, "chat", 30),
            item(2, "mail", 20),
            item(3, "chat", 10),
        ];
        let (items, apps) = shape(raw, rules(&[("chat", Rule::Hide)]));
        assert_eq!(items.iter().map(|i| i.id).collect::<Vec<_>>(), vec![2]);
        assert_eq!(apps.len(), 2);
        assert_eq!(
            (apps[0].id.as_str(), apps[0].count, apps[0].last_ms),
            ("chat", 2, 30)
        );
    }

    #[test]
    fn a_name_only_app_arrives_without_its_text() {
        let (items, _) = shape(vec![item(1, "chat", 10)], rules(&[("chat", Rule::Name)]));
        assert_eq!(items.len(), 1);
        assert!(items[0].name_only);
        assert!(items[0].title.is_empty() && items[0].body.is_empty());
        assert_eq!(items[0].source, "CHAT");
    }

    #[test]
    fn an_app_nobody_named_shows() {
        let (items, _) = shape(vec![item(1, "new", 10)], rules(&[]));
        assert_eq!(items[0].title, "title 1");
        assert!(!items[0].name_only);
    }

    fn envelope() -> serde_json::Value {
        serde_json::json!({
            "topic": "sys:notify",
            "data": {
                "available": true,
                "items": [{ "id": 1, "title": "Mum", "body": "Sunday?", "nameOnly": false }],
                "apps": [{ "id": "chat" }, { "id": "hidden" }],
                "withheld": false
            }
        })
    }

    #[test]
    fn a_remote_panel_never_gets_the_apps() {
        for remote in [
            Some(Remote::Same),
            Some(Remote::Name),
            Some(Remote::Nothing),
            None,
        ] {
            assert_eq!(
                redact(&envelope(), remote)["data"]["apps"],
                serde_json::json!([])
            );
        }
    }

    #[test]
    fn name_only_for_remote_panels_blanks_every_item() {
        let out = redact(&envelope(), Some(Remote::Name));
        let item = &out["data"]["items"][0];
        assert_eq!(
            (item["title"].as_str(), item["body"].as_str()),
            (Some(""), Some(""))
        );
        assert_eq!(item["nameOnly"], true);
    }

    #[test]
    fn a_remote_panel_sees_nothing_until_the_panel_has_said() {
        for remote in [Some(Remote::Nothing), None] {
            let out = redact(&envelope(), remote);
            assert_eq!(out["data"]["items"], serde_json::json!([]));
            assert_eq!(out["data"]["withheld"], true);
        }
    }

    #[test]
    fn same_as_here_passes_the_items_through() {
        let out = redact(&envelope(), Some(Remote::Same));
        assert_eq!(out["data"]["items"][0]["title"], "Mum");
    }
}
