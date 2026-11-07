# Privacy

[Documentation](README.md) › Privacy

Kehai reads local sources and publishes them to its own in-process bus. Nothing it
reads is uploaded or phoned home, and its log records what Kehai did, never what it
read.

- [What it writes](#what-it-writes)
- [What it sends](#what-it-sends)
- [What it listens for](#what-it-listens-for)
- [Sources worth stating plainly](#sources-worth-stating-plainly)

## What it writes

All in its own app-data folder:

| File | Holds | Why |
| --- | --- | --- |
| `flow.json` | How long the focus timer has run today | So the total survives a restart |
| `display.json` | Which display Kehai is for | So it opens there, before the window is shown |
| `remote.json` | The remote panel's key, once you turn the remote panel on | So paired devices stay paired |
| `window.json` | Whether Kehai has a taskbar button, and whether it shows the panel when it starts | So both apply before the window is shown |
| `games.json` | Each game you set up: where it is, the key in its file, and the port | So the game still reaches Kehai after a restart |
| `backlight.json` | The brightness you set for the display Kehai is for, and the level Kehai last left it at | So a display turned down for the night gets your level back, even after Kehai stops unexpectedly |
| `dock.json` | Each file or folder you picked for the dock in Windows' picker | So the dock opens those, and no other file |
| `widgets\` | Widget files you add yourself, if you open the folder | Read, never run |

Outside that folder, Kehai writes one file and only when you ask: **Set up** for a game
widget puts `gamestate_integration_kehai_<widget>.cfg` in the game's own settings folder,
after showing you where. **REMOVE** deletes it again, and Kehai never touches another
program's file there.

With the dock's **Mic** button, Kehai mutes or unmutes this PC's default microphone, and
the one Windows uses for calls, as Windows' own sound settings do.

Kehai also changes one setting of the display it is for: its brightness, over the
display's own control line (DDC/CI), at night and while you are away, where the display
takes it. It touches no other display, and gives yours back when it quits. See
[Away and night](using.md#away-and-night).

Settings, layouts and themes are kept by the renderer, in its own browser storage.

The log is in the local app-data folder, under `logs`:

| File | Holds | Why |
| --- | --- | --- |
| `kehai.log` | What Kehai started, what failed and why, with the time. At 1 MB it becomes `kehai.1.log`, and three files are kept | So a failure in a build with no console still has a reason |
| `problems.json` | The last five problems Settings → About lists, and whether Kehai last closed by crashing | So they are still there after a restart |

The log holds versions, displays, folder paths Kehai was given, ports, and the errors
the system returned. It never holds notification text, anything from an agent
transcript, what is playing, the remote key, a pairing link, or which app, game, link
or file a dock button opened. **More detail** adds how
often each source published, and turns itself off when Kehai restarts.

## What it sends

The font is built in, so Kehai makes one kind of network request, and the renderer's
content-security policy forbids anything else: **the update check**, and only when you
press **Check** or turn on **Check automatically**. It fetches `latest.json` from this
repository's latest GitHub release, which tells GitHub your IP address and that some
copy of Kehai asked — nothing more. Installing downloads the installer from the same
release.

**About → Support Kehai** opens a page in your browser. Kehai itself sends nothing.

**Report a bug**, in About and in the tray's menu, opens a new issue on GitHub in your
browser. The version, Windows, your displays, which sources report and the last
problems are in the link, and the form shows them. Nothing reaches GitHub unless you
press Create there. The log itself stays on your PC.

## What it listens for

Nothing, unless you turn on **Settings → Remote** or set up a game.

With the remote panel on, it accepts connections on one port from your network, and
shows the panel's data only to a device holding the key.

With a game set up, it listens on `127.0.0.1`, so only programs on this PC can reach it,
on one port it picks the first time (41730 unless that is taken). It accepts only posts
carrying the key written into that game's file, and drops anything in them the widget's
file did not ask for. It stops listening once no game is set up.

While it serves, it also announces itself on your local network over mDNS, the way
printers and speakers are found: this computer's name and the port, never the key, so
a paired tablet can find it again after the router hands it a new address. The
pairing link and code carry the same name. Turn the remote panel off and the
announcement stops. More in [Remote panel](remote-panel.md).

## Sources worth stating plainly

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

To open a notification's app when you tap it, Kehai looks up the Start menu entry for
the app id Windows gives with the notification, and the program that entry runs. When
you tap, it looks at the windows open on this PC: the app id each carries, if any, and
the program it belongs to, to find the app's window. It reads no window's contents, and
keeps none of this beyond which entry each app id leads to, in memory, until Kehai
quits. With no window to bring forward, it starts the app from its Start menu entry, and
for a notification with no app it opens Windows' own notification list. Only an app
with a notification the tile shows can be opened, never by a path or a link, and only
by a tap on this PC: a remote panel cannot. The log says how a tap went, never which
app.

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

To know which sessions are still open, and to bring one's window forward when you tap
it, the widget also reads the small file the agent keeps for each open session, in the
`sessions` folder beside the transcript folder. It reads four fields: the process id,
when that process started, the session id and what the session was started from (the
desktop app, VS Code or a terminal). It never opens anything else in that folder, such
as the key kept beside each file, and never writes there. The session's name, which the
agent usually makes from your first prompt, is not read. A tap only brings an existing
window to the front, and only a tap or a click on this PC can: a remote panel cannot.
The log says which kind of window it went to, or why it could not, and never which
session.

### Whether you are at the computer

For the quiet panel, the engine asks Windows once a second how long it has been since
the last keyboard, mouse, pen or touch input, and whether the session is locked: a
duration and a yes or no, never what was pressed or where. So that a tap doesn't pull
a game out of the front, it also asks which window is in front and whether that window
fills its display, keeping only the yes or no, never the window's title or program.
None of it is kept, and none of it reaches a remote panel.

### The dock

The dock's add sheet lists the apps in the Start menu, with their icons, and the games
in Steam's libraries, from Steam's own files on this PC: each game's manifest (its name,
folder and when it was last played) and the cover Steam keeps for it. It reads these
only while the sheet is open, keeps them in memory, and never sends the list beyond
this PC's panel.

For the apps and games on its buttons, every few seconds, it looks at which windows are
open and the programs they belong to, never their contents; at Windows' own privacy
records of which apps have the microphone open now, the same ones the taskbar's
microphone indicator reads, never when an app last used it; and, for an agent session
waiting on you, at the programs above the session's process, to find the app it runs
in. A tablet sees the buttons, their icons and covers, and which app is listening, never
the list of what is installed.

A button opens only what the dock holds: an app by its Start menu entry, a game through
Steam, an https link, or a file or folder picked in Windows' picker on this PC. Only a
tap on this PC opens anything; a remote panel cannot.

### Games

A game widget reads only what the game sends to Kehai on this PC through the
publisher's own route. For Counter-Strike 2 that is Valve's game state integration,
which Valve describes for lighting, overlays and peripherals on the player's PC. Kehai
asks only for the map, the score and rounds, whose view the game is showing, and the
player's own kills, assists, deaths and MVPs. It never asks for their health, money or
weapons, other players, positions or the bomb's timer, and never reads the game's
memory or touches the game itself. What the game sends is not kept on disk, except
how each match ended: the map, when, the score and the player's own figures, the last
60 matches, in the panel's own storage on this PC, for the tile's list of tonight's
matches. **Forget them**, in the tile's options, clears them. A remote panel keeps
its own list, in its browser, of the matches it saw. A remote panel shows the tile as this PC does; the key
in the game's file never leaves this PC.
