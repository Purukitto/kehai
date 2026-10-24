# Design notes

Why Kehai looks and behaves the way it does. This is the reasoning, not a style
guide — the code is the specification.

## The surface

**1280 × 800 on a 10-inch panel** is 151 PPI, sitting roughly an arm's length away
and off to one side. That number decides most of the rest.

Glanceable means *few numbers and big ones*. The three presets carry about eighteen,
twelve and nine readable values respectively, and the smallest hit target on any of
them is a 28-pixel chip — which also settles the touchscreen question without a
separate touch mode.

A panel you look at sideways cannot ask for attention. Chrome stays at a low
contrast, the hairlines are one pixel of `--cc-line`, and nothing animates unless the
underlying value is genuinely moving.

## Presets

Three layouts ship, and they differ **only** in `tiles[].area` and `tiles[].props`.
Same widgets, same theme system.

| Preset | Idea |
| --- | --- |
| **Stage** | One hero readout with a tab strip, supporting tiles around it. The default. |
| **Panel** | Everything at once, evenly weighted — the densest useful arrangement. |
| **Ambient** | Nine values, large. For a panel that is mostly in peripheral vision. |

That constraint is load-bearing. If a single schema could not produce all three from
the same widget set, the layout system would not really be configurable — it would be
three hard-coded screens wearing a data structure.

## One arrangement per shape of display

A small display is not always 16:10. Bar displays run at 4:1 or wider, and a tablet
used as a remote panel stands on its end. One arrangement stretched over all of them
gives tiles three times too wide on a bar and a clock cut off in portrait.

So a layout holds three arrangements, each with its own grid:

| Shape | Window | Grid |
| --- | --- | --- |
| landscape | anything from square to 2.4 : 1 | 12 × 8 |
| bar | wider than 2.4 : 1 | 16 × 4 |
| portrait | taller than wide | 8 × 12 |

Kehai picks one from the shape of its window, so a remote panel on a tablet turns
with the tablet. The grids keep cells close to square, so a widget's minimum size in
cells means about the same on every display.

What matters at a glance comes first in every arrangement, in this order: an agent
waiting on you, the token block and when it resets, the time, the focus timer, what
is playing, notifications, then the machine.

## The settings screen owns the truth

Layouts are stored by the app, not hand-edited. Presets are never stored at all: they
cannot be changed, so one nobody has edited always follows the version that shipped.
The first change to a preset saves a copy under **Yours** instead, and picking a
layout never throws another away. Selecting a card only selects it; **Use** is what
changes the screen. The theme is not part of a layout, so changing layout never
changes colours.

The Arranger is direct manipulation: drag a tile to move it, drag its corner to
resize. Drop a tile onto an occupied space and the two swap, because refusing the
drop makes a full grid impossible to rearrange — there is nowhere free to stage a
tile. Each shape has its own tab, and a shape other than the window's is drawn at its
own proportions, so a bar display can be laid out from a desk monitor. Changing the
grid size carries every tile to the same proportion of the new grid.

Export and Import exist so a layout can be committed to a repository or shared, and
that is the only time anyone sees the JSON.

## First run

A fresh install used to open a frameless window wherever the system put it, usually on
top of your work, and leave you to find out how to get it onto the small display.
Setup starts with that question. Choosing a display moves Kehai there at once, so you
see which one it is, and the rest of setup happens on the panel itself, where every
preview is drawn at the size and shape it will be. Setup lays itself out for landscape,
bar and portrait like the panel does, with touch-sized buttons, because the display it
lands on may be any of them.

The display Kehai is for belongs to the engine, in `display.json`, not to the
renderer's settings. It has to act before the window is first shown: a panel that is
unplugged must not see Kehai reopen filling the main display. So the engine places the
window before showing it, opens in a window on the main display when the chosen one is
missing, and moves back when it returns. A display that drops out for a moment, as a
sleeping monitor does, is waited for. Dragging the window to another display, or
pressing F11, is taken as your choice once Kehai's own moves have settled.

