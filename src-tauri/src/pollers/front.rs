//! Bringing a window to the front on this PC: which windows there are, which
//! program each belongs to, and asking Windows to put one in front.
//!
//! Windows lets only the program that took the last input do that, so these
//! are for a tap or a click on this PC, never for a remote panel's. Going to
//! an agent's session and opening a notification's app both come through here.

#[cfg(windows)]
pub use platform::*;

#[cfg(windows)]
mod platform {
    use std::collections::HashMap;

    use windows::core::{BOOL, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindow, GetWindowLongPtrW, GetWindowTextLengthW,
        GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow,
        ShowWindow, GWL_EXSTYLE, GW_OWNER, SW_RESTORE, WS_EX_TOOLWINDOW,
    };

    /// Every process's parent and name, from one snapshot.
    #[allow(unsafe_code)]
    pub fn processes() -> HashMap<u32, (u32, String)> {
        let mut all = HashMap::new();
        // SAFETY: a snapshot of the process list, closed below.
        let Ok(snap) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
            return all;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        // SAFETY: a live snapshot and an entry with its size set.
        let mut more = unsafe { Process32FirstW(snap, &mut entry) }.is_ok();
        while more {
            let len = entry
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..len]).to_ascii_lowercase();
            all.insert(entry.th32ProcessID, (entry.th32ParentProcessID, name));
            // SAFETY: as above.
            more = unsafe { Process32NextW(snap, &mut entry) }.is_ok();
        }
        // SAFETY: opened above and not used after this.
        let _ = unsafe { CloseHandle(snap) };
        all
    }

    /// The full path of the program a process runs, if Windows will say.
    #[allow(unsafe_code)]
    pub fn image(pid: u32) -> Option<String> {
        // SAFETY: querying a process by id; a failure is an error value.
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
        let mut buf = vec![0u16; 1024];
        let mut len = buf.len() as u32;
        // SAFETY: a live handle, and a buffer of the length passed.
        let got = unsafe {
            QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buf.as_mut_ptr()),
                &mut len,
            )
        }
        .is_ok();
        // SAFETY: opened above and not used after this.
        let _ = unsafe { CloseHandle(handle) };
        got.then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }

    pub struct Window {
        pub hwnd: HWND,
        pub pid: u32,
        pub title: String,
    }

    /// The windows a person would call windows: shown, owned by nobody, titled,
    /// and not a tool palette. In front-to-back order.
    #[allow(unsafe_code)]
    pub fn windows() -> Vec<Window> {
        unsafe extern "system" fn each(hwnd: HWND, found: LPARAM) -> BOOL {
            // SAFETY: the pointer is the Vec passed to EnumWindows below, which
            // outlives the enumeration.
            let found = unsafe { &mut *(found.0 as *mut Vec<Window>) };
            // SAFETY: plain queries on a window handle Windows just gave us.
            unsafe {
                let tool = (GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32) & WS_EX_TOOLWINDOW.0 != 0;
                let owned = GetWindow(hwnd, GW_OWNER).is_ok_and(|o| !o.is_invalid());
                if IsWindowVisible(hwnd).as_bool() && !tool && !owned {
                    let len = GetWindowTextLengthW(hwnd);
                    if len > 0 {
                        let mut buf = vec![0u16; len as usize + 1];
                        let n = GetWindowTextW(hwnd, &mut buf);
                        let mut pid = 0u32;
                        GetWindowThreadProcessId(hwnd, Some(&mut pid));
                        found.push(Window {
                            hwnd,
                            pid,
                            title: String::from_utf16_lossy(&buf[..n.max(0) as usize]),
                        });
                    }
                }
            }
            true.into()
        }
        let mut found: Vec<Window> = Vec::new();
        // SAFETY: the callback only touches `found`, which lives past the call.
        let _ = unsafe { EnumWindows(Some(each), LPARAM(&mut found as *mut _ as isize)) };
        found
    }

    /// Restores a minimised window and asks Windows to put it in front. Says
    /// which program kept the front when Windows refuses: a program's name,
    /// never a window's title.
    #[allow(unsafe_code)]
    pub fn raise(hwnd: HWND) -> Result<(), String> {
        // SAFETY: plain calls on a window handle found just now. A window that
        // has closed since only makes them fail.
        unsafe {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            let before = GetForegroundWindow();
            // Windows says at once whether it agrees. The switch itself finishes
            // on the other program's thread a moment later, so asking which
            // window is in front straight after would find none.
            if SetForegroundWindow(hwnd).as_bool() {
                return Ok(());
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(before, Some(&mut pid));
            let holder = processes()
                .remove(&pid)
                .map_or_else(|| "another program".to_string(), |(_, name)| name);
            Err(format!("Windows kept {holder} in front"))
        }
    }
}
