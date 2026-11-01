<h1 align="center">Kehai</h1>

<p align="center">
  <em>気配 — the sense that something is present, without having to look at it directly.</em>
</p>

<p align="center">
  A companion dashboard for a secondary display. System telemetry, coding agents and
  their token usage, media and notifications, in a terminal-inspired panel you read out
  of the corner of your eye.
</p>

<p align="center">
  <a href="https://github.com/Purukitto/kehai/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Purukitto/kehai/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/Purukitto/kehai/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/Purukitto/kehai?display_name=tag&sort=semver"></a>
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-blue.svg"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%2010%2B-lightgrey">
</p>

<p align="center">
  <a href="#download"><strong>Download</strong></a> ·
  <a href="docs/README.md"><strong>Documentation</strong></a> ·
  <a href="CHANGELOG.md"><strong>Changelog</strong></a> ·
  <a href="docs/privacy.md"><strong>Privacy</strong></a>
</p>

<p align="center">
  <img src="docs/screenshots/stage.png" alt="Kehai's Stage preset in the Amber theme: a large token-usage readout with a five-hour history, and clock, now playing and CPU, memory and unread tiles along the bottom">
</p>

---

Kehai is built for one specific thing: a small always-on display — a 10-inch
1280 × 800 panel on the corner of a desk — showing the handful of numbers you want to
know without switching windows to find them. It reads this machine, keeps everything
local, and stays out of the way.

## What it shows

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>Your coding agents</strong><br>
      Which sessions are working and which are waiting on you, and the tokens in the
      current 5-hour block with when it resets. Read from local transcripts; no account,
      no API call.
    </td>
    <td width="50%" valign="top">
      <strong>The machine</strong><br>
      CPU history and per-thread load, memory, network and disks, as a full pane or a
      single status line.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <strong>Now playing</strong><br>
      Track, cover art, play, skip and seek, and this computer's volume, for whatever is
      playing on the machine.
    </td>
    <td valign="top">
      <strong>Notifications and focus</strong><br>
      The system's notifications, dismissable, and a focus timer that keeps today's
      focused time across restarts.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <strong>Any shape of display</strong><br>
      Three presets, each arranged for a landscape panel, a 1920 × 480 bar and a tablet on
      its end, and an arranger for your own. Every target is sized for a finger.
    </td>
    <td valign="top">
      <strong>Quiet when you are away</strong><br>
      With nobody at the desk it drops to the time and what is waiting on you, and it
      can dim itself at night.
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <strong>On another device</strong><br>
      Serve the panel to a tablet, a phone or an old laptop on your network: scan a code
      to pair, and it finds the computer again when its address changes. It says plainly
      when the computer has gone away instead of showing old readings as live.
      <a href="docs/remote-panel.md">More about the remote panel</a>.
    </td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/stage-phosphor.png" alt="Stage preset in the Phosphor theme, on the Machine tab: CPU load, temperature and per-thread usage" width="32%">
  <img src="docs/screenshots/panel.png" alt="Panel preset in the Amber theme: clock, token quota, sprint timer, now playing, notifications and a vitals strip, evenly weighted" width="32%">
  <img src="docs/screenshots/ambient.png" alt="Ambient preset in the Ice theme: a very large clock with token usage, now playing, CPU and memory below it" width="32%">
  <br>
  <sub>Stage in Phosphor · Panel in Amber · Ambient in Ice. Any preset takes any theme.</sub>
</p>

## Download

Grab an installer from the [latest release](https://github.com/Purukitto/kehai/releases/latest):

| File | What it is |
| --- | --- |
| `Kehai_x.y.z_x64-setup.exe` | NSIS installer. The usual choice. |
| `Kehai_x.y.z_x64_en-US.msi` | MSI, for policy-managed or scripted installs. |
| `kehai-x.y.z-windows-x64-portable.zip` | A single `kehai.exe`. No install, no uninstaller, no self-update. |

Windows 10 1803 or newer, x64. Kehai uses the system WebView2 runtime, which ships with
Windows 11 and current Windows 10; on an older machine the installer offers to fetch
it.

The binaries are unsigned, so SmartScreen warns on first launch.
[Building from source](docs/building.md) takes about five minutes if you would rather
not trust a stranger's exe. An installed copy [updates itself](docs/using.md#updating),
and refuses any update not signed with the key built into it.

## Getting started

The first time it opens, Kehai asks which display it is for and moves there at once,
so the rest of setup happens on the panel itself: what it can read on this machine,
then a layout and colours drawn for that display. **Skip setup** opens the panel as it
is.

| Key | Does |
| --- | --- |
| `S` | Open and close settings |
| `Esc` | Back to the dashboard |
| `F11` | Fullscreen |

Tap the layout's name in the header to switch layout, or swipe sideways along the
header on a touchscreen. [Using Kehai](docs/using.md) covers the rest.

## Documentation

| Page | What's in it |
| --- | --- |
| [Using Kehai](docs/using.md) | First run, the header, displays, away and night, updates |
| [Layouts and themes](docs/layouts.md) | Presets, landscape, bar and portrait, your own layouts, the arranger |
| [Widgets and sources](docs/widgets.md) | Every widget, and which sources work on which platform |
| [Remote panel](docs/remote-panel.md) | Pairing a tablet, control, going offline, the API |
| [Privacy](docs/privacy.md) | What Kehai writes, sends and listens for |
| [Building from source](docs/building.md) | The mock renderer, release and debug builds, scripts |
| [Architecture](docs/architecture.md) | The engine, the bus, commands, where things are |
| [Design notes](docs/design.md) | Why it looks and behaves the way it does |

## Privacy, in short

- Nothing Kehai reads is uploaded or phoned home. Its log, on your PC, says what Kehai
  did and never what it read.
- The only request it makes is the update check, and only when you ask for one or turn
  on daily checks.
- It listens for nothing until you turn on the remote panel, and then only shows data
  to a device holding the key.
- It reads no notifications until you press **Allow**, and no prompt or response text
  from agent transcripts, ever.

The details, source by source, are in [Privacy](docs/privacy.md).

## Not built yet

- HTTPS for the remote panel, so it can be used on a network you do not trust
- Media and notifications on macOS, which keeps both behind private frameworks
- The system volume on Linux
- Code signing, so installers stop tripping SmartScreen

## Contributing

Widget, layout and settings work runs in a browser against a mock source, with no Rust
in the loop:

```bash
bun install
```

```bash
bun run dev
```

[CONTRIBUTING.md](CONTRIBUTING.md) has the checks CI runs, the house style and how to
add a widget or a poller. Security issues go through [SECURITY.md](SECURITY.md).

## Support

Kehai is free and stays free. If it earns its place on your desk, you can
[buy its author a coffee](https://buymeacoffee.com/purukitto).

## Licence

[MIT](LICENSE) © Pulkit Sambhavi Singh

The bundled [JetBrains Mono](https://www.jetbrains.com/lp/mono/) typeface is © JetBrains
and distributed under the [SIL Open Font License 1.1](https://openfontlicense.org).
