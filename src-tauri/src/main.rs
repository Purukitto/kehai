#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bus;
mod pollers;

use tauri::{Listener, Manager};

fn main() {
    tauri::Builder::default()
        // Restores position and size from the last run, which is what makes the
        // panel reopen on the display it was left on.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // Driven from the update poller only. The renderer has no updater or
        // opener permission, so it can ask for a check or an install over
        // `update:command` but never name a URL.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // The renderer says hello once its bus subscription is live. Without
            // this an IPC failure is silent on both sides: the engine keeps
            // publishing and the panel keeps showing dashes.
            let replay_to = app.handle().clone();
            app.listen("ui:hello", move |_| {
                eprintln!("bus: renderer attached");
                // Hand the new window everything already known, rather than
                // making it wait out each poller's interval — or, for the
                // publish-on-change sources, wait forever.
                bus::replay(&replay_to);
            });

            pollers::spawn_all(app.handle().clone());

            // The window starts hidden so the state plugin can put it back on
            // the display it was closed on before it is ever painted —
            // otherwise it flashes at the default position and jumps.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("kehai failed to start");
}
