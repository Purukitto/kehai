# Privacy

[Documentation](README.md) › Privacy

Kehai reads local sources and publishes them to its own in-process bus. Nothing it
reads is uploaded, logged to disk or phoned home.

- [What it writes](#what-it-writes)
- [What it sends](#what-it-sends)
- [What it listens for](#what-it-listens-for)
- [Four sources worth stating plainly](#four-sources-worth-stating-plainly)

## What it writes

All in its own app-data folder:

| File | Holds | Why |
| --- | --- | --- |
| `flow.json` | How long the focus timer has run today | So the total survives a restart |
| `display.json` | Which display Kehai is for | So it opens there, before the window is shown |
| `remote.json` | The remote panel's key, once you turn the remote panel on | So paired devices stay paired |

Settings, layouts and themes are kept by the renderer, in its own browser storage.

## What it sends

The font is built in, so Kehai makes one kind of network request, and the renderer's
content-security policy forbids anything else: **the update check**, and only when you
press **Check** or turn on **Check automatically**. It fetches `latest.json` from this
repository's latest GitHub release, which tells GitHub your IP address and that some
copy of Kehai asked — nothing more. Installing downloads the installer from the same
release.

**About → Support Kehai** opens a page in your browser. Kehai itself sends nothing.

## What it listens for

Nothing, unless you turn on **Settings → Remote**. Then it accepts connections on one
port from your network, and shows the panel's data only to a device holding the key.

While it serves, it also announces itself on your local network over mDNS, the way
printers and speakers are found: this computer's name and the port, never the key, so
a paired tablet can find it again after the router hands it a new address. The
pairing link and code carry the same name. Turn the remote panel off and the
announcement stops. More in [Remote panel](remote-panel.md).

## Four sources worth stating plainly

### Notifications

Kehai reads none until you press **Allow**, in setup, on the tile or under
**Settings → Sources**.

On Windows the app then registers as a notification listener, which means it can read
the title and body of toasts from any app, and Windows asks you to confirm. Deny it and
the widget reports the refusal rather than showing an empty feed.

On Linux nothing more prompts: Kehai asks the session bus to copy it every
notification on its way to the notification server, the id the server gives it and
word of it closing, and nothing else — the same access `dbus-monitor` uses, which any
program running as you already has.

Each app can be set to show only its name, or to hide, in the Notifications options.
Kehai applies that as it reads them, so a hidden app's notifications, and a name-only
app's text, never reach the panel or the network. Remote panels see names and counts
only, unless you choose otherwise.

### Agent token usage

The quota widget tallies token counts by tailing local coding agent session
transcripts — under `~/.claude/projects` unless you point **Settings → Sources** at
another folder — reading file modification times, and the usage counters and reply ids
on assistant turns so each reply counts once. No prompt or response text is read,
retained or displayed. There is no API call and no account involved; if the folder
does not exist or holds no transcripts, the source reports itself unavailable and the
rest of the panel is unaffected.

### Agent sessions

The agents widget reads the same transcripts for how each one ends: whether the last
reply finished, which tool calls are still open, when, and the folder the session
works in. It does not parse or keep what you or the model wrote. To tell a reply that
finished from a turn you cut short or a command that never reached the model, it
matches a few fixed markers the agent itself writes in your place, such as the note it
leaves when you interrupt it. The folder's name is shown on the panel, and on a remote
panel too.

### Whether you are at the computer

For the quiet panel, the engine asks Windows once a second how long it has been since
the last keyboard, mouse, pen or touch input, and whether the session is locked: a
duration and a yes or no, never what was pressed or where. Neither is kept, and
neither reaches a remote panel.
