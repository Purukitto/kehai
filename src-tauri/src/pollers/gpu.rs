use std::collections::{BTreeMap, VecDeque};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Listener};

use crate::bus;
use crate::log;

const TOPIC: &str = "telemetry:gpu";
const SRC: &str = "poller.gpu";
const INTERVAL: Duration = Duration::from_millis(1000);
/// How often the list of cards is read again, for one that is docked or woken.
const RESCAN: Duration = Duration::from_secs(60);
/// The chart's minute, at one reading a second.
const HISTORY: usize = 60;
/// Below this much memory of its own a card shares the system's, as integrated
/// graphics do, and its memory in use counts both.
const INTEGRATED_BELOW: u64 = 512 * 1024 * 1024;
const GIB: f64 = 1024.0 * 1024.0 * 1024.0;

/// One graphics card, as the choice in the options names it.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    /// Vendor, device and subsystem: the same after a restart, unlike the
    /// adapter's LUID, so a choice can be kept.
    pub id: String,
    pub name: String,
}

/// Mirrors `GpuPayload` in `src/core/payloads.ts`.
#[derive(Serialize, Clone, PartialEq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct GpuPayload {
    /// False where no card reports, or on a platform Kehai can't read yet.
    pub available: bool,
    pub name: String,
    /// The id of the card shown.
    pub card: String,
    /// The busiest engine's load, as Task Manager shows it.
    pub pct: u32,
    /// What that engine does: 3d, compute, video, copy.
    pub engine: String,
    pub mem_used_gib: f32,
    pub mem_total_gib: f32,
    /// `None` where the driver gives no sensor. Never a made-up zero.
    pub temp_c: Option<f32>,
    /// The driver's own warning point.
    pub warn_c: Option<f32>,
    pub fan_rpm: Option<u32>,
    /// Of the card's power limit.
    pub power_pct: Option<f32>,
    /// Load once a second, the last minute, oldest first.
    pub history: Vec<u32>,
    /// Every card that isn't a software renderer, for the choice.
    pub cards: Vec<Card>,
}

/// Renderer → engine on `gpu:command`. Mirrors `GpuCommand` in
/// `src/core/payloads.ts`. The choice is a setting, and settings live in the
/// renderer.
#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum Command {
    /// Show this card. None for the one Kehai picks.
    Pick { card: Option<String> },
}

/// A card as the system lists it.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Clone, Debug)]
struct Adapter {
    luid: (u32, u32),
    id: String,
    name: String,
    dedicated: u64,
    shared: u64,
}

/// The card to show: the one asked for if it is there, else the one with the
/// most memory of its own. A software renderer never gets this far.
fn pick<'a>(adapters: &'a [Adapter], wanted: Option<&str>) -> Option<&'a Adapter> {
    wanted
        .and_then(|id| adapters.iter().find(|a| a.id == id))
        .or_else(|| adapters.iter().max_by_key(|a| a.dedicated))
}

/// The adapter's LUID in a counter instance name, as `(high, low)`:
/// `pid_1234_luid_0x00000000_0x0001545A_phys_0_eng_3_engtype_3D`.
fn luid_of(instance: &str) -> Option<(u32, u32)> {
    let lower = instance.to_ascii_lowercase();
    let rest = &lower[lower.find("luid_0x")? + 7..];
    let (high, rest) = rest.split_once("_0x")?;
    let low: String = rest.chars().take_while(|c| c.is_ascii_hexdigit()).collect();
    Some((
        u32::from_str_radix(high, 16).ok()?,
        u32::from_str_radix(&low, 16).ok()?,
    ))
}

/// The physical adapter and engine an instance counts, and what that engine
/// does, in the words the panel uses.
fn engine_of(instance: &str) -> Option<((u32, u32), String)> {
    let lower = instance.to_ascii_lowercase();
    let phys: u32 = lower
        .split_once("_phys_")?
        .1
        .split('_')
        .next()?
        .parse()
        .ok()?;
    let eng: u32 = lower
        .split_once("_eng_")?
        .1
        .split('_')
        .next()?
        .parse()
        .ok()?;
    let kind = lower.split_once("_engtype_")?.1;
    let kind = if kind.starts_with("video") {
        "video"
    } else if kind.starts_with("compute") {
        "compute"
    } else if kind.starts_with("copy") {
        "copy"
    } else if kind.is_empty() {
        "other"
    } else {
        kind
    };
    Some(((phys, eng), kind.to_string()))
}

