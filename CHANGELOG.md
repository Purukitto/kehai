# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before
1.0.0, minor versions may contain breaking changes to the layout format or the bus
topics; those are always listed here.

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-10-20

First public release.

### Added

- **Event bus** with wildcard subscriptions and last-value retention on both sides of
  the IPC boundary, replay on renderer attach, and a command path back from the
  renderer to the engine.
- **Integration engine** in Rust: one thread per source, so a stalled poller can only
  stall itself.
  - CPU (usage, per-thread load, clock, package temperature where a sensor is exposed),
    memory, network throughput per interface and disk volumes, all via `sysinfo`.
  - Media session and transport on Windows via GSMTC, including cover art.
  - Windows toast notifications via `UserNotificationListener`, dismissable from the
    widget.
  - Agent token usage over a rolling five-hour window, tallied from local session
    transcripts. Optional: with no transcripts the source reports itself
    unavailable, naming the path it looked in, instead of going silent.
- **Eight widgets**: stage, telemetry, vitals, quota, media, notify, clock, sprint.
  Each declares its own minimum size and the topics it reads, and is reached only
  through the registry — a layout naming an unknown widget renders a placeholder
  rather than crashing.
- **Per-tile responsiveness.** Widgets branch on the size of their own grid cell, with
  a dead zone at each breakpoint so a tile sitting on a threshold cannot oscillate.
- **Three layout presets** — Stage, Panel and Ambient — differing only in tile areas
  and props. Stage drops a tab whose source has nothing to report.
- **Three themes** — Amber, Phosphor and Ice — each thirteen CSS custom properties
  under a class on the root element.
- **Settings screen** covering presets, theme, widgets, window, sources and about,
  with layout Export and Import. Each source reads as reporting, silent, or
  unavailable with the reason it gave.
- **Tile arranger**: drag to move, drag a corner to resize up to the neighbours, drop
  onto an occupied tile to swap the two, and `tidy()` as the escape hatch out of an
  already-overlapping layout.
- **Layout validation** on every path including the bundled presets, so a malformed
  layout is reported rather than thrown at the renderer.
- **Window behaviour**: undecorated with self-drawn title bar and traffic lights,
  position and size restored per display, autostart, fullscreen on `F11`, and an
  optional auto-hiding top bar.
- Layout, theme and options persisted across launches.
- **Mock source** publishing the same envelopes on the same topics as the engine, so
  the entire UI can be built and reviewed in a browser.

### Known limitations

- Linux and macOS: media (MPRIS) and notifications (D-Bus) are not wired and report as
  unavailable. Telemetry works.
- CPU temperature is usually unavailable on Windows. Reading it needs a kernel-mode
  driver, which Kehai deliberately does not install.
- JetBrains Mono is loaded from Google Fonts, so first paint needs a network round
  trip and the desktop build does not yet work fully offline.
- Installers are unsigned, so SmartScreen warns on first launch.
- No headless WebSocket or REST surface yet.

[Unreleased]: https://github.com/Purukitto/kehai/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Purukitto/kehai/releases/tag/v0.1.0
