# Changelog

What changed in each release, written for people using Kehai. Each version's section
is also its release notes, and what Kehai shows before it updates itself.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before
1.0.0 a minor version may change the layout format; when one does, it says so here.

## [Unreleased]

### Added

- An **Agents** tile shows which coding-agent sessions are working and which are
  waiting on you, and for how long. Stage has an Agents tab, and the vitals strip can
  count the ones waiting. It reads the same local transcripts as token usage, never
  what you or the agent wrote.

### Changed

- Panel has an Agents tile beside the notifications, and Stage counts waiting agents
  in its corner. A preset you have not rearranged picks up changes like these by
  itself, and keeps your theme.

### Fixed

- Changing the grid's columns or rows could make Kehai forget every setting the next
  time it started. Tiles now keep their proportions when the grid changes, and a
  layout that cannot be read costs only the layout.
- Picking a preset no longer throws away your own arrangement or changes your theme.
  **Custom** brings the arrangement back.
- A widget turned on in **Settings → Widgets** goes into free space, or takes a strip
  from the largest tile, instead of landing on top of other tiles.
- **Remove** in the tile arranger removes the selected tile, not every tile of that kind.
- **Reset everything** asks for a second press before it resets.

## [0.2.0] - 2026-10-21

The first published release. 0.1.0 never left draft, so everything it lists is in
here too; what follows is what changed since.

### Added

- The focus timer has buttons: start, pause, skip and reset it from its tile or from
  Stage's sprint tab. **Settings → Sources** sets how long focus blocks and breaks
  are, and today's focused time survives a restart.
- Linux: what is playing, with transport controls, from any MPRIS player, and the
  notification feed. Notifications show from the moment Kehai starts; Linux keeps no
  history to read back.
- A remote panel: **Settings → Remote** serves the dashboard to a browser on another
  machine on your network, paired by a link. Remote panels only look, unless you allow
  them to press the media, notification and timer buttons. The same port has a small
  API for scripts. It is off until you turn it on.
- F11 goes fullscreen on a remote panel too.

### Changed

- Agent token usage counts the current 5-hour block instead of the last five hours,
  and shows when the block resets. The reset time is an estimate: the provider does
  not publish how its window works.

### Fixed

- The focus timer showed a made-up countdown in the desktop app. It now runs for real,
  and waits for you to start it.
- Stage's main tile reaches the bottom of its space instead of stopping short.
- The font is built in. Kehai no longer fetches it from Google Fonts, and looks right
  on a machine that has never been online.
- Agent token usage counted most replies two or three times, because the transcript
  repeats a reply's usage on every line of it. Each reply now counts once.
- Agent token usage includes sub-agents, whose transcripts sit in folders the count
  never looked in.

### Known issues

- CPU temperature is usually missing on Windows, where reading it needs a kernel driver.
- Media and notifications are not available on macOS.
- The remote panel is plain HTTP. Use it on a network you trust.
- The installers are unsigned, so SmartScreen warns the first time you run one.

## [0.1.0] - 2026-10-21

Cut but never published. Everything here first shipped in 0.2.0.

### Added

- A dashboard for a small secondary display: CPU, memory, network and disks, what is
  playing, your notifications, agent token usage, a clock and a focus timer.
- Three layouts — Stage, Panel and Ambient — and three themes — Amber, Phosphor and Ice.
- Drag tiles to move and resize them, and share an arrangement as JSON.
- Reopens on the display you left it on, can start with Windows, and goes fullscreen
  with F11.
- Updates itself. **Settings → About** checks for a new version and installs it:
  Kehai closes, updates and opens again. **Check automatically** looks once a day, and
  is off unless you turn it on.

### Known issues

- Media and notifications work on Windows only. Linux and macOS show telemetry.
- CPU temperature is usually missing on Windows, where reading it needs a kernel driver.
- The font loads from Google Fonts, so the first launch needs a connection.
- The installers are unsigned, so SmartScreen warns the first time you run one.

[Unreleased]: https://github.com/Purukitto/kehai/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Purukitto/kehai/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Purukitto/kehai/releases/tag/v0.1.0
