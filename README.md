<h1 align="center">Kehai</h1>

<p align="center">
  <em>気配 — the sense that something is present, without having to look at it directly.</em>
</p>

<p align="center">
  A companion dashboard for a secondary display. System telemetry, agent token usage,
  media and notifications, in a terminal-inspired panel you read out of the corner of
  your eye.
</p>

<p align="center">
  <a href="https://github.com/Purukitto/kehai/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Purukitto/kehai/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/Purukitto/kehai/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/Purukitto/kehai?display_name=tag&sort=semver"></a>
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-blue.svg"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%2010%2B-lightgrey">
</p>

<p align="center">
  <img src="docs/screenshots/stage.png" alt="Kehai's Stage preset in the Amber theme: a large token-usage readout with a five-hour history, and clock, now playing and CPU, memory and unread tiles along the bottom">
</p>

---

Kehai is built for one specific thing: a small always-on display — a 10-inch
1280 × 800 panel on the corner of a desk — showing the handful of numbers you want to
know without switching windows to find them.

It is a [Tauri 2](https://tauri.app) desktop app. A Rust **integration engine** polls
system sources on background threads and pushes normalised events to the renderer; the
React front end is a pure consumer that lays widgets out on a CSS grid. Nothing in the
UI can call an API, and no reading is ever sent anywhere.

## Download

Grab an installer from the [latest release](https://github.com/Purukitto/kehai/releases/latest):

| File | What it is |
| --- | --- |
| `Kehai_x.y.z_x64-setup.exe` | NSIS installer. The usual choice. |
| `Kehai_x.y.z_x64_en-US.msi` | MSI, for policy-managed or scripted installs. |
| `kehai-x.y.z-windows-x64-portable.zip` | A single `kehai.exe`. No install, no uninstaller, no self-update. |

Windows 10 1803 or newer, x64. Kehai uses the system WebView2 runtime, which ships
with Windows 11 and current Windows 10 — on an older machine the installer offers to
fetch it.

The binaries are unsigned, so SmartScreen warns on first launch. Building from source
takes about five minutes if you would rather not trust a stranger's exe.

### Updating

An installed copy updates itself. **Settings → About → Check** asks
GitHub for the latest release, shows what changed, and **Install** closes Kehai,
runs the new installer and opens it again. Turn on **Check automatically** to have
it look once a day; it is off until you do.

Every update is signed, and Kehai refuses one whose signature does not match the key
built into it. The portable build cannot replace itself, so it links to the release
page instead.

## Using it

| Key | Does |
| --- | --- |
| `S` | Open and close settings |
| `Esc` | Back to the dashboard |
| `F11` | Fullscreen |

The window is undecorated and draws its own title bar; drag it by the top strip.
**Settings → Window** turns on autostart and the auto-hiding top bar, and position and
size are restored per display, so the panel reopens where you left it.

Three presets ship — **Stage** (default), **Panel** and **Ambient** — and
**Settings → Arrange** is a direct-manipulation grid editor: drag a tile to move it,
drag its corner to resize, drop it onto another tile to swap the two. Export and Import
write the layout as JSON if you want to commit or share one.

<p align="center">
  <img src="docs/screenshots/stage-phosphor.png" alt="Stage preset in the Phosphor theme, on the Machine tab: CPU load, temperature and per-thread usage" width="32%">
  <img src="docs/screenshots/panel.png" alt="Panel preset in the Amber theme: clock, token quota, sprint timer, now playing, notifications and a vitals strip, evenly weighted" width="32%">
  <img src="docs/screenshots/ambient.png" alt="Ambient preset in the Ice theme: a very large clock with token usage, now playing, CPU and memory below it" width="32%">
  <br>
  <sub>Stage in Phosphor · Panel in Amber · Ambient in Ice. Any preset takes any theme.</sub>
</p>

### Widgets

| Key | Widget | Reads |
| --- | --- | --- |
| `stage` | Hero readout with a tab strip | tokens, CPU, memory, timer |
| `telemetry` | CPU history, memory, network, volumes | all four telemetry topics |
| `vitals` | Compact CPU / memory / network strip | CPU, memory, network |
| `quota` | Agent token usage in the current 5-hour block | `dev:llm_tokens` |
| `media` | Now playing, transport and cover art | `media:now_playing`, `media:art` |
| `notify` | System notification feed, dismissable | `sys:notify` |
| `clock` | Time and date | `os:clock` |
| `sprint` | Focus timer — start, pause, skip, reset | `flow:pomodoro` |

### Sources

| Source | Windows | Linux | macOS |
| --- | --- | --- | --- |
| CPU, memory, network, disk | via `sysinfo` | via `sysinfo` | via `sysinfo` |
| CPU package temperature | usually unavailable — see below | label varies | label varies |
| Media session and transport | via GSMTC, including cover art | via MPRIS; cover art only from local files | not wired |
| Notifications | via `UserNotificationListener` | via a session-bus monitor; only those that arrive while Kehai runs | not wired |
| Agent token usage | optional — needs local agent transcripts | same | same |
| Focus timer | kept by the engine | same | same |

Where a source is unavailable the widget says so, and Settings → Sources shows it as
**UNAVAILABLE** with the reason. Nothing shows a zero it does not have — see
[Design notes](docs/design.md). The Stage preset drops a tab whose source has
nothing to report rather than leaving it blank.

<details>
<summary><strong>Why CPU temperature is usually missing on Windows</strong></summary>

CPU die temperature lives in model-specific registers — the digital thermal sensor
on Intel, Tctl on AMD — and reading one takes the `rdmsr` instruction, which only
kernel mode can execute. The two routes Windows offers ordinary processes are an
ACPI thermal zone, which needs elevation and on many desktops reports a chassis
zone or nothing at all, and `Win32_TemperatureProbe`, which almost no hardware
populates.

Tools like HWMonitor and HWiNFO get around this by installing a kernel driver.
Kehai deliberately does not: a driver needs administrator rights to install, and
generic MSR-access drivers have a history of letting unprivileged code read and
write hardware registers. That is a poor trade for one number on a dashboard.

</details>

### Remote panel

The display does not have to hang off the machine being watched. Turn on
**Settings → Remote** and Kehai serves the panel to a browser on another machine on
the same network — an old laptop, a tablet, a Raspberry Pi driving the 10-inch
screen.

Settings shows a link for each of this machine's network addresses. Open one on the
other device and it pairs by itself: the link carries a key, which the remote panel
keeps and takes out of the address bar. A device where opening a link is awkward can
paste the link or the key into the prompt instead. **New key** cuts off every remote
panel at once.

A remote panel has its own layout and theme, kept in its own browser. It only reads
unless **Allow control** is on, and even then it can only press the buttons the panel
has — play and skip, dismiss a notification, start or pause the focus timer. It can
never change a setting, name a file or start an update. The header says `REMOTE`,
`REMOTE · VIEW ONLY`, or why it is not connected.

The same port answers to scripts, with the key as a bearer token:

```bash
curl -H "Authorization: Bearer $KEY" http://192.168.1.20:5280/api/topics
```

| Route | Does |
| --- | --- |
| `GET /api/topics` | Every topic's last envelope, by topic |
| `GET /api/topics/<topic>` | One topic's last envelope, e.g. `/api/topics/telemetry:cpu` |
| `POST /api/command/<topic>` | A command a remote panel could send, as JSON — `{"action":"start"}` to `flow:command` — when control is on |
| `ws://…/bus` | The live bus. Send `{"type":"hello","key":"…"}` first |

It is plain HTTP, so the key and everything the panel shows, notifications included,
cross your network unencrypted. Use it on a network you trust.

## Privacy

Kehai reads local sources and publishes them to its own in-process bus. Nothing it
reads is uploaded, logged to disk or phoned home. The one thing it writes is how long
the focus timer has run today, to `flow.json` in its own app-data folder, so the total
survives a restart — and, once you turn on the remote panel, the key for it, beside it
in `remote.json`.

The font is built in, so Kehai makes one kind of network request, and the renderer's
content-security policy forbids anything else: **the update check**, and only when you
press Check or turn on Check automatically. It fetches `latest.json` from this
repository's latest GitHub release, which tells GitHub your IP address and that some
copy of Kehai asked — nothing more. Installing downloads the installer from the same
release.

It listens for nothing unless you turn on **Settings → Remote**. Then it accepts
connections on one port from your network, and shows the panel's data only to a
device holding the key.

Two sources are worth stating plainly:

- **Notifications.** On Windows the app registers as a notification listener, which
  means it can read the title and body of toasts from any app. Windows prompts for this
  the first time. Deny it and the widget reports the refusal rather than showing an
  empty feed. On Linux nothing prompts: Kehai asks the session bus to copy it every
  notification on its way to the notification server, the id the server gives it and
  word of it closing, and nothing else — the same access `dbus-monitor` uses, which
  any program running as you already has.
- **Agent token usage.** The quota widget tallies token counts by tailing local coding
  agent session transcripts — under `~/.claude/projects` unless you point
  Settings → Sources at another folder — reading file modification times, and the usage
  counters and reply ids on assistant turns so each reply counts once. No prompt or
  response text is read, retained or displayed. There is no API call and no account
  involved; if the folder does not exist or holds no transcripts, the source reports
  itself unavailable and the rest of the panel is unaffected.

  Usage is counted per 5-hour block: one opens with the first request after the last
  one closed, on the hour before it, and the widget shows when it resets. The provider
  does not publish how its window works, so that time is an estimate worked out from
  the transcripts, the same way other local usage tools do it.

## Building from source

Requires [Bun](https://bun.sh), a [Rust](https://rustup.rs) toolchain (1.85 or newer)
and, on Windows, the MSVC build tools that `rustup` sets up. See
[Tauri's prerequisites](https://tauri.app/start/prerequisites/) for the full list.

```bash
bun install
```

```bash
bun run dev
```

That serves the renderer on <http://localhost:5273> with a mock source driving every
widget — the header reads `MOCK`. All widget and layout work can be done there, in a
browser, with no Rust in the loop.

For the desktop app:

```bash
bun run tauri:build
```

The result is `src-tauri/target/release/kehai.exe` with the frontend embedded, plus
installers under `src-tauri/target/release/bundle/`. Under Tauri the Rust engine takes
over the topics it can source and the header reads `ENGINE` with a green dot, so which
source is live is visible rather than assumed.

<details>
<summary><strong>Debug builds behave differently on purpose</strong></summary>

`main.rs` gates `windows_subsystem = "windows"` on `not(debug_assertions)`, so a
**debug build is console-subsystem**: it keeps a terminal, prints every poller's
diagnostics to it, and exits when that terminal is closed. That is the point of it.
Release is GUI-subsystem and silent.

A bare `cargo build` additionally loads the frontend from the Vite dev server instead
of the embedded bundle — convenient while iterating, useless once that server stops.
Anything about how Kehai behaves as an installed, autostarted app has to be tested
against a release build.

</details>

### Scripts

| Command | Does |
| --- | --- |
| `bun run dev` | Vite on :5273 (`strictPort`, so it fails rather than moving) |
| `bun run build` | Typecheck and build the renderer into `dist/` |
| `bun run typecheck` | Typecheck only |
| `bun run tauri:dev` | Desktop shell against the dev server |
| `bun run tauri:build` | Release build and installers |
| `bun run release <patch\|minor\|major\|x.y.z>` | Bump the version, roll the changelog, commit and tag — see [Releasing](CONTRIBUTING.md#releasing) |

## Architecture

```mermaid
flowchart LR
    subgraph engine["Integration engine — Rust"]
        direction TB
        P["cpu · mem · net · disk · flow<br/>quota · media · notify · update<br/><i>one thread each</i>"]
    end

    BUS[["Envelope bus<br/><i>last value retained per topic</i>"]]

    subgraph renderer["Renderer — React"]
        direction TB
        W["Grid → widgets<br/><i>useTopic subscriptions</i>"]
    end

    P --> BUS
    BUS -- "Tauri event, replayed on attach" --> W
    W -. "media · notify · flow · quota · update · remote :command" .-> P
    BUS -- "WebSocket, key required" --> RP["Remote panel<br/><i>same renderer, another machine</i>"]
```

Everything on the bus is one shape:

```json
{ "topic": "telemetry:cpu", "ts": 1755781234567, "src": "poller.cpu", "data": {} }
```

Widgets subscribe to the topics they need and nothing else — no props thread through
the tree. **Both** buses retain the last value per topic: the renderer's so a
late-mounted widget renders immediately instead of booting blank, and the engine's
because Tauri events are fire-and-forget, so a publish-on-change source would otherwise
stay silent forever after one missed send. The renderer emits `ui:hello` once
subscribed and the engine replays every retained topic in reply.

Each poller owns one thread, so a stalled source can only stall itself. The renderer is
read-only except for six command topics — `media:command`, `notify:command`,
`flow:command`, `quota:command`, `update:command` and `remote:command`: the UI states
an intent, the engine owns the side effect and runs it off the event thread, so a
wedged media player cannot freeze the panel and a slow download cannot either.

A remote panel is the same renderer, served by the engine and fed by a WebSocket
instead of the Tauri bridge. It can forward the first three of those commands, and
only while the host allows control; the engine checks every one again.

### Where things are

| Path | What |
| --- | --- |
| `src/core/bus.ts` | Pub/sub with last-value retention and wildcard topics |
| `src/core/mockSource.ts` | Stand-in for the engine — publishes the real topics |
| `src/core/tauriSource.ts` | Bridges engine events onto the bus, both directions |
| `src/core/remoteSource.ts` | The same, for a remote panel, over a WebSocket |
| `src/core/payloads.ts` | Every payload shape, mirrored by hand from Rust |
| `src/core/layout.ts` | Validates a stored or imported layout |
| `src/core/settings.tsx` | The settings store and everything that persists |
| `src/grid/Grid.tsx` | Renders a layout onto a CSS grid |
| `src/grid/Arranger.tsx` | The tile arranger |
| `src/widgets/` | One module per widget, each declaring its topics and minimum size |
| `src/widgets/registry.ts` | The only way a widget is reached |
| `src/layouts/*.layout.json` | The three shipped presets |
| `src/styles/tokens.css` | Thirteen custom properties per theme |
| `src-tauri/src/bus.rs` | Mints envelopes, retains them, emits them |
| `src-tauri/src/pollers/` | One thread per source |
| `src-tauri/src/pollers/update.rs` | Checks GitHub Releases and hands over to the installer |
| `src-tauri/src/remote.rs` | Serves the panel, the bus and the API to other machines |
| `scripts/release.ts` | Cuts a release: version, changelog, commit, tag |

[Design notes](docs/design.md) covers the reasoning behind the presets, the theme
system and the "UI only consumes" rule. [CONTRIBUTING.md](CONTRIBUTING.md) covers
adding a widget or a poller.

## Not built yet

- HTTPS for the remote panel, so it can be used on a network you do not trust
- Media and notifications on macOS, which keeps both behind private frameworks
- Code signing, so installers stop tripping SmartScreen

## Licence

[MIT](LICENSE) © Pulkit Sambhavi Singh

The bundled [JetBrains Mono](https://www.jetbrains.com/lp/mono/) typeface is © JetBrains
and distributed under the [SIL Open Font License 1.1](https://openfontlicense.org).