/// The busiest engine of one card: each engine's load is the sum over every
/// process using it, and the card's is the most any engine has, as Task
/// Manager counts it.
fn busiest(samples: &[(String, f64)], luid: (u32, u32)) -> (u32, String) {
    let mut engines: BTreeMap<(u32, u32), (f64, String)> = BTreeMap::new();
    for (instance, value) in samples {
        if luid_of(instance) != Some(luid) || !value.is_finite() {
            continue;
        }
        if let Some((key, kind)) = engine_of(instance) {
            engines.entry(key).or_insert((0.0, kind)).0 += value.max(0.0);
        }
    }
    engines
        .into_values()
        .max_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(load, kind)| (load.min(100.0).round() as u32, kind))
        .unwrap_or((0, String::new()))
}

/// The memory a counter reports for one card, summed over its physical parts.
fn memory_of(samples: &[(String, f64)], luid: (u32, u32)) -> f64 {
    samples
        .iter()
        .filter(|(instance, _)| luid_of(instance) == Some(luid))
        .map(|(_, v)| v.max(0.0))
        .sum()
}

/// What the driver says, in the panel's units. A sensor that reads zero is
/// one the driver doesn't have: no card runs at 0 °C.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Default, Clone, Copy, Debug, PartialEq)]
struct Sensors {
    temp_c: Option<f32>,
    warn_c: Option<f32>,
    fan_rpm: Option<u32>,
    power_pct: Option<f32>,
}

#[cfg_attr(not(windows), allow(dead_code))]
fn sensors(temperature: u32, warning: u32, fan: u32, max_fan: u32, power: u32) -> Sensors {
    let tenths = |v: u32| (v > 0).then(|| v as f32 / 10.0);
    Sensors {
        temp_c: tenths(temperature),
        warn_c: tenths(warning),
        // A fan that stops when the card is cool reads zero, so a zero only
        // means no fan sensor where the driver gives no top speed either.
        fan_rpm: (fan > 0 || max_fan > 0).then_some(fan),
        power_pct: tenths(power),
    }
}

/// One look at the card shown.
#[cfg_attr(not(windows), allow(dead_code))]
struct Reading {
    pct: u32,
    engine: String,
    mem_used: f64,
    sensors: Sensors,
}

fn payload(
    adapter: &Adapter,
    reading: &Reading,
    history: &VecDeque<u32>,
    cards: &[Card],
) -> GpuPayload {
    let integrated = adapter.dedicated < INTEGRATED_BELOW;
    let total = if integrated {
        adapter.dedicated + adapter.shared
    } else {
        adapter.dedicated
    };
    GpuPayload {
        available: true,
        name: adapter.name.clone(),
        card: adapter.id.clone(),
        pct: reading.pct,
        engine: reading.engine.clone(),
        mem_used_gib: (reading.mem_used / GIB) as f32,
        mem_total_gib: (total as f64 / GIB) as f32,
        temp_c: reading.sensors.temp_c,
        warn_c: reading.sensors.warn_c,
        fan_rpm: reading.sensors.fan_rpm,
        power_pct: reading.sensors.power_pct,
        history: history.iter().copied().collect(),
        cards: cards.to_vec(),
    }
}

fn unavailable() -> GpuPayload {
    GpuPayload::default()
}

