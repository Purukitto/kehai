#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bus;
mod log;
mod pollers;
mod remote;
mod shell;

use tauri::{Listener, Manager, RunEvent, WindowEvent};
use tauri_plugin_window_state::StateFlags;

fn main() {
    let builder = tauri::Builder::default();

    // A second launch, from the Start menu say, shows the copy already running
    // instead of starting another engine beside it. First, so it runs before
    // anything else starts. Not in a debug build, which runs beside the
    // installed copy and shares its identifier.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        shell::show(app);
    }));

    let app = builder
        // Restores position and size from the last run, which is what makes the
        // panel reopen on the display it was left on. Not whether it was
        // showing: that is the tray's setting, applied in setup.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
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
            log::init(app.handle());

            // The renderer says hello once its bus subscription is live. Without
            // this an IPC failure is silent on both sides: the engine keeps
            // publishing and the panel keeps showing dashes.
            let replay_to = app.handle().clone();
            app.listen("ui:hello", move |_| {
                log::info("bus", "renderer attached");
                // Hand the new window everything already known, rather than
                // making it wait out each poller's interval — or, for the
                // publish-on-change sources, wait forever.
                bus::replay(&replay_to);
            });

            pollers::spawn_all(app.handle().clone());
            remote::spawn(app.handle().clone());

            // The window starts hidden so the state plugin can put it back on
            // the display it was closed on before it is ever painted —
            // otherwise it flashes at the default position and jumps. It
            // stays hidden for a copy set to start in the tray only.
            if shell::setup(app.handle()) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing hides the panel. Kehai carries on in the tray, remote
            // panels and all, until Quit in the tray's menu.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if shell::hides_on_close() {
                    api.prevent_close();
                    shell::hide(window.app_handle());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("kehai failed to start");

    app.run(|_, event| {
        if let RunEvent::Exit = event {
            log::stopped();
        }
    });
}
