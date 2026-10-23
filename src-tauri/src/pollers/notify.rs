use std::sync::atomic::{AtomicU8, Ordering};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Listener};

use crate::bus;

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
    pub items: Vec<Item>,
}

#[derive(Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: u32,
    pub source: String,
    pub title: String,
    pub body: String,
    pub at_ms: i64,
}

/// What the sink asks for. Dismissing removes the toast from the system tray,
/// not just from this feed — the widget is a view onto the real thing.
/// `listen` is the go-ahead to ask for access and start reading.
#[derive(Deserialize)]
struct Command {
    action: String,
    id: Option<u32>,
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

pub fn spawn(app: AppHandle) {
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
                    if let Some(id) = cmd.id {
                        platform::dismiss(id);
                    }
                }
                "clear" => platform::clear(),
                _ => return,
            }

            // Publish straight away rather than leaving the row on screen until
            // the next poll — a dismiss that takes three seconds to show reads
            // as a dead button.
            bus::publish(
                &app,
                "sys:notify",
                "poller.notify",
                NotifyPayload {
                    available: true,
                    pending: false,
                    reason: None,
                    items: platform::read(),
                },
            );
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
                items: Vec::new(),
            },
        );
    } else {
        listen(&app);
    }
}

fn read_forever(app: AppHandle) {
    match platform::request_access() {
        Ok(()) => eprintln!("poller.notify: listener access granted"),
        Err(reason) => {
            eprintln!("poller.notify: unavailable — {reason}");
            ACCESS.store(REFUSED, Ordering::SeqCst);
            bus::publish(
                &app,
                "sys:notify",
                "poller.notify",
                NotifyPayload {
                    available: false,
                    pending: false,
                    reason: Some(reason),
                    items: Vec::new(),
                },
            );
            return;
        }
    }

    let mut last: Option<NotifyPayload> = None;
    let mut announced = false;

    loop {
        let payload = NotifyPayload {
            available: true,
            pending: false,
            reason: None,
            items: platform::read(),
        };

        if !announced {
            announced = true;
            eprintln!(
                "poller.notify: first read returned {} items",
                payload.items.len()
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

    pub fn dismiss(id: u32) {
        match UserNotificationListener::Current() {
            Ok(listener) => {
                if let Err(e) = listener.RemoveNotification(id) {
                    eprintln!("poller.notify: dismiss {id} refused: {e}");
                }
            }
            Err(e) => eprintln!("poller.notify: listener unavailable: {e}"),
        }
    }

    /// Clears every notification the listener can see.
    ///
    /// `ClearNotifications` is unreliable across Windows builds, so this falls
    /// back to removing them one by one — which is the operation that actually
    /// works — and reports rather than failing silently.
    pub fn clear() {
        let Ok(listener) = UserNotificationListener::Current() else {
            eprintln!("poller.notify: listener unavailable for clear");
            return;
        };

        if let Err(e) = listener.ClearNotifications() {
            eprintln!("poller.notify: ClearNotifications refused ({e}); removing individually");
        }

        let remaining = read();
        if remaining.is_empty() {
            return;
        }

        eprintln!("poller.notify: clearing {} individually", remaining.len());
        for item in remaining {
            if let Err(e) = listener.RemoveNotification(item.id) {
                eprintln!("poller.notify: could not remove {}: {e}", item.id);
            }
        }
    }

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

            let source = notification
                .AppInfo()
                .and_then(|a| a.DisplayInfo())
                .and_then(|d| d.DisplayName())
                .map(|s| s.to_string())
                .unwrap_or_else(|_| "Unknown".to_string());

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
                source,
                title: lines.first().cloned().unwrap_or_default(),
                body: lines
                    .get(1..)
                    .map(|rest| rest.join(" · "))
                    .unwrap_or_default(),
                at_ms,
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
                    let item = Item {
                        id: next_local,
                        source: if app.is_empty() {
                            "Unknown".to_string()
                        } else {
                            app
                        },
                        title: plain(&summary),
                        body: plain(&body),
                        at_ms: now_ms(),
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

        eprintln!("poller.notify: the session bus went away; no more notifications");
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
            eprintln!("poller.notify: close {id} refused: {err}");
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

    pub fn dismiss(id: u32) {
        for seen in take(|s| s.item.id != id) {
            if seen.confirmed {
                close(seen.item.id);
            }
        }
    }

    pub fn clear() {
        for seen in take(|_| false) {
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

    pub fn dismiss(_id: u32) {}

    pub fn clear() {}
}
