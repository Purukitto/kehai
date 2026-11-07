//! Opening a notification's app from a tap on the panel.
//!
//! The notification list names the app each notification came from by its app
//! id, the name Windows groups that app's windows and notifications under. It
//! never says which chat or link a notification leads to: only the app that
//! sent it and Windows see that. So a tap opens the app. Its window comes
//! forward if it has one; if not, the app is started through its Start menu
//! entry, as the Start menu would start it, which also brings back an app
//! sitting in the tray. A notification Kehai can't trace to an app (an old
//! tray-icon pop-up, Windows' own notices) opens Windows' notification list
//! instead, where clicking it does exactly what it meant.
//!
//! Only ids from Windows' own list reach here. An app is started by its Start
//! entry, looked up by that id, never by a path or a link made from it.

use serde::Serialize;

/// What a tap on a notification opens. Mirrors `NotifyItem['opens']`.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Opens {
    App,
    List,
}

/// How a tap ended. Mirrors `NotifyOpened['how']`.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum How {
    /// One of its windows came to the front.
    Front,
    /// It had no window, so its Start entry was started.
    Started,
    /// Windows' notification list opened instead.
    List,
}

/// Where an app id leads: the Start entry that starts it, and the program
/// that entry runs, which is how a program's windows are known when they
/// carry no app id of their own.
#[derive(Clone, PartialEq, Eq, Debug)]
#[cfg_attr(not(windows), allow(dead_code))]
struct Route {
    id: String,
    exe: Option<String>,
}

/// The package a packaged app's id belongs to: `Family!App` → `Family`.
#[cfg_attr(not(windows), allow(dead_code))]
fn family(app: &str) -> Option<&str> {
    let (family, rest) = app.split_once('!')?;
    (!family.is_empty() && !rest.is_empty()).then_some(family)
}

/// What a window says about whose it is.
#[derive(Default)]
#[cfg_attr(not(windows), allow(dead_code))]
struct Whose {
    /// The app id the window itself carries, as packaged apps' windows do.
    window: Option<String>,
    /// A packaged process's own app id.
    package: Option<String>,
    /// The full path of the program it runs.
    image: Option<String>,
}

/// Whether a window is the app's by its app id: certain.
#[cfg_attr(not(windows), allow(dead_code))]
fn by_id(whose: &Whose, route: &Route) -> bool {
    let same = |a: &Option<String>| {
        a.as_deref()
            .is_some_and(|a| a.eq_ignore_ascii_case(&route.id))
    };
    same(&whose.window) || same(&whose.package)
}

/// Whether a window is the app's by the program it runs, for apps whose windows
/// carry no id. A window that names a different app is not: a web app runs in
/// its browser's program but is an app of its own.
#[cfg_attr(not(windows), allow(dead_code))]
fn by_program(whose: &Whose, route: &Route) -> bool {
    let Some(exe) = route.exe.as_deref() else {
        return false;
    };
    whose.image.as_deref().is_some_and(|i| same_program(i, exe))
        && whose
            .window
            .as_deref()
            .is_none_or(|w| w.eq_ignore_ascii_case(&route.id))
}

/// Whether a running program is the one a Start entry runs. Apps that update
/// themselves in place, the way many chat apps do, keep a small launcher in
/// their folder and run from an `app-<version>` folder beside it: the entry
/// runs `Chat\chat.exe` (or `Chat\Update.exe`), the window belongs to
/// `Chat\app-1.2.3\chat.exe`.
#[cfg_attr(not(windows), allow(dead_code))]
fn same_program(image: &str, exe: &str) -> bool {
    if image.eq_ignore_ascii_case(exe) {
        return true;
    }
    let image: Vec<&str> = image.split(['\\', '/']).collect();
    let exe: Vec<&str> = exe.split(['\\', '/']).collect();
    let (Some((name, [root @ .., version])), Some((launcher, folder))) =
        (image.split_last(), exe.split_last())
    else {
        return false;
    };
    version
        .get(..4)
        .is_some_and(|p| p.eq_ignore_ascii_case("app-"))
        && root.len() == folder.len()
        && root
            .iter()
            .zip(folder)
            .all(|(a, b)| a.eq_ignore_ascii_case(b))
        && (name.eq_ignore_ascii_case(launcher) || launcher.eq_ignore_ascii_case("update.exe"))
}

