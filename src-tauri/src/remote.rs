//! The remote panel: the renderer and the bus, served to a browser on another
//! machine, so a second display can hang off a different computer from the one
//! being watched.
//!
//! Off unless turned on. Everything past the page itself — the bus over a
//! WebSocket, the REST API — needs the key, which lives in the link Settings
//! hands out. A remote panel only reads, unless the host also allows control,
//! and even then it can only press the buttons the panel itself has.
//!
//! While it serves, Kehai also announces itself on the local network over
//! mDNS, with this machine's name and the port and nothing else, so a paired
//! tablet can find it again after the router hands out a new address.

use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, Ipv4Addr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Sender, TryRecvError};
use std::sync::{Arc, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use mdns_sd::{IfKind, IfPredicate, ServiceDaemon, ServiceInfo};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Listener, Manager};
use tungstenite::handshake::derive_accept_key;
use tungstenite::protocol::frame::coding::CloseCode;
use tungstenite::protocol::{CloseFrame, Role, WebSocketConfig};
use tungstenite::{Bytes, Message, WebSocket};

use crate::bus;
use crate::log;
use crate::pollers::notify;

const TOPIC: &str = "app:remote";
const SRC: &str = "remote";
const STORE_FILE: &str = "remote.json";
const DEFAULT_PORT: u16 = 5280;
/// The mDNS service type Kehai announces while it serves.
const SERVICE: &str = "_kehai._tcp.local.";
/// A second display, maybe a third. Past this a connection is turned away
/// rather than allowed to multiply the work every publish does.
const MAX_CLIENTS: usize = 8;
const HEAD_LIMIT: usize = 16 * 1024;
/// Commands are a few dozen bytes. Nothing a remote sends needs more.
const BODY_LIMIT: usize = 64 * 1024;
/// How long a new socket has to say who it is.
const HELLO_WITHIN: Duration = Duration::from_secs(5);
const PING_EVERY: Duration = Duration::from_secs(20);
/// A browser answers pings by itself, so this much silence is a dead link.
const SILENT_FOR: Duration = Duration::from_secs(60);
/// How often an idle connection looks for something to send. The sockets are
/// blocking, so this is a read timeout, not a sleep.
const POLL: Duration = Duration::from_millis(100);
/// Not for remote eyes: this server's own settings, key included, an update a
/// remote panel could not install anyway, the host's monitors and window,
/// which a browser has no part in, whether anyone is at the host's desk, the
/// host's log, where its games are and the widget files in its folder. A
/// game's own state is not here: a tablet shows its tile like any other.
const PRIVATE_TOPICS: [&str; 9] = [
    TOPIC,
    "app:update",
    "app:displays",
    "app:window",
    "os:presence",
    "app:log",
    "app:log-copy",
    "game:setup",
    "widgets:local",
];
/// Close codes in the application range, read by `remoteSource.ts`.
const CLOSE_UNPAIRED: u16 = 4401;
const CLOSE_FULL: u16 = 4429;

/// What a remote panel may ask for, and only when control is allowed: the
/// buttons on the panel itself. Nothing here names a path, a URL or a setting,
/// and a focus timer's lengths are the host's to choose. Seek and volume carry
/// a number, which the media poller puts in range itself.
fn allowed(topic: &str, action: &str) -> bool {
    matches!(
        (topic, action),
        (
            "media:command",
            "playpause" | "next" | "previous" | "seek" | "volume" | "mute"
        ) | ("notify:command", "dismiss" | "clear")
            | ("flow:command", "start" | "pause" | "skip" | "reset")
    )
}

/// Mirrors `RemotePayload` in `src/core/payloads.ts`. Only ever sent to the
/// local panel: see `PRIVATE_TOPICS`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RemotePayload {
    on: bool,
    listening: bool,
    port: u16,
    /// What this machine calls itself, as the links and the network name it.
    name: String,
    /// Where another machine can open the panel, real adapters first.
    addresses: Vec<Address>,
    key: Option<String>,
    control: bool,
    clients: usize,
    error: Option<String>,
}

/// One address another device might reach this machine on. Mirrors
/// `RemoteAddress` in `src/core/payloads.ts`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Address {
    /// The network adapter's own name, such as Ethernet or Wi-Fi.
    adapter: String,
    ip: String,
    /// Made by software on this machine, so no other device can reach it.
    #[serde(rename = "virtual")]
    is_virtual: bool,
    /// Opens the panel at this address, key and name included.
    link: String,
}

