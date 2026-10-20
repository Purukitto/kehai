pub mod cpu;
pub mod disk;
pub mod media;
pub mod mem;
pub mod net;
pub mod notify;
pub mod quota;

use tauri::AppHandle;

/// Each poller owns a thread. A stalled source can only ever stall itself.
pub fn spawn_all(app: AppHandle) {
    cpu::spawn(app.clone());
    mem::spawn(app.clone());
    net::spawn(app.clone());
    disk::spawn(app.clone());
    quota::spawn(app.clone());
    media::spawn(app.clone());
    notify::spawn(app);
}
