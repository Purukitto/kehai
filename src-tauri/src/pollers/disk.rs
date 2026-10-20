use std::thread;
use std::time::Duration;

use serde::Serialize;
use sysinfo::Disks;
use tauri::AppHandle;

use crate::bus;

/// Capacity moves slowly. Polling it at telemetry rates would be waste, so this
/// deliberately runs slower than the interval the design sketched.
const INTERVAL: Duration = Duration::from_millis(10_000);

/// Mirrors `DiskPayload` in `src/core/payloads.ts`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiskPayload {
    pub volumes: Vec<Volume>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    pub name: String,
    pub mount: String,
    pub used_bytes: u64,
    pub total_bytes: u64,
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        let mut disks = Disks::new_with_refreshed_list();

        loop {
            disks.refresh(true);

            let mut volumes: Vec<Volume> = disks
                .iter()
                .filter(|d| d.total_space() > 0)
                .map(|d| {
                    let total = d.total_space();
                    Volume {
                        name: d.name().to_string_lossy().to_string(),
                        mount: d.mount_point().to_string_lossy().to_string(),
                        used_bytes: total.saturating_sub(d.available_space()),
                        total_bytes: total,
                    }
                })
                .collect();

            // Stable order, so a volume does not jump rows between polls.
            volumes.sort_by(|a, b| a.mount.cmp(&b.mount));
            volumes.dedup_by(|a, b| a.mount == b.mount);

            bus::publish(
                &app,
                "telemetry:disk",
                "poller.disk",
                DiskPayload { volumes },
            );

            thread::sleep(INTERVAL);
        }
    });
}