/// Renderer → engine on `remote:command`. Mirrors `RemoteCommand` in
/// `src/core/payloads.ts`. The local panel's settings hold the switch, the port
/// and whether control is allowed; the key is the engine's own.
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Command {
    Configure {
        on: bool,
        port: u16,
        control: bool,
    },
    /// Cuts off every remote panel, which then needs the new link.
    NewKey,
}

enum Msg {
    Command(Command),
    /// A remote panel came or went.
    Clients,
}

#[derive(Serialize, Deserialize)]
struct Stored {
    key: String,
}

struct Shared {
    app: AppHandle,
    /// This machine's name, told to each remote panel as it connects.
    name: String,
    key: RwLock<String>,
    control: AtomicBool,
    clients: AtomicUsize,
    /// Bumped with every new key. A connection paired under an older one is
    /// closed at its next look.
    generation: AtomicU64,
    events: Sender<Msg>,
}

impl Shared {
    fn key_matches(&self, offered: &str) -> bool {
        let Ok(key) = self.key.read() else {
            return false;
        };
        !key.is_empty() && same(key.as_bytes(), offered.as_bytes())
    }
}

/// Compares in time that does not depend on where the inputs first differ, so
/// the key cannot be found a byte at a time by timing refusals. The games'
/// keys are checked with it too.
pub(crate) fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// One listening socket. Dropping it stops it and waits for the port to free.
struct Listening {
    port: u16,
    stop: Arc<AtomicBool>,
    accept: Option<JoinHandle<()>>,
    /// Withdrawn when this drops, after the socket has stopped.
    _announced: Option<Announced>,
}

impl Drop for Listening {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.accept.take() {
            let _ = handle.join();
        }
    }
}

fn new_key() -> Option<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).ok()?;
    Some(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn store_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(STORE_FILE))
}

fn load(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    let stored: Stored = serde_json::from_str(&text).ok()?;
    (stored.key.len() == 32 && stored.key.bytes().all(|b| b.is_ascii_hexdigit()))
        .then_some(stored.key)
}

fn save(path: &Path, key: &str) {
    let Ok(text) = serde_json::to_string(&Stored {
        key: key.to_string(),
    }) else {
        return;
    };
    let result = path
        .parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|()| fs::write(path, text));
    if let Err(err) = result {
        log::problem(
            "remote",
            "Could not save the remote panels' key.",
            Some("After a restart, paired tablets need the link again."),
            err,
        );
    }
}

/// What this machine calls itself. The links carry it, so the Kehai app can
/// say which PC it is showing, and so does the announcement on the network.
fn host_name() -> String {
    sysinfo::System::host_name()
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Kehai".to_string())
}

/// Adapters made by software on this machine, which nothing else on the
/// network can reach: WSL and Hyper-V switches, Docker bridges, VM host-only
/// networks. Known by the names they come with.
fn virtual_adapter(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    // Windows names them in words; Linux by a prefix.
    let named = [
        "vethernet",
        "hyper-v",
        "wsl",
        "virtualbox",
        "vmware",
        "docker",
    ];
    let prefixed = ["veth", "virbr", "vboxnet", "vmnet", "br-"];
    named.iter().any(|v| name.contains(v)) || prefixed.iter().any(|v| name.starts_with(v))
}

/// Home networks first, since a tablet on the desk is most likely on one:
/// 192.168/16, then 10/8, then 172.16/12, where WSL and Docker also put
/// themselves. Sorting the addresses as text put 172 before 192.
fn rank(ip: Ipv4Addr) -> u8 {
    match ip.octets() {
        [192, 168, ..] => 0,
        [10, ..] => 1,
        [172, b, ..] if (16..32).contains(&b) => 2,
        _ => 3,
    }
}