/// The first window, front to back, that is the app's: by its id if any is,
/// else by its program.
#[cfg_attr(not(windows), allow(dead_code))]
fn pick<T: Copy>(windows: &[(T, Whose)], route: &Route) -> Option<T> {
    windows
        .iter()
        .find(|(_, w)| by_id(w, route))
        .or_else(|| windows.iter().find(|(_, w)| by_program(w, route)))
        .map(|(h, _)| *h)
}

/// What a tap on a notification from this app would open.
pub fn opens(app: &str) -> Option<Opens> {
    platform::opens(app)
}

/// Opens a notification's app, or Windows' list for one that has none. Windows
/// lets only the program that took the last input bring a window forward, so
/// call it straight from a tap on this PC.
pub fn open(app: &str) -> Result<How, String> {
    platform::open(app)
}

// ----------------------------------------------------------------- the dock

/// One app in the Start menu: the name it shows there, and the id it starts by.
#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
pub struct StartApp {
    pub id: String,
    pub name: String,
}

/// Whether a Start entry is an app someone would put in a dock: not a web
/// link, a document beside an app, or its uninstaller.
#[cfg_attr(not(windows), allow(dead_code))]
fn is_app(id: &str, name: &str) -> bool {
    let id_lower = id.to_ascii_lowercase();
    let pathlike = id.contains('\\') || id.contains('/');
    !id.is_empty()
        && !name.trim().is_empty()
        && !id.contains("://")
        && !name.to_ascii_lowercase().starts_with("uninstall")
        && (!pathlike || id_lower.ends_with(".exe"))
}

/// The apps in the Start menu, by name.
pub fn start_menu() -> Vec<StartApp> {
    platform::start_menu()
}

/// Brings an app's window forward, or starts it from its Start entry. Unlike a
/// notification's, an app with no Start entry opens nothing.
pub fn open_app(id: &str) -> Result<How, String> {
    platform::open_app(id)
}

/// Opens a web link, a file or a folder the way Windows opens one clicked in
/// File Explorer. Only for what the dock checked first.
pub fn open_thing(target: &str) -> Result<(), String> {
    platform::open_thing(target)
}

/// Which of these apps have a window open now, from one look at the windows.
pub fn running(ids: &[String]) -> std::collections::HashSet<String> {
    platform::running(ids)
}

/// Whether a process runs inside this app: the app is its program, or the
/// program of a process above it, as the app an agent's session runs in is.
pub fn hosts(id: &str, pid: u32) -> bool {
    platform::hosts(id, pid)
}

/// Whether Windows' privacy records, which name an app by its package or by
/// its program's path, mean this app.
pub fn is_holder(id: &str, package: Option<&str>, exe: Option<&str>) -> bool {
    platform::is_holder(id, package, exe)
}

/// What the Start menu calls a package or a program, for saying which app has
/// the microphone. A program with no Start entry goes by its file's name.
pub fn name_for(package: Option<&str>, exe: Option<&str>) -> Option<String> {
    platform::name_for(package, exe)
}

/// An app's own icon, square, as a PNG data URL.
pub fn icon(id: &str, px: u32) -> Option<String> {
    platform::icon(id, px)
}

/// A program's file name without `.exe`, for one that has no Start entry.
#[cfg_attr(not(windows), allow(dead_code))]
fn file_stem(exe: &str) -> Option<String> {
    let name = exe.rsplit(['\\', '/']).next()?;
    let stem = name
        .strip_suffix(".exe")
        .or_else(|| name.strip_suffix(".EXE"))
        .unwrap_or(name);
    (!stem.is_empty()).then(|| stem.to_string())
}

