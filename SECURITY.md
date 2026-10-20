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
  toasts from any application. Anything that widens that beyond the notification
  widget, or that persists it, is a bug worth reporting.
- **Transcript reading.** The quota poller tails local session transcripts for token
  counters only. Reading, retaining or displaying prompt or response content would be
  a bug.
- **The IPC boundary.** Widgets are read-only except for `media:command` and
  `notify:command`. A path that lets renderer content reach anything else in the
  engine is in scope.
- **The content-security policy.** Kehai makes no network requests other than the web
  font. A way to make it egress data is in scope.
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