/// Everything but letters, digits and `-._~` as `%XX`, so a name can sit in
/// the link beside the key.
fn escape(text: &str) -> String {
    text.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                char::from(b).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

/// Every address another machine might reach this one on, real adapters
/// first. Loopback and link-local addresses lead nowhere useful, and IPv6
/// ones make for links nobody would type.
fn addresses(port: u16, key: &str, name: &str) -> Vec<Address> {
    let networks = sysinfo::Networks::new_with_refreshed_list();
    let mut found: Vec<(bool, u8, Ipv4Addr, String)> = networks
        .iter()
        .flat_map(|(adapter, data)| {
            data.ip_networks()
                .iter()
                .filter_map(move |net| match net.addr {
                    IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_link_local() => {
                        Some((virtual_adapter(adapter), rank(v4), v4, adapter.clone()))
                    }
                    _ => None,
                })
        })
        .collect();
    found.sort();
    found.dedup_by_key(|(_, _, ip, _)| *ip);
    let name = escape(name);
    found
        .into_iter()
        .map(|(is_virtual, _, ip, adapter)| Address {
            adapter,
            ip: ip.to_string(),
            is_virtual,
            link: format!("http://{ip}:{port}/#key={key}&name={name}"),
        })
        .collect()
}

/// Kehai on the local network over mDNS while it serves: this machine's name
/// and the port, never the key. A paired tablet whose PC has moved to a new
/// address finds it again by name. Virtual adapters are left out, as they are
/// last in the links, and so is IPv6, which no link uses.
struct Announced {
    daemon: ServiceDaemon,
    fullname: String,
}

impl Drop for Announced {
    fn drop(&mut self) {
        // A goodbye, so whoever was looking drops it now rather than when the
        // record would have run out.
        if let Ok(done) = self.daemon.unregister(&self.fullname) {
            let _ = done.recv_timeout(Duration::from_secs(1));
        }
        let _ = self.daemon.shutdown();
    }
}

fn announce(name: &str, port: u16) -> Option<Announced> {
    let daemon = match ServiceDaemon::new() {
        Ok(daemon) => daemon,
        Err(err) => {
            log::warn("remote", format!("not announced on the network: {err}"));
            return None;
        }
    };
    let _ = daemon.disable_interface(vec![
        IfKind::IPv6,
        IfKind::LoopbackV4,
        IfKind::Predicate(IfPredicate::new(|intf| virtual_adapter(&intf.name))),
    ]);
    // A host name of Kehai's own: Windows already answers for the machine's.
    let label: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let host = format!("kehai-{}.local.", label.trim_matches('-'));
    let registered = ServiceInfo::new(
        SERVICE,
        name,
        &host,
        "",
        port,
        None::<std::collections::HashMap<String, String>>,
    )
    .map(ServiceInfo::enable_addr_auto)
    .and_then(|info| {
        let fullname = info.get_fullname().to_string();
        daemon.register(info).map(|()| fullname)
    });
    match registered {
        Ok(fullname) => {
            log::info("remote", format!("announced on the network as {name}"));
            Some(Announced { daemon, fullname })
        }
        Err(err) => {
            log::warn("remote", format!("not announced on the network: {err}"));
            let _ = daemon.shutdown();
            None
        }
    }
}

pub fn spawn(app: AppHandle) {
    let (tx, rx) = mpsc::channel::<Msg>();

    let commands = tx.clone();
    app.listen("remote:command", move |event| {
        match serde_json::from_str::<Command>(event.payload()) {
            Ok(command) => {
                let _ = commands.send(Msg::Command(command));
            }
            Err(err) => log::warn("remote", format!("ignored a command: {err}")),
        }
    });

    thread::spawn(move || {
        let store = store_path(&app);
        let shared = Arc::new(Shared {
            app: app.clone(),
            name: host_name(),
            key: RwLock::new(store.as_deref().and_then(load).unwrap_or_default()),
            control: AtomicBool::new(false),
            clients: AtomicUsize::new(0),
            generation: AtomicU64::new(0),
            events: tx,
        });

        let mut on = false;
        let mut port = DEFAULT_PORT;
        let mut listening: Option<Listening> = None;
        let mut error: Option<String> = None;

        loop {
            let key = shared.key.read().map(|k| k.clone()).unwrap_or_default();
            let live = listening.is_some();
            bus::publish(
                &app,
                TOPIC,
                SRC,
                RemotePayload {
                    on,
                    listening: live,
                    port,
                    name: shared.name.clone(),
                    addresses: if live {
                        addresses(port, &key, &shared.name)
                    } else {
                        Vec::new()
                    },
                    key: (!key.is_empty()).then_some(key),
                    control: shared.control.load(Ordering::Relaxed),
                    clients: shared.clients.load(Ordering::Relaxed),
                    error: error.clone(),
                },
            );

            let Ok(msg) = rx.recv() else { return };
            match msg {
                Msg::Clients => {}
                Msg::Command(Command::Configure {
                    on: want_on,
                    port: want_port,
                    control,
                }) => {
                    shared.control.store(control, Ordering::Relaxed);
                    let want = want_on.then_some(want_port);
                    if listening.as_ref().map(|l| l.port) != want
                        || (want.is_some() && error.is_some())
                    {
                        // Stopped before the new one binds, which may be the same port.
                        listening = None;
                        error = None;
                        if let Some(port) = want {
                            match start(&shared, store.as_deref(), port) {
                                Ok(l) => listening = Some(l),
                                Err(e) => {
                                    log::problem(
                                        "remote",
                                        &e,
                                        Some("Remote panels can't connect until it can. Settings → Remote has the port."),
                                        format!("port {port}"),
                                    );
                                    error = Some(e);
                                }
                            }
                        }
                    }
                    on = want_on;
                    port = want_port;
                }
                Msg::Command(Command::NewKey) => match new_key() {
                    Some(key) => {
                        if let Some(path) = &store {
                            save(path, &key);
                        }
                        if let Ok(mut current) = shared.key.write() {
                            *current = key;
                        }
                        shared.generation.fetch_add(1, Ordering::Relaxed);
                        log::info("remote", "new key; every remote panel is disconnected");
                    }
                    None => error = Some("No randomness available for a new key.".into()),
                },
            }
        }
    });
}

/// Binds and starts accepting. The key is made here, the first time it is
/// needed, so a copy that never serves a remote panel never writes one.
fn start(shared: &Arc<Shared>, store: Option<&Path>, port: u16) -> Result<Listening, String> {
    if port < 1024 {
        return Err(format!("Port {port} is reserved. Pick one from 1024 up."));
    }
    let needs_key = shared.key.read().map(|k| k.is_empty()).unwrap_or(true);
    if needs_key {
        let key = new_key().ok_or("No randomness available to make a key.")?;
        if let Some(path) = store {
            save(path, &key);
        }
        if let Ok(mut current) = shared.key.write() {
            *current = key;
        }
    }

    let listener = TcpListener::bind(("0.0.0.0", port)).map_err(|e| match e.kind() {
        ErrorKind::AddrInUse => format!("Port {port} is already in use."),
        ErrorKind::PermissionDenied => format!("Not allowed to listen on port {port}."),
        _ => format!("Could not listen on port {port}: {e}"),
    })?;
    // Polled rather than blocked on, so turning the server off does not have
    // to wait for someone to connect.
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Could not listen on port {port}: {e}"))?;
    log::info("remote", format!("listening on port {port}"));

    let stop = Arc::new(AtomicBool::new(false));
    let accept = {
        let shared = Arc::clone(shared);
        let stop = Arc::clone(&stop);
        thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let shared = Arc::clone(&shared);
                        let stop = Arc::clone(&stop);
                        thread::spawn(move || serve(stream, &shared, &stop));
                    }
                    Err(e) if e.kind() == ErrorKind::WouldBlock => thread::sleep(POLL),
                    Err(e) => {
                        log::warn("remote", format!("accept failed: {e}"));
                        thread::sleep(POLL);
                    }
                }
            }
            log::info("remote", format!("stopped listening on port {port}"));
        })
    };

    Ok(Listening {
        port,
        stop,
        accept: Some(accept),
        _announced: announce(&shared.name, port),
    })
}

