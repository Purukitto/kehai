# Widgets and sources

[Documentation](README.md) › Widgets and sources

- [Widgets](#widgets)
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