Nothing reads notifications until you press Allow. The system's own prompt asks for
something the panel has not explained yet, so setup explains it first and the prompt
comes after.

## Away and night

The panel is on all day, and a panel that looks the same with nobody at the desk, or
at midnight, shows notification text to whoever walks past and lights the room. So it
has two quieter states.

Away is decided by the engine, from how long the computer has gone without input,
against a delay the renderer sends it. The quiet panel then shows the time in the
muted colour and only what is worth seeing from across the room: an agent waiting, in
the accent and at full size, then a timer counting down, since a break is when you
are away, then how many notifications came. Never what they say. It lies over the
whole window, so the first tap lands on it and only wakes the panel; a tap that also
pressed whatever was underneath would press something nobody could see. The screen
underneath is hidden, not closed, so waking finds it as it was, sparklines and all.

A locked session needs nothing hidden: the system's lock screen already covers every
display. Kehai only stops drawing until you are back. When you are at your desk is
nobody else's business, so the topic stays with the local panel, and a remote panel
never goes quiet.

Night is the renderer's alone, by the panel's own clock, between fixed hours: sunset
would need a location, and Kehai asks for none. It is a brightness filter over the
whole page, so every theme dims the same way and none needs a night version. A
backlit panel only goes so far that way, since black stays as bright as the backlight.
Turning the backlight itself down, where a display takes the command, is not done yet.

## The UI only consumes

Every widget subscribes to bus topics and renders what arrives. It cannot poll, it
cannot call an API, and it holds no state that another widget needs.

The single exception is commands — media transport, notification dismissal and the
go-ahead to read them, the focus timer's buttons and block lengths, the folder the
token poller reads, whether to serve remote panels, which display to show on, how
long without input counts as away, and checking for or installing an update — which
*publish* an intent onto the bus. The engine owns
the side effect and runs it off the event thread, so a wedged media player can never
freeze the panel.

This is what makes the mock source useful rather than a toy: it publishes the same
envelopes on the same topics, so the entire UI can be built and reviewed in a browser
with no Rust in the loop.

It is also what makes the remote panel nearly free. A browser on another machine
runs the same renderer; only the source differs, a WebSocket in place of the Tauri
bridge. Nothing above the bus knows which one it has.

## `undefined` is a real state

A topic that has not published yet renders `--` or `Awaiting`, never `0`. A `null`
sensor reading — CPU package temperature on a machine with no vendor driver — stays
null instead of being coerced.

A dashboard that invents zeroes is worse than one that admits it does not know, because
a zero is indistinguishable from a real reading. The same rule covers platform
refusals: when the notification listener is denied, the widget says so rather than
showing an empty feed that looks like a quiet day.

## Themes are thirteen custom properties

A theme is a class on the root element that sets thirteen CSS custom properties, and
nothing else. Swapping the class re-themes the whole app with no React re-render.

| Theme | Character |
| --- | --- |
| **Amber** | Warm near-black, amber accent, cyan secondary. The default. |
| **Phosphor** | Green monochrome, in the spirit of a P1 CRT. |
| **Ice** | Cool blue-grey with a violet secondary. |

Thirteen is the whole vocabulary: three backgrounds, one inset, two line weights,
three text weights, two accents, a danger and an ok. Anything a widget needs that is
not in that list is a sign the widget is over-designed.

## Responsiveness is per-tile

There are no viewport breakpoints. A widget branches on the size of *its own grid
cell*, because the same widget can be three columns wide in one preset and twelve in
another on the same display.

Two details make that work in practice. The measured element is the grid cell, never
the widget's own root — measuring the root sets up a feedback loop where the widget
picks a compact layout, its content shrinks, the element shrinks, and it flips back.
And each breakpoint has a dead zone, so a tile sitting exactly on a threshold cannot
oscillate as sub-pixel rounding nudges it.

Sections drop from the bottom as a tile shrinks, in a fixed order per widget. The
widget decides what to lose, not the grid.