struct Request {
    method: String,
    path: String,
    host: Option<String>,
    upgrade: bool,
    ws_key: Option<String>,
    bearer: Option<String>,
    length: usize,
}

/// The request line and headers, and whatever arrived after them.
fn read_head(stream: &mut TcpStream) -> Option<(Request, Vec<u8>)> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let end = loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        if buf.len() > HEAD_LIMIT {
            return None;
        }
    };
    let rest = buf.split_off(end);

    let mut headers = [httparse::EMPTY_HEADER; 48];
    let mut parsed = httparse::Request::new(&mut headers);
    if !parsed.parse(&buf).ok()?.is_complete() {
        return None;
    }
    let header = |name: &str| {
        parsed
            .headers
            .iter()
            .find(|h| h.name.eq_ignore_ascii_case(name))
            .and_then(|h| std::str::from_utf8(h.value).ok())
            .map(|v| v.trim().to_string())
    };

    Some((
        Request {
            method: parsed.method?.to_string(),
            path: parsed
                .path?
                .split(['?', '#'])
                .next()
                .unwrap_or("/")
                .to_string(),
            host: header("host"),
            upgrade: header("upgrade").is_some_and(|u| u.eq_ignore_ascii_case("websocket")),
            ws_key: header("sec-websocket-key"),
            bearer: header("authorization")
                .and_then(|a| a.strip_prefix("Bearer ").map(|k| k.trim().to_string())),
            length: header("content-length")
                .and_then(|l| l.parse().ok())
                .unwrap_or(0),
        },
        rest,
    ))
}

