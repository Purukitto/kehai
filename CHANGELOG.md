# Changelog

What changed in each release, written for people using Kehai. Each version's section
is also its release notes, and what Kehai shows before it updates itself.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before
1.0.0 a minor version may change the layout format; when one does, it says so here.

## [Unreleased]

### Added

- Kehai can update itself. **Settings → About** checks for a new version and installs
  it: Kehai closes, updates and opens again. **Check automatically** looks once a day,
  and is off unless you turn it on.
- Coming from 0.1.0? Install this version by hand once. Every version after it can
  update itself.

### Fixed

- Settings → About shows the version you are actually running.

## [0.1.0] - 2026-10-20

First public release.

### Added

- A dashboard for a small secondary display: CPU, memory, network and disks, what is
  playing, your notifications, agent token usage, a clock and a focus timer.
- Three layouts — Stage, Panel and Ambient — and three themes — Amber, Phosphor and Ice.
- Drag tiles to move and resize them, and share an arrangement as JSON.
- Reopens on the display you left it on, can start with Windows, and goes fullscreen
  with F11.

### Known issues

- Media and notifications work on Windows only. Linux and macOS show telemetry.
- CPU temperature is usually missing on Windows, where reading it needs a kernel driver.
- The font loads from Google Fonts, so the first launch needs a connection.
- The installers are unsigned, so SmartScreen warns the first time you run one.

[Unreleased]: https://github.com/Purukitto/kehai/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Purukitto/kehai/releases/tag/v0.1.0
