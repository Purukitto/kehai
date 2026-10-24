# Security policy

## Supported versions

Kehai is pre-1.0. Only the latest release gets fixes.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Anything older | No |

## Reporting a vulnerability

Please do not open a public issue.

Use GitHub's private reporting form —
[**Report a vulnerability**](https://github.com/Purukitto/kehai/security/advisories/new)
— or email <purukitto@gmail.com> with `kehai security` in the subject.

Include what you did, what happened, and the version or commit. A proof of concept
helps but is not required to file.

This is a personal project maintained in spare time, so expect an acknowledgement
within about a week rather than within hours.

## What is in scope

Kehai runs locally with the privileges of the user who started it. The interesting
surface is what it reads and what it exposes:

- **The notification listener.** On Windows the app can read the title and body of
  toasts from any application. On Linux it monitors the session bus for notifications
  sent to the notification server, and the match rules it registers ask for those and
  nothing else. Anything that widens either beyond the notification widget, or that
  persists it, is a bug worth reporting.
- **Transcript reading.** The quota poller tails local session transcripts for token
  counters only. Reading, retaining or displaying prompt or response content would be
  a bug.
- **The IPC boundary.** The renderer is read-only except for `media:command`,
  `notify:command`, `flow:command`, `quota:command`, `update:command`,
  `remote:command`, `display:command` and `presence:command`. `media:command` drives
  the player and this computer's volume, with positions and levels the engine puts in
  range. `flow:command` drives the focus timer and sets its block lengths,
  which the engine clamps; the only file it leads to is the timer's own daily total.
  `quota:command` only changes the folder the quota poller reads — it still reads
  nothing but usage counters. `update:command` can ask for a check, an install, or the
  release page, but names no URL: the update feed and the key updates must be signed
  with are compiled in. `remote:command` turns the remote panel on or off, picks its
  port and whether remote panels may press buttons, or replaces its key.
  `display:command` picks the display Kehai is for, and `presence:command` how long
  without input counts as away. A path that lets renderer content reach anything else
  in the engine is in scope.
- **Network requests.** Kehai makes none other than, when you ask for it, the update
  check and download. The font is bundled. While the remote panel is on, it announces
  this computer's name and port over mDNS on the local network, and nothing else. A
  way to make it egress data, or put the key in that announcement, is in scope.
- **The remote panel.** Off by default. When on, `remote.rs` listens on one port. The
  page itself is public — it is this repository's renderer — but the bus, the API and
  every topic need the key, and the key and the update state are never sent to a
  remote. A remote panel can only send the commands in `allowed()` in `remote.rs`,
  and only while control is on. Reading data without the key, sending any other
  command, or getting the engine to touch a file or a URL through this server is in
  scope. Its traffic being readable on the network is not: it is plain HTTP, and
  [the remote panel's documentation](docs/remote-panel.md#security) says so.
- **Updates.** An installer is only run if its minisign signature verifies against the
  public key in the build, and the signature names the version it was made for, so a
  tampered `latest.json` cannot pair a new version number with an older installer.
  Older versions are never offered. A way to get an installed copy to run anything
  else is in scope.
- **Installer and build integrity.** Anything that lets a build or an installer run
  code you did not intend.

## What is not in scope

- The binaries are unsigned, so SmartScreen warns on first launch. This is known and
  listed in the README; a signing certificate is on the roadmap.
- Kehai reads local system state by design. That it can see your CPU load, your
  volumes, your media session and your notifications is the product, not a
  vulnerability.
- Anything requiring an attacker who already has code execution as your user account.
- Vulnerabilities in Tauri, WebView2 or a dependency — report those upstream. If a
  Kehai setting or capability makes one meaningfully worse, that part is in scope.