fn respond(
    stream: &mut TcpStream,
    status: &str,
    kind: &str,
    extra: &[(&str, String)],
    body: &[u8],
    head_only: bool,
) {
    let mut out = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n",
        body.len()
    );
    for (name, value) in extra {
        out.push_str(&format!("{name}: {value}\r\n"));
    }
    out.push_str("\r\n");
    let _ = stream.write_all(out.as_bytes());
    if !head_only {
        let _ = stream.write_all(body);
    }
    let _ = stream.flush();
}

fn json(stream: &mut TcpStream, status: &str, value: &serde_json::Value) {
    let body = value.to_string();
    let no_store = [("Cache-Control", "no-store".to_string())];
    respond(
        stream,
        status,
        "application/json",
        &no_store,
        body.as_bytes(),
        false,
    );
}

fn serve(mut stream: TcpStream, shared: &Arc<Shared>, stop: &Arc<AtomicBool>) {
    let _ = stream.set_read_timeout(Some(HELLO_WITHIN));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_nodelay(true);

    let Some((request, rest)) = read_head(&mut stream) else {
        return;
    };

    if request.path == "/bus" && request.upgrade {
        websocket(stream, rest, request, shared, stop);
    } else if let Some(route) = request.path.strip_prefix("/api/") {
        let route = route.to_string();
        api(&mut stream, rest, &request, &route, shared);
    } else if request.method == "GET" || request.method == "HEAD" {
        page(&mut stream, &request, shared);
    } else {
        respond(
            &mut stream,
            "405 Method Not Allowed",
            "text/plain",
            &[],
            b"",
            false,
        );
    }
}

/// The renderer, from the assets compiled into this binary. They are no
/// secret — they are on GitHub — so the page itself needs no key; the data does.
fn page(stream: &mut TcpStream, request: &Request, shared: &Shared) {
    let head_only = request.method == "HEAD";
    let Some(asset) = shared.app.asset_resolver().get(request.path.clone()) else {
        // A dev build loads its renderer from the Vite server and has none to give.
        let body = b"This build of Kehai does not carry its panel. Use an installed copy.";
        respond(
            stream,
            "503 Service Unavailable",
            "text/plain; charset=utf-8",
            &[],
            body,
            head_only,
        );
        return;
    };

    if !asset.mime_type.starts_with("text/html") {
        let cache = [("Cache-Control", "no-cache".to_string())];
        respond(
            stream,
            "200 OK",
            &asset.mime_type,
            &cache,
            &asset.bytes,
            head_only,
        );
        return;
    }

    // Tells the renderer it was served from here, so it connects back over the
    // network instead of looking for a Tauri bridge or falling back to the mock.
    let html = String::from_utf8_lossy(&asset.bytes).replacen(
        "<head>",
        "<head><meta name=\"kehai-remote\" content=\"1\">",
        1,
    );

    // As strict as the desktop window's, plus the socket back to this host.
    // The Host header is the client's own; anything odd in it just leaves the
    // socket to 'self'.
    let socket = request
        .host
        .as_deref()
        .filter(|h| {
            h.chars()
                .all(|c| c.is_ascii_alphanumeric() || ".-:[]".contains(c))
        })
        .map(|h| format!(" ws://{h}"))
        .unwrap_or_default();
    let csp = format!(
        "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'{socket}"
    );
    let headers = [
        ("Content-Security-Policy", csp),
        ("Cache-Control", "no-cache".to_string()),
    ];
    respond(
        stream,
        "200 OK",
        "text/html; charset=utf-8",
        &headers,
        html.as_bytes(),
        head_only,
    );
}

/// What a remote panel may see of an envelope: nothing on a private topic,
/// and notifications only as the host chose for remote panels.
fn outward(envelope: &serde_json::Value) -> Option<serde_json::Value> {
    match envelope.get("topic").and_then(|t| t.as_str())? {
        t if PRIVATE_TOPICS.contains(&t) => None,
        "sys:notify" => Some(notify::for_remote(envelope)),
        _ => Some(envelope.clone()),
    }
}

