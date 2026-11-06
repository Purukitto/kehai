# Widgets and sources

[Documentation](README.md) › Widgets and sources

- [Widgets](#widgets)
- [Game widgets](#game-widgets)
- [Writing a game widget](#writing-a-game-widget)
- [Sources by platform](#sources-by-platform)
- [When a source is unavailable](#when-a-source-is-unavailable)

## Widgets

| Widget | Shows | Reads |
| --- | --- | --- |
| **Main readout** `stage` | One large reading with tabs for tokens, agents, machine and focus. Moves to Agents while one waits on you | agent tokens, agent sessions, processor, graphics, memory, focus timer |
| **Machine** `telemetry` | CPU history, the graphics card, memory, network, volumes | processor, graphics, memory, network, disk |
| **Status strip** `vitals` | The readings you choose in a line: CPU, GPU, GPU temperature, memory, network, unread, agents | processor, graphics, memory, network, notifications, agent sessions |
| **Agents** `agents` | Which agent sessions are working and which are waiting on you | agent sessions |
| **Token usage** `quota` | Agent tokens in the current 5-hour block, and when it resets | agent tokens |
| **Now playing** `media` | Track, transport, seek, cover art and this computer's volume | media session |
| **Notifications** `notify` | System notification feed, dismissable | notifications |
| **Clock** `clock` | Time and date; hours over minutes in a tall tile | clock |
| **Focus timer** `sprint` | Start, pause, skip, reset | focus timer |
| **Counter-Strike 2** `cs2` | Your health, armour, money, weapon, the score and your match, while you play | Counter-Strike 2, sent by the game to this PC |

Every widget lays itself out for the size of its tile, so the same widget is a full
pane in one layout and a single row in another.

**Settings → Widgets** lists every widget, what it reads and whether that is reporting.
Which widgets are on screen is under **Settings → Layout → On this layout**.

A widget's options open from its tile: hold it, or right-click it. **Options** under
Settings → Widgets opens the same ones. Each group of options says where it applies:
album art, the status strip's readings and the main readout's tabs are kept with one
tile, the main readout following attention and the graphics card are for every
layout, and the Notifications rules are for this computer and every remote panel.
Changing a preset's tile saves a copy of it under Yours.

### The machine and the graphics card

The main readout's Machine tab shows the processor and, on a PC with a graphics card,
the card beside it: each with its load, temperature, a sentence and a meter, then load
per thread for the processor and the last minute of load for the card. The Machine
tile gives the card a section of its own, and the status strip has **GPU** and
**GPU temp** readings.

A card's load is its busiest engine's — 3D, video, compute or copy — as Task Manager
shows it, so it can read lower than a vendor's tool that measures how long the card was
busy at all. Its memory is the card's own; integrated graphics, which has almost none,
counts the system memory it shares. Temperature, fan speed and power come from the
card's driver, and turn up only where the driver reports them. Temperature turns red at
the warning point the driver gives, and on a card that gives none it is never coloured.
Load is never coloured: a card at 100% in a game is doing its job.

With more than one card, Kehai shows the one with the most memory of its own. Where two
or more report, the strip's, the main readout's and the Machine tile's options each
offer **Graphics card**, one setting for the whole panel.

The status strip shows the readings its options switch on, in a fixed order. In a
single line it shrinks its values until they all fit, and leaves out whole any that
still do not. A reading this PC can't give leaves the strip: both GPU readings without
a card, and GPU temp on a card whose driver reports no temperature.

### Notifications

Each app with a notification in the Windows list appears in the Notifications options,
newest first, marked **New** the first time. Each can **Show**, show its **Name only**,
as one row on the tile with how many, or **Hide**, which leaves it off the tile and out
of the count. Kehai decides this before anything reaches the panel, so a hidden app's
notifications never leave this computer. The Windows list itself is left alone, and
**Clear all** clears only what the tile shows.

While a focus block runs, the tile shows only how many are waiting and when the break
comes, unless the options turn that off. It does not follow Windows' Do Not Disturb:
Windows does not tell other apps reliably whether it is on, and a tile that went quiet
while Do Not Disturb showed off would look broken.

Remote panels see each app's name and how many unless the options say otherwise:
**Same as here**, **Name only** or **Nothing**.

### Now playing

Previous, play or pause, and next control whatever is playing on the machine. Tap or
drag the progress bar to seek — in a one-row tile, the line along its bottom edge —
and the player moves when you let go. A player that cannot seek, such as some browser
tabs, keeps a plain line.

The speaker after next opens this computer's volume: mute, − and +, which move it by
2 as the volume keys do, and ten steps to tap. It goes back to the buttons after a few
seconds untouched. A wide tile keeps the volume beside the buttons instead, and with
nothing playing the speaker stays, because it is the computer's volume, not the
track's.

### Token usage and agents

Both read local coding agent session transcripts, and neither needs an account or an
API call. Usage is counted per 5-hour block: one opens with the first request after
the last one closed, on the hour before it, and the widget shows when it resets. The
provider does not publish how its window works, so that time is an estimate worked out
from the transcripts, the same way other local usage tools do it.

**Agents** shows each session from the last hour, the ones waiting on you first. A tool
call that has not returned shows as **TOOL**. That is also all a permission prompt
looks like, because nothing is written until it is answered, so Kehai lights one that
has been open for half a minute but never claims it is waiting on you.

**Tap a session to go to it.** Its window comes to the front on the display it is on,
and the row says so for a moment: **Opened the desktop app**, **Opened VS Code** or
**Opened the terminal**. The one waiting on you says **Go to** under its status. The
agent's desktop app has no way to open one session from outside, so it comes forward
and you pick the session in its own list; Kehai doesn't pick a tab in a terminal or
an editor either. If Windows keeps another window in front, the row says **Couldn't
bring it forward**, and the log says why. Ambient's line goes to the session it names,
and the tray's menu lists up to three sessions waiting on you, to go to with a click.

Kehai knows which sessions are open from the small file the agent keeps for each one
beside its transcripts. A session you have closed leaves the list, and stops counting
as waiting. An agent that keeps no such files shows its sessions as before, with
nothing to tap. Tablets can't go to a session, since only the PC can bring its own
windows forward: a tap there says **Open it on the PC**. Going to a window works on
Windows only for now.

What these read, and what they never read, is in [Privacy](privacy.md).

## Game widgets

A game widget reads what a game sends to Kehai on this PC, through a route its
publisher offers. Kehai never reads a game's memory, injects into it or watches its
screen. It does two things: it keeps the panel still while you play, and it fills the
gaps, after you die, at half time, between matches, with what the game does not keep.
It never copies the game's own HUD, which is already where you are looking.

### Counter-Strike 2

Uses Valve's game state integration, the route Valve describes for lighting, overlays
and peripherals on the player's PC.

1. Put the **Counter-Strike 2** tile on a layout, from **Settings → Layout → On this
   layout** or the arranger.
2. Press **Set up** on the tile, or under **Settings → Widgets**. Kehai finds CS2
   through Steam's list of library folders, or asks for its folder, and shows the file
   it will write, what it asks the game for and what it never asks for.
3. **Write the file** puts `gamestate_integration_kehai_cs2.cfg` in
   `game\csgo\cfg`. Start CS2, or restart it: it reads the file when it starts.

**While you're in a round, the panel goes still.** Dark, nothing moving or lighting
up, the score dimly and how many notifications and agents are waiting. They are kept,
not shown. It opens by itself when you die and watch a teammate, at half time and
after the match, and a touch opens it sooner. **While you play**, in the tile's
options, can leave the panel as it is instead, or put another layout on screen for
the match.

In the gaps the tile shows the score and the round, who won each round so far, and
your kills, assists, deaths and MVPs, which stay yours while you watch someone else.
Between matches, and after CS2 closes, it shows **Tonight**: each match since the last
three-hour break, how it ended, the score from your side and your figures, with the
time played. CS2 forgets these between matches; Kehai keeps the last 60, on this
panel only, and **Forget them** in the options clears them. Deathmatch has no rounds,
so the score goes.

It never shows your health, money or weapons, which the HUD already does, and never
other players, where anyone is, or the bomb's timer: CS2 does not send when the bomb
was planted, and a countdown made from it is an aid some leagues ban.

Each side is in CS2's own colour, so it reads from the corner of your eye.
**Colours** in its options switch to the theme's.

A copy set up with 0.11 has CS2 still sending health, money and weapons. Kehai shows
none of it, and **Remove** then **Set up** writes the smaller file.

**Remove**, in the options, deletes Kehai's file. Other programs' files in that folder,
such as Overwolf's, are left as they are.

FACEIT lists game config files as safe, but has not said whether its anti-cheat minds
another program running alongside. If you play there, one match settles it.

## Writing a game widget

A game widget is a single `.widget.json` file: data, never code. Put it in the widgets
folder (**Settings → Widgets → Your widgets folder → Open folder**) and Kehai checks it
within a few seconds. A file that does not pass is listed with why, and never half
loaded. `src/widgets/cs2.widget.json` is a complete example.

Beside the usual `kehai`, `id`, `name`, `about` and `min`, it has:

| Field | What it says |
| --- | --- |
| `source` | Where the state comes from. `kind` is `valve-gsi`, the only kind so far, with `steamApp` (the game's Steam app id), `cfgDir` (its settings folder, inside the game's), `data` (the blocks to ask for, as the game names them), `game` and `short` (its names), `icon` (an SVG path on a 16 × 16 grid, one colour, never a game's own logo unless its publisher allows), and `asks` and `never`, which Set up shows |
| `match` | `in`: a value present only during a match. `title`: what the header says, with `{path}` for values. `phase` and `over`: when the match has ended. `still`: optional, a condition for when the player is in play, and the panel goes still; without it, the whole match is |
| `subject` | Optional. `self` and `who`: the player's id and the id the state is about. When they differ the player is out, watching someone, and the panel opens |
| `readings` | 1 to 12, in order of importance, each drawn by one of Kehai's displays |

Each reading has an `id`, a `name` and an `about` for its options, and can say `on:
false` to wait to be turned on, `when` or `unless` (`{ "path", "is": [values] }`, or
`"below"` and `"above"` for a number) to apply only sometimes, and `own: true` to stay
the player's while they watch someone. Colours are the game's own, as `#rrggbb`: a
side's `hex`, a meter's `color` or `ramp` (steps of `above` and `color`), a number's
`color`, and an item's `low` (`below`, a share of `max`, and `color`). A player can
always switch them to the theme's.

List what the game does not show the player, never a copy of its HUD: the tile is
read in the gaps, not during play. A racing game's fuel for so many laps, or a
strategy game's timings, earn a place; health and ammo do not.

The displays:

| `display` | Draws | Fields |
| --- | --- | --- |
| `teams` | Two sides' scores, the round, its phase and who won each round | `you`, `sides` (two, each `label`, `is`, `score`, `color`, `wins`), `round`, `history`, `phase`, `alert` |
| `meters` | Values out of a maximum, with a bar | `items`: `label`, `value`, `max`, `low`, `tag` |
| `numbers` | Plain values | `items`: `label`, `value`, `prefix` |
| `item` | One thing in hand, with a count | `label`, `item`, `names`, `strip`, `count`, `max`, `rest` |
| `stats` | A row of small values | `label`, `items`: `label`, `short`, `value` |
| `line` | A line of text | `label`, `text` with `{path}` for values |

A value is found by path: keys joined by dots (`player.state.health`), `*` for any one
key's value, and `*[key=value]` for the one whose `key` is `value`
(`player.weapons.*[state=active].name`). Kehai asks the game only for the `data` blocks
the file names and drops anything else it sends, so a widget only ever sees what its
file asked for.

Before writing one for a game, read the game's terms and what its publisher offers:
a widget should use only a route the publisher documents or plainly allows, and show
only what the game already shows you.

## Sources by platform

| Source | Windows | Linux | macOS |
| --- | --- | --- | --- |
| CPU, memory, network, disk | via `sysinfo` | via `sysinfo` | via `sysinfo` |
| CPU package temperature | usually unavailable — [see below](#why-cpu-temperature-is-usually-missing-on-windows) | label varies | label varies |
| Graphics card load and memory | the counters Task Manager reads, with the cards listed by DXGI | not wired | not wired |
| Graphics card temperature, fan and power | from the card's driver, where it reports them (Windows 10 2004 or later) | not wired | not wired |
| Media session, transport and seek | via GSMTC, including cover art | via MPRIS; cover art only from local files | not wired |
| System volume | the default output, as the volume keys turn it | not wired | not wired |
| Notifications | via `UserNotificationListener` | via a session-bus monitor; only those that arrive while Kehai runs | not wired |
| Agent token usage | optional — needs local agent transcripts | same | same |
| Agent sessions | optional — the same transcripts | same | same |
| Focus timer | kept by the engine | same | same |
| Whether you are at the computer | time since the last input, and the lock | not wired | not wired |
| A game's state | sent by the game to `127.0.0.1` once set up; Steam found through the registry | the same; Steam found in your home folder | not wired |

## When a source is unavailable

The widget says so, and **Settings → Sources** shows it as **UNAVAILABLE** with the
reason. Nothing shows a zero it does not have — see the
[design notes](design.md#undefined-is-a-real-state).

### Why CPU temperature is usually missing on Windows

CPU die temperature lives in model-specific registers — the digital thermal sensor on
Intel, Tctl on AMD — and reading one takes the `rdmsr` instruction, which only kernel
mode can execute. The two routes Windows offers ordinary processes are an ACPI thermal
zone, which needs elevation and on many desktops reports a chassis zone or nothing at
all, and `Win32_TemperatureProbe`, which almost no hardware populates.

Tools like HWMonitor and HWiNFO get around this by installing a kernel driver. Kehai
deliberately does not: a driver needs administrator rights to install, and generic
MSR-access drivers have a history of letting unprivileged code read and write hardware
registers. That is a poor trade for one number on a dashboard.
