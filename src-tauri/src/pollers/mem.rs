use std::thread;
use std::time::Duration;

use serde::Serialize;
use sysinfo::System;
use tauri::AppHandle;

use crate::bus;

const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
const INTERVAL: Duration = Duration::from_millis(1000);

/// Mirrors `MemPayload` in `src/core/payloads.ts`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemPayload {
    pub used_gib: f32,
    pub total_gib: f32,
    pub swap_used_gib: f32,
    pub swap_total_gib: f32,
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        let mut sys = System::new();

        loop {
            sys.refresh_memory();

            bus::publish(
                &app,
                "telemetry:mem",
                "poller.mem",
                MemPayload {
                    used_gib: (sys.used_memory() as f64 / GIB) as f32,
                    total_gib: (sys.total_memory() as f64 / GIB) as f32,
                    swap_used_gib: (sys.used_swap() as f64 / GIB) as f32,
                    swap_total_gib: (sys.total_swap() as f64 / GIB) as f32,
                },
            );

            thread::sleep(INTERVAL);
        }
    });
}