/// `GET /api/topics`, `GET /api/topics/<topic>` and `POST /api/command/<topic>`,
/// each with the key as a bearer token.
fn api(stream: &mut TcpStream, mut body: Vec<u8>, request: &Request, route: &str, shared: &Shared) {
    if !request
        .bearer
        .as_deref()
        .is_some_and(|k| shared.key_matches(k))
    {
        let challenge = [("WWW-Authenticate", "Bearer".to_string())];
        let refusal = br#"{"error":"the key is missing or wrong"}"#;
        respond(
            stream,
            "401 Unauthorized",
            "application/json",
            &challenge,
            refusal,
            false,
        );
        return;
    }

    match (request.method.as_str(), route.split_once('/')) {
        ("GET", None) if route == "topics" => {
            let all: serde_json::Map<String, serde_json::Value> = bus::snapshot()
                .iter()
                .filter_map(outward)
                .filter_map(|e| Some((e.get("topic")?.as_str()?.to_string(), e)))
                .collect();
            json(stream, "200 OK", &serde_json::Value::Object(all));
        }
        ("GET", Some(("topics", topic))) => {
            match bus::snapshot()
                .iter()
                .filter_map(outward)
                .find(|e| e.get("topic").and_then(|t| t.as_str()) == Some(topic))
            {
                Some(envelope) => json(stream, "200 OK", &envelope),
                None => json(
                    stream,
                    "404 Not Found",
                    &serde_json::json!({ "error": "nothing published on that topic" }),
                ),
            }
        }
        ("POST", Some(("command", topic))) => {
            if request.length > BODY_LIMIT {
                json(
                    stream,
                    "413 Payload Too Large",
                    &serde_json::json!({ "error": "too large" }),
                );
                return;
            }
            let mut chunk = [0u8; 4096];
            while body.len() < request.length {
                match stream.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => body.extend_from_slice(&chunk[..n]),
                }
            }
            body.truncate(request.length);
            let Ok(data) = serde_json::from_slice::<serde_json::Value>(&body) else {
                json(
                    stream,
                    "400 Bad Request",
                    &serde_json::json!({ "error": "the body is not JSON" }),
                );
                return;
            };
            if command(shared, topic, data) {
                json(
                    stream,
                    "202 Accepted",
                    &serde_json::json!({ "accepted": true }),
                );
            } else {
                json(
                    stream,
                    "403 Forbidden",
                    &serde_json::json!({ "error": "control is off, or that is not a button the panel has" }),
                );
            }
        }
        _ => json(
            stream,
            "404 Not Found",
            &serde_json::json!({ "error": "no such route" }),
        ),
    }
}

/// Hands an allowed command to the engine exactly as the local panel's would
/// arrive. False when it was refused.
fn command(shared: &Shared, topic: &str, data: serde_json::Value) -> bool {
    let action = data.get("action").and_then(|a| a.as_str()).unwrap_or("");
    if !shared.control.load(Ordering::Relaxed) || !allowed(topic, action) {
        return false;
    }
    if let Err(err) = shared.app.emit(topic, data) {
        log::warn("remote", format!("could not pass on {topic}: {err}"));
    }
    true
}

fn close(ws: &mut WebSocket<TcpStream>, code: u16, reason: &str) {
    let _ = ws.close(Some(CloseFrame {
        code: CloseCode::from(code),
        reason: reason.into(),
    }));
    let _ = ws.flush();
}

fn websocket(
    mut stream: TcpStream,
    rest: Vec<u8>,
    request: Request,
    shared: &Arc<Shared>,
    stop: &Arc<AtomicBool>,
) {
    let Some(client_key) = request.ws_key else {
        respond(
            &mut stream,
            "400 Bad Request",
            "text/plain",
            &[],
            b"",
            false,
        );
        return;
    };
    let accept = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n",
        derive_accept_key(client_key.as_bytes())
    );
    if stream.write_all(accept.as_bytes()).is_err() {
        return;
    }

    let config = WebSocketConfig::default()
        .max_message_size(Some(BODY_LIMIT))
        .max_frame_size(Some(BODY_LIMIT));
    let mut ws = WebSocket::from_partially_read(stream, rest, Role::Server, Some(config));

    if shared.clients.fetch_add(1, Ordering::Relaxed) >= MAX_CLIENTS {
        shared.clients.fetch_sub(1, Ordering::Relaxed);
        close(&mut ws, CLOSE_FULL, "too many remote panels");
        return;
    }
    let _ = shared.events.send(Msg::Clients);
    session(&mut ws, shared, stop);
    shared.clients.fetch_sub(1, Ordering::Relaxed);
    let _ = shared.events.send(Msg::Clients);
}