pub fn spawn(app: AppHandle) {
    let (command_tx, command_rx) = mpsc::channel::<Command>();
    app.listen("gpu:command", move |event| {
        match serde_json::from_str::<Command>(event.payload()) {
            Ok(command) => {
                let _ = command_tx.send(command);
            }
            Err(err) => log::warn(SRC, format!("ignored a command: {err}")),
        }
    });

    thread::spawn(move || {
        let mut wanted: Option<String> = None;
        let Some(mut source) = platform::Source::open() else {
            log::info(SRC, "no graphics counters on this platform");
            bus::publish(&app, TOPIC, SRC, unavailable());
            return;
        };

        let mut adapters = source.adapters();
        let mut scanned = Instant::now();
        let mut shown: Option<String> = None;
        let mut history: VecDeque<u32> = VecDeque::with_capacity(HISTORY);
        let mut announced = false;

        loop {
            match command_rx.recv_timeout(INTERVAL) {
                Ok(Command::Pick { card }) => wanted = card,
                Err(RecvTimeoutError::Timeout) => {}
                // Only if the listener is gone. Without the sleep this would spin.
                Err(RecvTimeoutError::Disconnected) => thread::sleep(INTERVAL),
            }
            if scanned.elapsed() >= RESCAN {
                adapters = source.adapters();
                scanned = Instant::now();
            }

            let Some(adapter) = pick(&adapters, wanted.as_deref()).cloned() else {
                if !announced {
                    announced = true;
                    log::info(SRC, "no graphics card reports");
                }
                bus::publish(&app, TOPIC, SRC, unavailable());
                continue;
            };
            if shown.as_deref() != Some(adapter.id.as_str()) {
                // Another card's minute would read as this one's.
                history.clear();
                shown = Some(adapter.id.clone());
            }

            let reading = source.read(&adapter);
            history.push_back(reading.pct);
            while history.len() > HISTORY {
                history.pop_front();
            }

            if !announced {
                announced = true;
                log::info(
                    SRC,
                    format!(
                        "{} of {} cards, {:.1} GiB, temperature {}",
                        adapter.name,
                        adapters.len(),
                        adapter.dedicated as f64 / GIB,
                        match reading.sensors.temp_c {
                            Some(t) => format!("{t:.1}C"),
                            None => "not reported by its driver".to_string(),
                        }
                    ),
                );
            }

            let cards: Vec<Card> = adapters
                .iter()
                .map(|a| Card {
                    id: a.id.clone(),
                    name: a.name.clone(),
                })
                .collect();
            bus::publish(
                &app,
                TOPIC,
                SRC,
                payload(&adapter, &reading, &history, &cards),
            );
        }
    });
}

/// Load and memory from the counters Task Manager reads, the cards from DXGI,
/// and temperature, fan and power from what the driver reports to the kernel's
/// graphics interface. Nothing is loaded into another process, and nothing
/// needs a vendor's software or administrator rights.
#[cfg(windows)]
#[allow(unsafe_code)]
mod platform {
    use std::collections::HashMap;
    use std::ffi::c_void;

