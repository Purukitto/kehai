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

Three arrangements ship, and they differ **only** in `tiles[].area` and
`tiles[].props`. Same grid, same widgets, same theme system.

| Preset | Idea |
| --- | --- |
| **Stage** | One hero readout with a tab strip, supporting tiles around it. The default. |
| **Panel** | Everything at once, evenly weighted — the densest useful arrangement. |
| **Ambient** | Nine values, large. For a panel that is mostly in peripheral vision. |

That constraint is load-bearing. If a single schema could not produce all three from
the same widget set, the layout system would not really be configurable — it would be
three hard-coded screens wearing a data structure.

## The settings screen owns the truth

Layouts are stored by the app, not hand-edited. The Arranger is direct manipulation:
drag a tile to move it, drag its corner to resize. Drop a tile onto an occupied space
and the two swap, because refusing the drop makes a full grid impossible to
rearrange — there is nowhere free to stage a tile.

Export and Import exist so an arrangement can be committed to a repository or shared,
and that is the only time anyone sees the JSON.

## The UI only consumes

Every widget subscribes to bus topics and renders what arrives. It cannot poll, it
cannot call an API, and it holds no state that another widget needs.

The single exception is commands — media transport, notification dismissal, and the
folder the token poller reads — which *publish* an intent onto the bus. The engine owns
the side effect and runs it off the event thread, so a wedged media player can never
freeze the panel.

This is what makes the mock source useful rather than a toy: it publishes the same
envelopes on the same topics, so the entire UI can be built and reviewed in a browser
with no Rust in the loop.

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