/// Waits for the first text message. None on silence, a close, or an error.
fn hello(ws: &mut WebSocket<TcpStream>) -> Option<String> {
    let started = Instant::now();
    while started.elapsed() < HELLO_WITHIN {
        match ws.read() {
            Ok(Message::Text(text)) => return Some(text.as_str().to_string()),
            Ok(Message::Close(_)) => return None,
            Ok(_) => {}
            Err(tungstenite::Error::Io(e))
                if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => return None,
        }
    }
    None
}

fn session(ws: &mut WebSocket<TcpStream>, shared: &Shared, stop: &AtomicBool) {
    let _ = ws.get_mut().set_read_timeout(Some(POLL));

    let offered = hello(ws)
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .filter(|m| m.get("type").and_then(|t| t.as_str()) == Some("hello"))
        .and_then(|m| m.get("key").and_then(|k| k.as_str()).map(str::to_string));
    if !offered.as_deref().is_some_and(|k| shared.key_matches(k)) {
        close(ws, CLOSE_UNPAIRED, "not paired");
        return;
    }
    let generation = shared.generation.load(Ordering::Relaxed);

    let welcome = |control: bool| {
        Message::text(
            serde_json::json!({ "type": "welcome", "control": control, "name": shared.name })
                .to_string(),
        )
    };
    let mut control = shared.control.load(Ordering::Relaxed);
    if ws.send(welcome(control)).is_err() {
        return;
    }

    let (retained, rx) = bus::tap();
    for envelope in retained.iter().filter_map(outward) {
        if ws.send(Message::text(envelope.to_string())).is_err() {
            return;
        }
    }

    let mut heard = Instant::now();
    let mut pinged = Instant::now();

    loop {
        if stop.load(Ordering::Relaxed) {
            close(ws, 1001, "the host stopped serving");
            return;
        }
        if shared.generation.load(Ordering::Relaxed) != generation {
            close(ws, CLOSE_UNPAIRED, "the key changed");
            return;
        }

        let now_control = shared.control.load(Ordering::Relaxed);
        if now_control != control {
            control = now_control;
            if ws.send(welcome(control)).is_err() {
                return;
            }
        }

        loop {
            match rx.try_recv() {
                Ok(envelope) => {
                    if let Some(envelope) = outward(&envelope) {
                        if ws.send(Message::text(envelope.to_string())).is_err() {
                            return;
                        }
                    }
                }
                Err(TryRecvError::Empty) => break,
                // The bus cut this tap off for falling behind. The client
                // reconnects and starts again from the retained values.
                Err(TryRecvError::Disconnected) => {
                    close(ws, 1013, "fell behind");
                    return;
                }
            }
        }

        match ws.read() {
            Ok(Message::Text(text)) => {
                heard = Instant::now();
                let Ok(msg) = serde_json::from_str::<serde_json::Value>(text.as_str()) else {
                    continue;
                };
                if msg.get("type").and_then(|t| t.as_str()) == Some("command") {
                    let topic = msg.get("topic").and_then(|t| t.as_str()).unwrap_or("");
                    let data = msg.get("data").cloned().unwrap_or(serde_json::Value::Null);
                    if !command(shared, topic, data) {
                        log::warn("remote", format!("refused {topic} from a remote panel"));
                    }
                }
            }
            Ok(Message::Close(_)) => return,
            Ok(_) => heard = Instant::now(),
            Err(tungstenite::Error::Io(e))
                if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => return,
        }

        if heard.elapsed() > SILENT_FOR {
            return;
        }
        if pinged.elapsed() > PING_EVERY {
            pinged = Instant::now();
            // A browser answers pings without telling the page, so the page
            // gets a beat it can see too. Without it, a host that went to
            // sleep mid-connection would look live for as long as the
            // browser kept the dead socket open.
            if ws.send(Message::Ping(Bytes::new())).is_err()
                || ws.send(Message::text(r#"{"type":"beat"}"#)).is_err()
            {
                return;
            }
        }
    }
}
