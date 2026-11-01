pub mod agents;
pub mod cpu;
pub mod disk;
pub mod display;
pub mod flow;
pub mod game;
pub mod media;
pub mod mem;
pub mod net;
pub mod notify;
pub mod presence;
pub mod quota;
mod transcripts;
pub mod update;
pub mod widgets;

use tauri::AppHandle;

/// Each poller owns a thread. A stalled source can only ever stall itself.
///
/// Runs before the window is shown: the display poller places the window on
/// the calling thread first.
pub fn spawn_all(app: AppHandle) {
    display::spawn(app.clone());
    cpu::spawn(app.clone());
    mem::spawn(app.clone());
    net::spawn(app.clone());
    disk::spawn(app.clone());
    flow::spawn(app.clone());
    quota::spawn(app.clone());
    agents::spawn(app.clone());
    media::spawn(app.clone());
    update::spawn(app.clone());
    presence::spawn(app.clone());
    game::spawn(app.clone());
    widgets::spawn(app.clone());
    notify::spawn(app);
}
