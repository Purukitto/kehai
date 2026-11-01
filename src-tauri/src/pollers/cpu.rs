use std::thread;
use std::time::Duration;

use serde::Serialize;
use sysinfo::{Components, System, MINIMUM_CPU_UPDATE_INTERVAL};
use tauri::AppHandle;

use crate::bus;
use crate::log;

/// Mirrors `CpuPayload` in `src/core/payloads.ts`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CpuPayload {
    pub pct: u32,
    pub threads: Vec<u32>,
    pub clock_ghz: f32,
    /// `None` where the platform exposes no usable sensor. The widget renders a
    /// blank field rather than inventing a zero.
    pub temp_c: Option<f32>,
}

const INTERVAL: Duration = Duration::from_millis(1000);

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        let mut sys = System::new();
        let mut components = Components::new_with_refreshed_list();

        // The first sample after construction is always zero: usage is measured
        // between refreshes, so prime it and wait out the minimum interval
        // before anything is published.
        sys.refresh_cpu_all();
        thread::sleep(MINIMUM_CPU_UPDATE_INTERVAL.max(INTERVAL));

        let mut announced = false;

        loop {
            sys.refresh_cpu_all();

            let cpus = sys.cpus();
            let threads: Vec<u32> = cpus.iter().map(|c| c.cpu_usage().round() as u32).collect();

            let clock_ghz = cpus
                .first()
                .map(|c| c.frequency() as f32 / 1000.0)
                .unwrap_or(0.0);

            components.refresh(true);
            let temp_c = cpu_temperature(&components);

            if !announced {
                announced = true;
                log::info(
                    "poller.cpu",
                    format!(
                        "{} threads, {:.2} GHz, temperature {}",
                        threads.len(),
                        clock_ghz,
                        match temp_c {
                            Some(t) => format!("{t:.1}C"),
                            None => "unavailable on this platform".to_string(),
                        }
                    ),
                );
            }

            bus::publish(
                &app,
                "telemetry:cpu",
                "poller.cpu",
                CpuPayload {
                    pct: sys.global_cpu_usage().round() as u32,
                    threads,
                    clock_ghz,
                    temp_c,
                },
            );

            thread::sleep(INTERVAL);
        }
    });
}

/// Picks the package sensor where one is exposed. Windows commonly reports none
/// without a vendor driver, and Linux labels vary by platform, so this is a
/// best-effort match that is allowed to fail.
fn cpu_temperature(components: &Components) -> Option<f32> {
    let preferred = ["package", "tctl", "cpu", "core 0", "k10temp", "coretemp"];

    for needle in preferred {
        for component in components.iter() {
            let label = component.label().to_ascii_lowercase();
            if label.contains(needle) {
                if let Some(temp) = component.temperature() {
                    if temp.is_finite() && temp > 0.0 {
                        return Some(temp);
                    }
                }
            }
        }
    }

    None
}