    use windows::core::w;
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
    };
    use windows::Win32::System::Performance::{
        PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
        PdhOpenQueryW, PDH_CSTATUS_NEW_DATA, PDH_CSTATUS_VALID_DATA, PDH_FMT_COUNTERVALUE_ITEM_W,
        PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY, PDH_MORE_DATA,
    };

    use super::{busiest, memory_of, sensors, Adapter, Reading, Sensors, INTEGRATED_BELOW};
    use crate::log;

    const SRC: &str = "poller.gpu";

    // The kernel's graphics interface, from gdi32. Declared by hand: three
    // functions and their structures, laid out as d3dkmthk.h has them.
    #[repr(C)]
    struct OpenFromLuid {
        luid_low: u32,
        luid_high: i32,
        adapter: u32,
    }
    #[repr(C)]
    struct QueryInfo {
        adapter: u32,
        kind: i32,
        data: *mut c_void,
        size: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct PerfData {
        physical_adapter_index: u32,
        memory_frequency: u64,
        max_memory_frequency: u64,
        max_memory_frequency_oc: u64,
        memory_bandwidth: u64,
        pcie_bandwidth: u64,
        fan_rpm: u32,
        power: u32,
        temperature: u32,
        power_state_override: u8,
    }
    #[repr(C)]
    #[derive(Default)]
    struct PerfDataCaps {
        physical_adapter_index: u32,
        max_memory_bandwidth: u64,
        max_pcie_bandwidth: u64,
        max_fan_rpm: u32,
        temperature_max: u32,
        temperature_warning: u32,
    }
    #[repr(C)]
    struct Close {
        adapter: u32,
    }
    const KMTQAITYPE_ADAPTERPERFDATA: i32 = 62;
    const KMTQAITYPE_ADAPTERPERFDATA_CAPS: i32 = 63;

    #[link(name = "gdi32")]
    extern "system" {
        fn D3DKMTOpenAdapterFromLuid(open: *mut OpenFromLuid) -> i32;
        fn D3DKMTQueryAdapterInfo(query: *const QueryInfo) -> i32;
        fn D3DKMTCloseAdapter(close: *const Close) -> i32;
    }

    fn query<T>(adapter: u32, kind: i32, data: &mut T) -> bool {
        let info = QueryInfo {
            adapter,
            kind,
            data: data as *mut T as *mut c_void,
            size: std::mem::size_of::<T>() as u32,
        };
        // SAFETY: `data` is a live, correctly sized structure of the kind asked for.
        unsafe { D3DKMTQueryAdapterInfo(&info) == 0 }
    }

    /// An open kernel handle to one card, for its sensors.
    struct Kernel {
        luid: (u32, u32),
        adapter: u32,
        caps: Option<PerfDataCaps>,
    }

    impl Kernel {
        fn open(luid: (u32, u32)) -> Option<Self> {
            let mut open = OpenFromLuid {
                luid_low: luid.1,
                luid_high: luid.0 as i32,
                adapter: 0,
            };
            // SAFETY: a plain in/out structure.
            if unsafe { D3DKMTOpenAdapterFromLuid(&mut open) } != 0 {
                return None;
            }
            let mut caps = PerfDataCaps::default();
            let caps =
                query(open.adapter, KMTQAITYPE_ADAPTERPERFDATA_CAPS, &mut caps).then_some(caps);
            Some(Self {
                luid,
                adapter: open.adapter,
                caps,
            })
        }

        fn sensors(&self) -> Sensors {
            let mut perf = PerfData::default();
            if !query(self.adapter, KMTQAITYPE_ADAPTERPERFDATA, &mut perf) {
                return Sensors::default();
            }
            let (warning, max_fan) = self
                .caps
                .as_ref()
                .map_or((0, 0), |c| (c.temperature_warning, c.max_fan_rpm));
            sensors(perf.temperature, warning, perf.fan_rpm, max_fan, perf.power)
        }
    }

    impl Drop for Kernel {
        fn drop(&mut self) {
            // SAFETY: the handle came from D3DKMTOpenAdapterFromLuid and is closed once.
            unsafe {
                D3DKMTCloseAdapter(&Close {
                    adapter: self.adapter,
                });
            }
        }
    }

    pub struct Source {
        query: PDH_HQUERY,
        engines: PDH_HCOUNTER,
        dedicated: PDH_HCOUNTER,
        shared: PDH_HCOUNTER,
        kernel: Option<Kernel>,
        /// Kept so a failing counter is logged once, not every second.
        failed: HashMap<&'static str, u32>,
    }

    impl Source {
        pub fn open() -> Option<Self> {
            let mut query = PDH_HQUERY::default();
            // SAFETY: out-pointers to locals; the query is closed in Drop.
            unsafe {
                if PdhOpenQueryW(None, 0, &mut query) != 0 {
                    log::warn(SRC, "could not open a performance query");
                    return None;
                }
                let mut engines = PDH_HCOUNTER::default();
                let mut dedicated = PDH_HCOUNTER::default();
                let mut shared = PDH_HCOUNTER::default();
                let added = [
                    PdhAddEnglishCounterW(
                        query,
                        w!("\\GPU Engine(*)\\Utilization Percentage"),
                        0,
                        &mut engines,
                    ),
                    PdhAddEnglishCounterW(
                        query,
                        w!("\\GPU Adapter Memory(*)\\Dedicated Usage"),
                        0,
                        &mut dedicated,
                    ),
                    PdhAddEnglishCounterW(
                        query,
                        w!("\\GPU Adapter Memory(*)\\Shared Usage"),
                        0,
                        &mut shared,
                    ),
                ];
                if added.iter().any(|&status| status != 0) {
                    log::warn(SRC, format!("graphics counters missing: {added:x?}"));
                    PdhCloseQuery(query);
                    return None;
                }
                // Load is measured between two collections; this is the first.
                PdhCollectQueryData(query);
                Some(Self {
                    query,
                    engines,
                    dedicated,
                    shared,
                    kernel: None,
                    failed: HashMap::new(),
                })
            }
        }

        /// Every card but a software renderer.
        pub fn adapters(&mut self) -> Vec<Adapter> {
            // SAFETY: COM calls on interfaces DXGI hands back.
            let listed = unsafe {
                let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else {
                    return Vec::new();
                };
                let mut out = Vec::new();
                let mut i = 0;
                while let Ok(adapter) = factory.EnumAdapters1(i) {
                    i += 1;
                    let Ok(desc) = adapter.GetDesc1() else {
                        continue;
                    };
                    if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
                        continue;
                    }
                    let end = desc
                        .Description
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(desc.Description.len());
                    out.push(Adapter {
                        luid: (desc.AdapterLuid.HighPart as u32, desc.AdapterLuid.LowPart),
                        id: format!(
                            "{:04x}:{:04x}:{:08x}",
                            desc.VendorId, desc.DeviceId, desc.SubSysId
                        ),
                        name: String::from_utf16_lossy(&desc.Description[..end])
                            .trim()
                            .to_string(),
                        dedicated: desc.DedicatedVideoMemory as u64,
                        shared: desc.SharedSystemMemory as u64,
                    });
                }
                out
            };
            // The basic display driver lists itself as hardware with no memory.
            let mut cards: Vec<Adapter> = listed
                .into_iter()
                .filter(|a| a.dedicated > 0 || a.shared > 0)
                .filter(|a| !a.id.starts_with("1414:"))
                .collect();
            // Two of the same card would share an id; the second keeps its own.
            for i in 1..cards.len() {
                if cards[..i].iter().any(|c| c.id == cards[i].id) {
                    cards[i].id = format!("{}#{i}", cards[i].id);
                }
            }
            cards
        }

        fn array(&mut self, which: &'static str) -> Vec<(String, f64)> {
            let counter = match which {
                "engines" => self.engines,
                "dedicated" => self.dedicated,
                _ => self.shared,
            };
            let mut size = 0u32;
            let mut count = 0u32;
            // SAFETY: the first call sizes the buffer, the second fills it; the
            // names point into that buffer and are copied out before it goes.
            unsafe {
                let status = PdhGetFormattedCounterArrayW(
                    counter,
                    PDH_FMT_DOUBLE,
                    &mut size,
                    &mut count,
                    None,
                );
                if status != PDH_MORE_DATA {
                    self.fail(which, status);
                    return Vec::new();
                }
                let item = std::mem::size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>();
                let mut buffer: Vec<PDH_FMT_COUNTERVALUE_ITEM_W> =
                    Vec::with_capacity((size as usize).div_ceil(item));
                let status = PdhGetFormattedCounterArrayW(
                    counter,
                    PDH_FMT_DOUBLE,
                    &mut size,
                    &mut count,
                    Some(buffer.as_mut_ptr()),
                );
                if status != 0 {
                    self.fail(which, status);
                    return Vec::new();
                }
                buffer.set_len(count as usize);
                buffer
                    .iter()
                    .filter(|i| {
                        i.FmtValue.CStatus == PDH_CSTATUS_VALID_DATA
                            || i.FmtValue.CStatus == PDH_CSTATUS_NEW_DATA
                    })
                    .filter_map(|i| {
                        Some((i.szName.to_string().ok()?, i.FmtValue.Anonymous.doubleValue))
                    })
                    .collect()
            }
        }

        fn fail(&mut self, which: &'static str, status: u32) {
            let n = self.failed.entry(which).or_insert(0);
            if *n == 0 {
                log::warn(SRC, format!("reading {which} failed: {status:#x}"));
            }
            *n += 1;
        }

        pub fn read(&mut self, adapter: &Adapter) -> Reading {
            // SAFETY: the query is open for as long as self.
            unsafe {
                PdhCollectQueryData(self.query);
            }
            let engines = self.array("engines");
            let (pct, engine) = busiest(&engines, adapter.luid);
            let mut mem_used = memory_of(&self.array("dedicated"), adapter.luid);
            if adapter.dedicated < INTEGRATED_BELOW {
                mem_used += memory_of(&self.array("shared"), adapter.luid);
            }

            if self.kernel.as_ref().map(|k| k.luid) != Some(adapter.luid) {
                self.kernel = Kernel::open(adapter.luid);
            }
            let sensors = self
                .kernel
                .as_ref()
                .map(Kernel::sensors)
                .unwrap_or_default();
            Reading {
                pct,
                engine,
                mem_used,
                sensors,
            }
        }
    }

    impl Drop for Source {
        fn drop(&mut self) {
            // SAFETY: opened in `open`, closed once.
            unsafe {
                PdhCloseQuery(self.query);
            }
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{Adapter, Reading};

    /// No reader yet: the source says so and the panel leaves it out.
    pub struct Source;

    impl Source {
        pub fn open() -> Option<Self> {
            None
        }
        pub fn adapters(&mut self) -> Vec<Adapter> {
            Vec::new()
        }
        pub fn read(&mut self, _: &Adapter) -> Reading {
            unreachable!("never opened")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(id: &str, dedicated: u64) -> Adapter {
        Adapter {
            luid: (0, 1),
            id: id.into(),
            name: id.into(),
            dedicated,
            shared: 0,
        }
    }

    #[test]
    fn picks_the_card_asked_for_else_the_most_memory() {
        let cards = [card("intel", 128 << 20), card("nvidia", 12 << 30)];
        assert_eq!(pick(&cards, None).map(|a| a.id.as_str()), Some("nvidia"));
        assert_eq!(
            pick(&cards, Some("intel")).map(|a| a.id.as_str()),
            Some("intel")
        );
        // A card that has gone falls back to the automatic choice.
        assert_eq!(
            pick(&cards, Some("gone")).map(|a| a.id.as_str()),
            Some("nvidia")
        );
        assert!(pick(&[], None).is_none());
    }

    #[test]
    fn reads_luid_and_engine_from_instance_names() {
        let name = "pid_1234_luid_0x00000000_0x0001545A_phys_0_eng_3_engtype_3D";
        assert_eq!(luid_of(name), Some((0, 0x1545a)));
        assert_eq!(engine_of(name), Some(((0, 3), "3d".to_string())));
        assert_eq!(
            luid_of("luid_0x00000000_0x00016A5D_phys_0"),
            Some((0, 0x16a5d))
        );
        assert_eq!(
            engine_of("pid_9_luid_0x0_0x1_phys_0_eng_7_engtype_VideoDecode").map(|e| e.1),
            Some("video".to_string())
        );
        assert_eq!(
            engine_of("pid_9_luid_0x0_0x1_phys_0_eng_7_engtype_").map(|e| e.1),
            Some("other".to_string())
        );
        assert_eq!(luid_of("_Total"), None);
    }

    #[test]
    fn busiest_engine_sums_processes_and_takes_the_max() {
        let s = |n: &str, v: f64| (n.to_string(), v);
        let samples = [
            s("pid_1_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 30.0),
            s("pid_2_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 25.0),
            s("pid_2_luid_0x0_0x1_phys_0_eng_5_engtype_Copy", 40.0),
            // Another card's engine doesn't count.
            s("pid_3_luid_0x0_0x2_phys_0_eng_0_engtype_3D", 99.0),
        ];
        assert_eq!(busiest(&samples, (0, 1)), (55, "3d".to_string()));
        // Rounding error past 100 is held at 100.
        let over = [
            s("pid_1_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 70.0),
            s("pid_2_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 31.5),
        ];
        assert_eq!(busiest(&over, (0, 1)).0, 100);
        assert_eq!(busiest(&[], (0, 1)), (0, String::new()));
    }

    #[test]
    fn zero_sensors_are_missing_but_a_stopped_fan_is_not() {
        let s = sensors(578, 840, 1564, 3200, 427);
        assert_eq!(s.temp_c, Some(57.8));
        assert_eq!(s.warn_c, Some(84.0));
        assert_eq!(s.fan_rpm, Some(1564));
        assert_eq!(s.power_pct, Some(42.7));
        // Integrated graphics: nothing at all.
        assert_eq!(sensors(0, 0, 0, 0, 0), Sensors::default());
        // A fan stopped while the card is cool.
        assert_eq!(sensors(400, 840, 0, 3200, 50).fan_rpm, Some(0));
    }

    #[test]
    fn integrated_cards_count_shared_memory() {
        let igpu = Adapter {
            luid: (0, 1),
            id: "i".into(),
            name: "i".into(),
            dedicated: 128 << 20,
            shared: 16 << 30,
        };
        let reading = Reading {
            pct: 5,
            engine: "3d".into(),
            mem_used: 1.0 * GIB,
            sensors: Sensors::default(),
        };
        let p = payload(&igpu, &reading, &VecDeque::new(), &[]);
        assert!(p.mem_total_gib > 16.0);
        let dgpu = Adapter {
            dedicated: 12 << 30,
            ..igpu
        };
        assert_eq!(
            payload(&dgpu, &reading, &VecDeque::new(), &[]).mem_total_gib,
            12.0
        );
    }
    /// Reads the cards on the machine running the tests: `cargo test reads_this_pc -- --ignored --nocapture`.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn reads_this_pc() {
        let Some(mut source) = platform::Source::open() else {
            panic!("no counters");
        };
        let adapters = source.adapters();
        for a in &adapters {
            println!(
                "{} {} {:?} {:.1} GiB own, {:.1} GiB shared",
                a.id,
                a.name,
                a.luid,
                a.dedicated as f64 / GIB,
                a.shared as f64 / GIB
            );
        }
        let Some(card) = pick(&adapters, None) else {
            panic!("no card");
        };
        for _ in 0..3 {
            thread::sleep(INTERVAL);
            let r = source.read(card);
            println!(
                "{}: {}% {} {:.2} GiB {:?}",
                card.name,
                r.pct,
                r.engine,
                r.mem_used / GIB,
                r.sensors
            );
        }
    }
}
