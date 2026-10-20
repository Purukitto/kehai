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
#[derive(Deserialize)]
struct Command {
    action: String,
    id: Option<u32>,
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
                    reason: None,
                    items: platform::read(),
                },
            );
        });
    });

    thread::spawn(move || {
        match platform::request_access() {
            Ok(()) => eprintln!("poller.notify: listener access granted"),
            Err(reason) => {
                eprintln!("poller.notify: unavailable — {reason}");
                bus::publish(
                    &app,
                    "sys:notify",
                    "poller.notify",
                    NotifyPayload {
                        available: false,
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
    });
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

/// Linux reads the same events off D-Bus. Not wired yet.
#[cfg(not(windows))]
mod platform {
    use super::Item;

    pub fn request_access() -> Result<(), String> {
        Err("D-Bus notification monitoring is not wired up yet".to_string())
    }

    pub fn read() -> Vec<Item> {
        Vec::new()
    }

    pub fn dismiss(_id: u32) {}

    pub fn clear() {}
}
