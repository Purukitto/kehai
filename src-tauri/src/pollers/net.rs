use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::Networks;
use tauri::AppHandle;

use crate::bus;

const INTERVAL: Duration = Duration::from_millis(2000);

/// Mirrors `NetPayload` in `src/core/payloads.ts`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NetPayload {
    pub rx_bytes_per_sec: u64,
    pub tx_bytes_per_sec: u64,
    /// Interfaces that moved any traffic this interval, busiest first.
    pub active: Vec<Interface>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Interface {
    pub name: String,
    pub rx_bytes_per_sec: u64,
    pub tx_bytes_per_sec: u64,
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        let mut networks = Networks::new_with_refreshed_list();
        let mut last = Instant::now();

        // The counters are deltas since the previous refresh, so the first
        // reading covers an unknown span. Discard it.
        thread::sleep(INTERVAL);

        loop {
            networks.refresh(true);

            let elapsed = last.elapsed().as_secs_f64().max(0.001);
            last = Instant::now();

            let per_sec = |bytes: u64| (bytes as f64 / elapsed).round() as u64;

            let mut active: Vec<Interface> = networks
                .iter()
                .map(|(name, data)| Interface {
                    name: name.clone(),
                    rx_bytes_per_sec: per_sec(data.received()),
                    tx_bytes_per_sec: per_sec(data.transmitted()),
                })
                .filter(|i| i.rx_bytes_per_sec > 0 || i.tx_bytes_per_sec > 0)
                .collect();

            // Windows enumerates a filter driver — an NDIS LightWeight Filter,
            // a VPN shim — as a second interface that mirrors the adapter it
            // sits on byte for byte. Summing both reports twice the traffic
            // that actually moved. Collapse readings identical within the same
            // interval, keeping the shortest name: the mirror is always the
            // adapter's name plus the filter's description.
            active.sort_by_key(|i| (i.rx_bytes_per_sec, i.tx_bytes_per_sec, i.name.len()));
            active.dedup_by(|a, b| {
                a.rx_bytes_per_sec == b.rx_bytes_per_sec && a.tx_bytes_per_sec == b.tx_bytes_per_sec
            });

            active.sort_by_key(|i| std::cmp::Reverse(i.rx_bytes_per_sec + i.tx_bytes_per_sec));
            active.truncate(4);

            bus::publish(
                &app,
                "telemetry:net",
                "poller.net",
                NetPayload {
                    rx_bytes_per_sec: active.iter().map(|i| i.rx_bytes_per_sec).sum(),
                    tx_bytes_per_sec: active.iter().map(|i| i.tx_bytes_per_sec).sum(),
                    active,
                },
            );

            thread::sleep(INTERVAL);
        }
    });
}