/// Windows hands icons over in blue-green-red order with each colour already
/// multiplied by its opacity. PNG wants red first and colours as they are. An
/// icon with no opacity at all has none to speak of: it is solid.
#[cfg_attr(not(windows), allow(dead_code))]
fn straighten(bgra: &mut [u8]) {
    let solid = bgra.chunks_exact(4).all(|p| p[3] == 0);
    for p in bgra.chunks_exact_mut(4) {
        p.swap(0, 2);
        if solid {
            p[3] = 255;
        } else if p[3] > 0 && p[3] < 255 {
            let a = u16::from(p[3]);
            for c in &mut p[..3] {
                *c = ((u16::from(*c) * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::collections::{HashMap, HashSet};
    use std::sync::{LazyLock, Mutex};
    use std::time::{Duration, Instant};

    use windows::core::{Interface, GUID, HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HWND, PROPERTYKEY, SIZE};
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
    };
    use windows::Win32::Storage::Packaging::Appx::GetApplicationUserModelId;
    use windows::Win32::System::Com::StructuredStorage::{
        PropVariantClear, PropVariantToStringAlloc,
    };
    use windows::Win32::System::Com::{
        CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT, COINIT_APARTMENTTHREADED,
        COINIT_DISABLE_OLE1DDE, COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::Shell::PropertiesSystem::{
        IPropertyStore, SHGetPropertyStoreForWindow,
    };
    use windows::Win32::UI::Shell::{
        BHID_EnumItems, FOLDERID_AppsFolder, IEnumShellItems, IShellItem, IShellItem2,
        IShellItemImageFactory, SHCreateItemInKnownFolder, SHGetIDListFromObject,
        SHGetKnownFolderItem, ShellExecuteExW, KF_FLAG_DEFAULT, SEE_MASK_FLAG_NO_UI,
        SEE_MASK_IDLIST, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW, SIGDN_NORMALDISPLAY,
        SIGDN_PARENTRELATIVEPARSING, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, ASFW_ANY, SW_SHOWNORMAL,
    };

    use super::super::front;
    use super::{family, file_stem, is_app, pick, straighten, How, Opens, Route, StartApp, Whose};

    /// `System.AppUserModel.ID`: the app id a window or a Start entry carries.
    const PKEY_APP_ID: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3),
        pid: 5,
    };
    /// `System.Link.TargetParsingPath`: the program a Start entry runs.
    const PKEY_TARGET: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0xb9b4b3fc_2b51_4a42_b5d8_324146afcf25),
        pid: 2,
    };
    /// How long an app id with no Start entry is taken at its word. An app
    /// installed since then is found at the next look, ten minutes on.
    const UNKNOWN_FOR: Duration = Duration::from_secs(600);

    /// Where each app id seen this run leads, and when that was found.
    type Known = HashMap<String, (Option<Route>, Instant)>;
    /// Notifications come back every few seconds; Start entries change rarely.
    static ROUTES: LazyLock<Mutex<Known>> = LazyLock::new(|| Mutex::new(HashMap::new()));

    /// COM on this thread for as long as it lives, balanced on drop if it was
    /// this that joined. A thread already in the other apartment carries on in
    /// it: everything here works in either.
    struct Apartment(bool);

    impl Apartment {
        #[allow(unsafe_code)]
        fn join(kind: COINIT) -> Self {
            // SAFETY: no pointers. S_FALSE (already in it) counts, and is
            // balanced on drop like S_OK.
            Self(unsafe { CoInitializeEx(None, kind) }.is_ok())
        }
    }

    impl Drop for Apartment {
        #[allow(unsafe_code)]
        fn drop(&mut self) {
            if self.0 {
                // SAFETY: pairs the successful join above, on the same thread.
                unsafe { CoUninitialize() };
            }
        }
    }

    /// Takes a string the shell allocated, and frees it.
    #[allow(unsafe_code)]
    fn take(text: PWSTR) -> Option<String> {
        if text.is_null() {
            return None;
        }
        // SAFETY: a nul-terminated string from the shell, freed straight after.
        let out = unsafe { text.to_string() }.ok();
        // SAFETY: allocated with CoTaskMemAlloc by the call that returned it.
        unsafe { CoTaskMemFree(Some(text.0 as *const _)) };
        out.filter(|s| !s.is_empty())
    }

    /// The Start entry with this app id, if there is one.
    #[allow(unsafe_code)]
    fn entry(id: &str) -> Option<IShellItem2> {
        let id = HSTRING::from(id);
        // SAFETY: a known folder's id and a nul-terminated name that outlives the call.
        unsafe { SHCreateItemInKnownFolder(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, &id) }.ok()
    }

    /// The program a Start entry runs, where it is a program at all.
    #[allow(unsafe_code)]
    fn target(entry: &IShellItem2) -> Option<String> {
        // SAFETY: a live item and a property key that outlives the call.
        take(unsafe { entry.GetString(&PKEY_TARGET) }.ok()?)
            .filter(|t| t.to_ascii_lowercase().ends_with(".exe"))
    }

    /// The first Start entry of a package, for a notification-only app id such
    /// as Phone Link's, one per app on the phone.
    #[allow(unsafe_code)]
    fn first_of(family: &str) -> Option<String> {
        let guess = format!("{family}!App");
        if entry(&guess).is_some() {
            return Some(guess);
        }
        let prefix = format!("{}!", family.to_ascii_lowercase());
        // SAFETY: the Start menu's own folder, and its items, each released as it goes.
        unsafe {
            let folder: IShellItem =
                SHGetKnownFolderItem(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None).ok()?;
            let items: IEnumShellItems = folder.BindToHandler(None, &BHID_EnumItems).ok()?;
            loop {
                let mut one = [None];
                let mut got = 0u32;
                if items.Next(&mut one, Some(&mut got)).is_err() || got == 0 {
                    return None;
                }
                let item = one[0].take()?;
                if let Some(id) = take(
                    item.GetDisplayName(SIGDN_PARENTRELATIVEPARSING)
                        .unwrap_or(PWSTR::null()),
                ) {
                    if id.to_ascii_lowercase().starts_with(&prefix) {
                        return Some(id);
                    }
                }
            }
        }
    }

    fn resolve(app: &str) -> Option<Route> {
        let (id, found) = match entry(app) {
            Some(found) => (app.to_string(), found),
            None => {
                let id = first_of(family(app)?)?;
                let found = entry(&id)?;
                (id, found)
            }
        };
        Some(Route {
            exe: target(&found),
            id,
        })
    }

    fn route(app: &str) -> Option<Route> {
        let mut routes = ROUTES.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((known, at)) = routes.get(app) {
            if known.is_some() || at.elapsed() < UNKNOWN_FOR {
                return known.clone();
            }
        }
        let found = resolve(app);
        routes.insert(app.to_string(), (found.clone(), Instant::now()));
        found
    }

    pub fn opens(app: &str) -> Option<Opens> {
        let _com = Apartment::join(COINIT_MULTITHREADED);
        Some(if route(app).is_some() {
            Opens::App
        } else {
            Opens::List
        })
    }

    /// The app id a window carries itself, if any.
    #[allow(unsafe_code)]
    fn window_id(hwnd: HWND) -> Option<String> {
        // SAFETY: a window handle found just now; a closed one only fails.
        unsafe {
            let store: IPropertyStore = SHGetPropertyStoreForWindow(hwnd).ok()?;
            let mut value = store.GetValue(&PKEY_APP_ID).ok()?;
            let text = PropVariantToStringAlloc(&value).ok();
            let _ = PropVariantClear(&mut value);
            take(text?)
        }
    }

    /// A packaged process's own app id. Others have none.
    #[allow(unsafe_code)]
    fn package_id(pid: u32) -> Option<String> {
        // SAFETY: querying a process by id; a failure is an error value.
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
        let mut buf = vec![0u16; 256];
        let mut len = buf.len() as u32;
        // SAFETY: a live handle, and a buffer of the length passed.
        let got =
            unsafe { GetApplicationUserModelId(handle, &mut len, Some(PWSTR(buf.as_mut_ptr()))) };
        // SAFETY: opened above and not used after this.
        let _ = unsafe { CloseHandle(handle) };
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        (got.0 == 0 && end > 0).then(|| String::from_utf16_lossy(&buf[..end]))
    }

    /// Every other program's windows, front to back, with whose each is.
    fn windows() -> Vec<(HWND, Whose)> {
        let own = std::process::id();
        let mut images: HashMap<u32, Option<String>> = HashMap::new();
        front::windows()
            .into_iter()
            .filter(|w| w.pid != own)
            .map(|w| {
                let image = images
                    .entry(w.pid)
                    .or_insert_with(|| front::image(w.pid))
                    .clone();
                let whose = Whose {
                    window: window_id(w.hwnd),
                    package: package_id(w.pid),
                    image,
                };
                (w.hwnd, whose)
            })
            .collect()
    }

    /// Starts what a Start entry or a link starts, without Windows' own error
    /// boxes: the panel says when it couldn't.
    #[allow(unsafe_code)]
    fn shell_open(info: &mut SHELLEXECUTEINFOW) -> Result<(), String> {
        info.cbSize = size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask |= SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
        info.nShow = SW_SHOWNORMAL.0;
        // SAFETY: no pointers. Whatever starts may take the front: the tap
        // that asked for it is the last input, so Windows lets Kehai pass it on.
        let _ = unsafe { AllowSetForegroundWindow(ASFW_ANY) };
        // SAFETY: a filled-in structure whose pointers outlive the call.
        unsafe { ShellExecuteExW(info) }
            .map_err(|e| format!("Windows would not start it: {}", e.message()))
    }

    #[allow(unsafe_code)]
    fn start(id: &str) -> Result<(), String> {
        let found = entry(id).ok_or_else(|| "its Start entry has gone".to_string())?;
        // SAFETY: a live item; the list it returns is freed below.
        let list = unsafe { SHGetIDListFromObject(&found) }.map_err(|e| e.message())?;
        let mut info = SHELLEXECUTEINFOW {
            fMask: SEE_MASK_IDLIST,
            lpIDList: list.cast(),
            ..Default::default()
        };
        let started = shell_open(&mut info);
        // SAFETY: allocated by SHGetIDListFromObject, and not used after this.
        unsafe { CoTaskMemFree(Some(list as *const _)) };
        started
    }

    /// Windows' own notification list, on the main display.
    fn list() -> Result<How, String> {
        let link = HSTRING::from("ms-actioncenter:");
        let mut info = SHELLEXECUTEINFOW {
            lpFile: PCWSTR(link.as_ptr()),
            ..Default::default()
        };
        shell_open(&mut info).map(|()| How::List)
    }

    pub fn open(app: &str) -> Result<How, String> {
        let _com = Apartment::join(COINIT(
            COINIT_APARTMENTTHREADED.0 | COINIT_DISABLE_OLE1DDE.0,
        ));
        let Some(route) = route(app) else {
            return list();
        };
        if let Some(hwnd) = pick(&windows(), &route) {
            return front::raise(hwnd).map(|()| How::Front);
        }
        start(&route.id).map(|()| How::Started)
    }

    // ------------------------------------------------------------- the dock

    /// The Start menu's apps, kept for a while: it changes when something is
    /// installed, not from one look to the next.
    type Menu = Option<(Vec<StartApp>, Instant)>;
    static MENU: LazyLock<Mutex<Menu>> = LazyLock::new(|| Mutex::new(None));
    const MENU_FOR: Duration = Duration::from_secs(300);

    #[allow(unsafe_code)]
    fn read_menu() -> Vec<StartApp> {
        let mut all: Vec<StartApp> = Vec::new();
        // SAFETY: the Start menu's own folder, and its items, each released as it goes.
        unsafe {
            let Ok(folder) =
                SHGetKnownFolderItem::<IShellItem>(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None)
            else {
                return all;
            };
            let Ok(items) = folder.BindToHandler::<_, IEnumShellItems>(None, &BHID_EnumItems)
            else {
                return all;
            };
            loop {
                let mut one = [None];
                let mut got = 0u32;
                if items.Next(&mut one, Some(&mut got)).is_err() || got == 0 {
                    break;
                }
                let Some(item) = one[0].take() else { break };
                let id = take(
                    item.GetDisplayName(SIGDN_PARENTRELATIVEPARSING)
                        .unwrap_or(PWSTR::null()),
                );
                let name = take(
                    item.GetDisplayName(SIGDN_NORMALDISPLAY)
                        .unwrap_or(PWSTR::null()),
                );
                if let (Some(id), Some(name)) = (id, name) {
                    if is_app(&id, &name) && !all.iter().any(|a| a.id == id) {
                        all.push(StartApp { id, name });
                    }
                }
            }
        }
        all.sort_by_key(|a| a.name.to_lowercase());
        all
    }

    pub fn start_menu() -> Vec<StartApp> {
        let _com = Apartment::join(COINIT_MULTITHREADED);
        let mut menu = MENU.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((apps, at)) = menu.as_ref() {
            if at.elapsed() < MENU_FOR {
                return apps.clone();
            }
        }
        let apps = read_menu();
        *menu = Some((apps.clone(), Instant::now()));
        apps
    }

    pub fn open_app(id: &str) -> Result<How, String> {
        let _com = Apartment::join(COINIT(
            COINIT_APARTMENTTHREADED.0 | COINIT_DISABLE_OLE1DDE.0,
        ));
        let route = route(id).ok_or_else(|| "it is no longer in the Start menu".to_string())?;
        if let Some(hwnd) = pick(&windows(), &route) {
            return front::raise(hwnd).map(|()| How::Front);
        }
        start(&route.id).map(|()| How::Started)
    }

    pub fn open_thing(target: &str) -> Result<(), String> {
        let _com = Apartment::join(COINIT(
            COINIT_APARTMENTTHREADED.0 | COINIT_DISABLE_OLE1DDE.0,
        ));
        let target = HSTRING::from(target);
        let mut info = SHELLEXECUTEINFOW {
            lpFile: PCWSTR(target.as_ptr()),
            ..Default::default()
        };
        shell_open(&mut info)
    }

    pub fn running(ids: &[String]) -> HashSet<String> {
        let _com = Apartment::join(COINIT_MULTITHREADED);
        let wins = windows();
        ids.iter()
            .filter(|id| route(id).is_some_and(|r| pick(&wins, &r).is_some()))
            .cloned()
            .collect()
    }

    /// How far up from an agent's process its app can be.
    const MAX_UP: usize = 12;

    pub fn hosts(id: &str, pid: u32) -> bool {
        let _com = Apartment::join(COINIT_MULTITHREADED);
        let Some(route) = route(id) else { return false };
        let procs = front::processes();
        let mut at = pid;
        for _ in 0..MAX_UP {
            let Some((parent, name)) = procs.get(&at) else {
                return false;
            };
            if name == "explorer.exe" || name == "services.exe" {
                return false;
            }
            let whose = Whose {
                window: None,
                package: package_id(at),
                image: front::image(at),
            };
            if super::by_id(&whose, &route) || super::by_program(&whose, &route) {
                return true;
            }
            if *parent == 0 || *parent == at {
                return false;
            }
            at = *parent;
        }
        false
    }

    pub fn is_holder(id: &str, package: Option<&str>, exe: Option<&str>) -> bool {
        let _com = Apartment::join(COINIT_MULTITHREADED);
        let Some(route) = route(id) else { return false };
        let by_package =
            package.is_some_and(|p| family(&route.id).is_some_and(|f| f.eq_ignore_ascii_case(p)));
        let by_exe = exe.is_some_and(|e| {
            route
                .exe
                .as_deref()
                .is_some_and(|r| super::same_program(e, r))
        });
        by_package || by_exe
    }

    pub fn name_for(package: Option<&str>, exe: Option<&str>) -> Option<String> {
        let menu = start_menu();
        let _com = Apartment::join(COINIT_MULTITHREADED);
        if let Some(p) = package {
            if let Some(app) = menu
                .iter()
                .find(|a| family(&a.id).is_some_and(|f| f.eq_ignore_ascii_case(p)))
            {
                return Some(app.name.clone());
            }
        }
        if let Some(e) = exe {
            let found = menu.iter().find(|a| {
                route(&a.id)
                    .and_then(|r| r.exe)
                    .is_some_and(|r| super::same_program(e, &r))
            });
            return found.map(|a| a.name.clone()).or_else(|| file_stem(e));
        }
        None
    }

    #[allow(unsafe_code)]
    pub fn icon(id: &str, px: u32) -> Option<String> {
        let _com = Apartment::join(COINIT_MULTITHREADED);
        let item = entry(id)?;
        // SAFETY: a live item; the bitmap it hands back is ours, deleted below.
        let bitmap = unsafe {
            let factory: IShellItemImageFactory = item.cast().ok()?;
            factory
                .GetImage(
                    SIZE {
                        cx: px as i32,
                        cy: px as i32,
                    },
                    SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
                )
                .ok()?
        };
        let pixels = rgba(bitmap);
        // SAFETY: made by GetImage above, and not used after this.
        let _ = unsafe { DeleteObject(HGDIOBJ(bitmap.0)) };
        let (w, h, data) = pixels?;
        png_url(w, h, &data)
    }

    /// A bitmap's pixels as straight RGBA, top row first.
    #[allow(unsafe_code)]
    fn rgba(bitmap: HBITMAP) -> Option<(u32, u32, Vec<u8>)> {
        let mut bm = BITMAP::default();
        // SAFETY: a live bitmap, and a structure of the size passed.
        let got = unsafe {
            GetObjectW(
                HGDIOBJ(bitmap.0),
                size_of::<BITMAP>() as i32,
                Some((&mut bm as *mut BITMAP).cast()),
            )
        };
        if got == 0 || !(1..=512).contains(&bm.bmWidth) || !(1..=512).contains(&bm.bmHeight) {
            return None;
        }
        let (w, h) = (bm.bmWidth, bm.bmHeight);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                // Negative: the top row first.
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut data = vec![0u8; (w * h * 4) as usize];
        // SAFETY: the screen's context, released below; a buffer of the size
        // the header describes.
        let lines = unsafe {
            let dc = GetDC(None);
            let n = GetDIBits(
                dc,
                bitmap,
                0,
                h as u32,
                Some(data.as_mut_ptr().cast()),
                &mut info,
                DIB_RGB_COLORS,
            );
            ReleaseDC(None, dc);
            n
        };
        if lines == 0 {
            return None;
        }
        straighten(&mut data);
        Some((w as u32, h as u32, data))
    }

    /// Icons go to the panel as PNG, which the webview draws without help.
    fn png_url(w: u32, h: u32, rgba: &[u8]) -> Option<String> {
        use base64::Engine;
        let mut out = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, w, h);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().ok()?;
            writer.write_image_data(rgba).ok()?;
        }
        Some(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(out)
        ))
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{How, Opens, StartApp};

    pub fn opens(_app: &str) -> Option<Opens> {
        None
    }

    pub fn open(_app: &str) -> Result<How, String> {
        Err("opening a notification's app works only on Windows so far".to_string())
    }

    pub fn start_menu() -> Vec<StartApp> {
        Vec::new()
    }

    pub fn open_app(_id: &str) -> Result<How, String> {
        Err("the dock opens apps only on Windows so far".to_string())
    }

    pub fn open_thing(_target: &str) -> Result<(), String> {
        Err("the dock opens things only on Windows so far".to_string())
    }

    pub fn running(_ids: &[String]) -> std::collections::HashSet<String> {
        std::collections::HashSet::new()
    }

    pub fn hosts(_id: &str, _pid: u32) -> bool {
        false
    }

    pub fn is_holder(_id: &str, _package: Option<&str>, _exe: Option<&str>) -> bool {
        false
    }

    pub fn name_for(_package: Option<&str>, _exe: Option<&str>) -> Option<String> {
        None
    }

    pub fn icon(_id: &str, _px: u32) -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route(id: &str, exe: Option<&str>) -> Route {
        Route {
            id: id.to_string(),
            exe: exe.map(str::to_string),
        }
    }

    fn whose(window: Option<&str>, package: Option<&str>, image: Option<&str>) -> Whose {
        Whose {
            window: window.map(str::to_string),
            package: package.map(str::to_string),
            image: image.map(str::to_string),
        }
    }

    #[test]
    fn a_packaged_id_has_a_family() {
        assert_eq!(
            family("Microsoft.YourPhone_8wekyb3d8bbwe!YourPhoneNotifications_x"),
            Some("Microsoft.YourPhone_8wekyb3d8bbwe")
        );
        assert_eq!(family("com.squirrel.Discord.Discord"), None);
        assert_eq!(family("!App"), None);
        assert_eq!(family("Family!"), None);
    }

    #[test]
    fn a_window_carrying_the_id_is_the_apps() {
        let r = route("Pkg_abc!App", None);
        assert!(by_id(&whose(Some("pkg_ABC!app"), None, None), &r));
        assert!(by_id(&whose(None, Some("Pkg_abc!App"), None), &r));
        assert!(!by_id(&whose(Some("Other!App"), None, None), &r));
    }

    #[test]
    fn a_window_of_the_entrys_program_is_the_apps_unless_it_names_another() {
        let r = route("com.example.chat", Some(r"C:\Apps\Chat\chat.exe"));
        assert!(by_program(
            &whose(None, None, Some(r"c:\apps\chat\CHAT.EXE")),
            &r
        ));
        assert!(!by_program(
            &whose(None, None, Some(r"C:\Apps\Other\chat.exe")),
            &r
        ));
        // A web app in the same browser program is an app of its own.
        let browser = route("Browser", Some(r"C:\B\browser.exe"));
        assert!(!by_program(
            &whose(Some("Browser.App.Mail"), None, Some(r"C:\B\browser.exe")),
            &browser
        ));
        // An entry that runs no program of its own matches no window by program.
        assert!(!by_program(
            &whose(None, None, Some(r"C:\x.exe")),
            &route("Pkg!App", None)
        ));
    }

    #[test]
    fn an_app_that_updates_in_place_runs_from_a_version_folder_beside_its_launcher() {
        let launcher = r"C:\Users\u\AppData\Local\Chat\chat.exe";
        assert!(same_program(
            r"C:\Users\u\AppData\Local\Chat\app-1.0.9267\Chat.exe",
            launcher
        ));
        assert!(same_program(
            r"C:\Users\u\AppData\Local\Chat\app-1.0.9267\chat.exe",
            r"C:\Users\u\AppData\Local\Chat\Update.exe"
        ));
        // Not a version folder, another app's folder, or another program.
        assert!(!same_program(
            r"C:\Users\u\AppData\Local\Chat\bin\chat.exe",
            launcher
        ));
        assert!(!same_program(
            r"C:\Users\u\AppData\Local\Other\app-1.0\chat.exe",
            launcher
        ));
        assert!(!same_program(
            r"C:\Users\u\AppData\Local\Chat\app-1.0\helper.exe",
            launcher
        ));
        assert!(!same_program(r"chat.exe", launcher));
        assert!(by_program(
            &whose(
                None,
                None,
                Some(r"C:\Users\u\AppData\Local\Chat\app-2.1\chat.exe")
            ),
            &route("com.squirrel.Chat.chat", Some(launcher))
        ));
    }

    #[test]
    fn a_window_with_the_id_wins_over_one_further_forward_with_only_the_program() {
        let r = route("Browser.App.Mail", Some(r"C:\B\browser.exe"));
        let windows = [
            (1, whose(None, None, Some(r"C:\B\browser.exe"))),
            (
                2,
                whose(Some("Browser.App.Mail"), None, Some(r"C:\B\browser.exe")),
            ),
        ];
        assert_eq!(pick(&windows, &r), Some(2));
        let plain = route("com.example.chat", Some(r"C:\Chat\chat.exe"));
        let front_first = [
            (7, whose(None, None, Some(r"C:\Chat\chat.exe"))),
            (8, whose(None, None, Some(r"C:\Chat\chat.exe"))),
        ];
        assert_eq!(pick(&front_first, &plain), Some(7));
        assert_eq!(
            pick(&[(9, whose(None, None, Some(r"C:\y.exe")))], &plain),
            None
        );
    }

    #[test]
    fn only_apps_are_offered_for_the_dock() {
        assert!(is_app("com.squirrel.Discord.Discord", "Discord"));
        assert!(is_app(
            "Microsoft.YourPhone_8wekyb3d8bbwe!App",
            "Phone Link"
        ));
        assert!(is_app(r"D:\Steam\Steam.exe", "Steam"));
        assert!(!is_app(
            "http://support.steampowered.com/",
            "Steam Support Center"
        ));
        assert!(!is_app(r"{6D809377}\App\readme.txt", "Read me"));
        assert!(!is_app("App.Uninstall", "Uninstall App"));
        assert!(!is_app("", "Nameless"));
    }

    #[test]
    fn a_program_without_an_entry_goes_by_its_file_name() {
        assert_eq!(file_stem(r"C:\Apps\Chat\Chat.exe").as_deref(), Some("Chat"));
        assert_eq!(file_stem("C:/x/rec.EXE").as_deref(), Some("rec"));
        assert_eq!(file_stem(r"C:\x\"), None);
    }

    #[test]
    fn icons_come_out_red_first_and_unmultiplied() {
        // Half-opaque pure blue, premultiplied: B=128, A=128.
        let mut px = vec![128, 0, 0, 128, 10, 20, 30, 255];
        straighten(&mut px);
        assert_eq!(px, vec![0, 0, 255, 128, 30, 20, 10, 255]);
        // An icon with no opacity at all is solid.
        let mut flat = vec![1, 2, 3, 0];
        straighten(&mut flat);
        assert_eq!(flat, vec![3, 2, 1, 255]);
    }

    /// Where each app that has sent notifications on this PC leads, read from
    /// the registry's list of them. Opens nothing. Run by hand:
    /// `cargo test routes_this_pc -- --ignored --nocapture`.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn routes_this_pc() {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        // SAFETY: no pointers.
        #[allow(unsafe_code)]
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let out = std::process::Command::new("reg")
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings",
            ])
            .output()
            .expect("reg runs");
        let text = String::from_utf8_lossy(&out.stdout);
        let (mut app, mut list) = (0, 0);
        for line in text.lines() {
            let Some(id) = line
                .trim()
                .rsplit('\\')
                .next()
                .filter(|_| line.starts_with("HKEY_"))
            else {
                continue;
            };
            match opens(id) {
                Some(Opens::App) => app += 1,
                _ => list += 1,
            }
        }
        println!("open their app: {app}, Windows' list: {list}");
        assert!(app > 0);
    }
}
