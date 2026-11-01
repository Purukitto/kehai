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
| **Main readout** `stage` | One large reading with tabs for tokens, agents, machine and focus. Moves to Agents while one waits on you | agent tokens, agent sessions, processor, memory, focus timer |
| **Machine** `telemetry` | CPU history, memory, network, volumes | processor, memory, network, disk |
| **Status strip** `vitals` | CPU, memory, network, unread and agents in a line | processor, memory, network, notifications, agent sessions |
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
album art is kept with one Now playing tile, the main readout following attention is
for every layout, and the Notifications rules are for this computer and every remote
panel.

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

What these read, and what they never read, is in [Privacy](privacy.md).

## Game widgets

A game widget shows what a game sends to Kehai on this PC, through a route its
publisher offers. Kehai never reads a game's memory, injects into it or watches its
screen, and a game widget shows only what the game already shows you.

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

The tile then shows the score and round, LIVE or BOMB PLANTED, who won each round,
your health and armour (red under 30), money, the weapon in your hands with its ammo,
and your kills, assists, deaths and MVPs. Dead and watching a teammate, it shows theirs
and says so, while **This match** stays yours. Between matches it keeps the last
match's result. Deathmatch has no rounds or money, so those go. A small tile keeps the
first readings in that list and drops the rest; the tile's options turn any of them
off.

It never shows other players, where anyone is, or the bomb's timer: CS2 does not send
when the bomb was planted, and a countdown made from it is an aid some leagues ban.

It wears CS2's own colours, the way RGB lighting for the game does, so it reads from
the corner of your eye: each side in its colour, health green above 60, amber above 29
and red below, armour steel blue, money green, and the ammo amber when the magazine is
nearly empty. The tile's edge lights up too: your side's colour at buy time, the
winner's when a round ends, orange while you burn, and red, breathing, while your
health is low or the bomb is down. A flash washes the tile white as it fades on your
screen, and smoke grey. **Colours** in its options switch to the theme's, and
**Lighting** turns the edge and the washes off. Nothing breathes with reduced motion
turned on in Windows.

A tap on the tile shows it full screen, and another tap, or the header's button, goes
back. **When a match goes live**, in its options, can do either for you: put a layout
of your choice on screen, or the tile full screen, and go back when the match ends or
after two minutes in the menu. Nothing unless you choose. Picking a layout yourself
during the match keeps that one.

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
| `source` | Where the state comes from. `kind` is `valve-gsi`, the only kind so far, with `steamApp` (the game's Steam app id), `cfgDir` (its settings folder, inside the game's), `data` (the blocks to ask for, as the game names them), `game` and `short` (its names), `icon` (an SVG path on a 16 × 16 grid, one colour, never a game's own logo unless its publisher allows), and `asks` and `never`, which SET UP shows |
| `match` | `in`: a value present only during a match. `title`: what the header says, with `{path}` for values. `phase` and `over`: when the match has ended |
| `subject` | Optional. `self` and `who`: the player's id and the id the state is about. When they differ the tile says `tag` and whose state it is, by `name` |
| `lighting` | Optional. `edge`: rules in order, each `when` (a condition), `color` (`#rrggbb`, `you` for the player's side, or `winner`), `pulse` and `tone` (the theme colour to use instead). `overlays`: washes, each `path`, `max`, `color` and `tone` |
| `readings` | 1 to 12, in order of importance, each drawn by one of Kehai's displays |

Each reading has an `id`, a `name` and an `about` for its options, and can say `on:
false` to wait to be turned on, `when` or `unless` (`{ "path", "is": [values] }`, or
`"below"` and `"above"` for a number) to apply only sometimes, and `own: true` to stay
the player's while they watch someone. Colours are the game's own, as `#rrggbb`: a
side's `hex`, a meter's `color` or `ramp` (steps of `above` and `color`), a number's
`color`, and an item's `low` (`below`, a share of `max`, and `color`). A player can
always switch them to the theme's.
The displays:

| `display` | Draws | Fields |
| --- | --- | --- |
| `teams` | Two sides' scores, the round, its phase and who won each round | `you`, `sides` (two, each `label`, `is`, `score`, `color`, `wins`), `round`, `history`, `phase`, `alert` |
| `meters` | Values out of a maximum, as ten blocks | `items`: `label`, `value`, `max`, `low`, `tag` |
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
