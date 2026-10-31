# Using Kehai

[Documentation](README.md) › Using Kehai

- [First run](#first-run)
- [Keys and touch](#keys-and-touch)
- [The header](#the-header)
- [Window and displays](#window-and-displays)
- [Away and night](#away-and-night)
- [Updating](#updating)

## First run

The first time it opens, Kehai runs a short setup. It asks which display it is for and
moves there as soon as you choose, so the rest of setup happens on the panel itself:
what it can read on this machine, notifications included, then the layout and colours,
drawn for that display, and last whether it starts with Windows.

**Skip setup** opens the panel as it is, and **Settings → About → Run setup again**
brings setup back. A copy updated from 0.6 or earlier skips it.

## Keys and touch

| Key | Does |
| --- | --- |
| `S` | Open and close settings |
| `Esc` | Back to the dashboard |
| `F11` | Fullscreen |

Nothing on the panel you can press is smaller than 28px, so a touchscreen needs no
mode of its own. Transport and timer buttons are bigger still.

Hold a tile for half a second, or right-click it, and that widget's options open beside
it. The rest of the panel dims and the tile stays lit, so a change shows on it as you
make it. Dragging the seek bar never counts as a hold. On a remote panel a hold only
says the options are on the computer Kehai runs on.

## The header

The layout's name in the header switches layout: tap it for a list, or on a
touchscreen swipe sideways along the header for the next or previous one. The gear
opens settings.

Beside the layout, a dot and a word say where the panel's data comes from:

| Header | Means |
| --- | --- |
| `ENGINE` | The desktop app, reading this machine |
| `MOCK` | The renderer on its own, in a browser, with made-up data |
| `REMOTE` | A [remote panel](remote-panel.md), showing another machine |
| `REMOTE · VIEW ONLY` | The same, with its buttons turned off by the host |
| `REMOTE · OFFLINE SINCE 23:12` | The host stopped answering at 23:12; every tile is dimmed |

**Settings → Window** can hide the header until you move to the top of the screen.

## Window and displays

The window is undecorated and draws its own title bar; drag it by the top strip.

**Settings → Window** shows your displays as the system arranges them. Tap one and
Kehai moves there, filling it or in a window. It reopens on that display, and if the
display is not connected it opens in a window on the main one instead, says so in the
header, and moves back by itself once the display returns. Dragging it onto another
display makes that the one it is for.

The same page turns on starting with Windows and the auto-hiding header.

## Away and night

**Settings → Appearance** turns everything Kehai draws down at night, between two
times you set, and decides what the panel shows while nobody is at the computer.

After a while with no keyboard, mouse or touch — 10 minutes unless you pick 5, 30 or
never — it goes quiet. What it shows then is your choice:

| Quiet view | Shows |
| --- | --- |
| **Clock** | The time, dim, and only what is running or waiting on you, with notifications as a count and never their text |
| **Dimmed panel** | The panel as it was, at half brightness, with notification text hidden |
| **Nothing** | Dark, until an agent waits on you |

A touch or a nudge of the mouse brings it back, and the first tap only wakes it, so it
never presses a button you could not see. While Windows is locked its lock screen
covers every display, and Kehai stops drawing.

Setup turns both on. A copy that already had settings keeps both off until you turn
them on.

## Updating

An installed copy updates itself. **Settings → About → Check** asks GitHub for the
latest release, shows what changed, and **Install** closes Kehai, runs the new
installer and opens it again. Turn on **Check automatically** to have it look once a
day; it is off until you do.

Every update is signed, and Kehai refuses one whose signature does not match the key
built into it. The portable build cannot replace itself, so it links to the release
page instead.
