# Layouts and themes

[Documentation](README.md) › Layouts and themes

- [Presets](#presets)
- [One layout, three shapes](#one-layout-three-shapes)
- [Your own layouts](#your-own-layouts)
- [Arranging](#arranging)
- [Themes](#themes)

<p align="center">
  <img src="screenshots/stage-phosphor.png" alt="Stage preset in the Phosphor theme, on the Machine tab: CPU load, temperature and per-thread usage" width="32%">
  <img src="screenshots/panel.png" alt="Panel preset in the Amber theme: clock, token quota, sprint timer, now playing, notifications and a vitals strip, evenly weighted" width="32%">
  <img src="screenshots/ambient.png" alt="Ambient preset in the Ice theme: a very large clock with token usage, now playing, CPU and memory below it" width="32%">
  <br>
  <sub>Stage in Phosphor · Panel in Amber · Ambient in Ice. Any preset takes any theme.</sub>
</p>

## Presets

Three layouts ship. They use the same widgets and differ only in where those go.

| Preset | Idea |
| --- | --- |
| **Stage** | One large readout with tabs for tokens, agents, machine and focus, and supporting tiles around it. The default. |
| **Panel** | Everything at once, evenly weighted: the densest useful arrangement. |
| **Ambient** | Nine values, large, for a panel that is mostly in the corner of your eye. |

Stage's main readout follows attention: it moves to **Agents** while one is waiting on
you, and back to the tab you chose once none is. **Settings → Widgets** turns that off.
It also drops a tab whose source has nothing to report rather than leaving it blank.

## One layout, three shapes

A small display is not always 16:10, so every layout is arranged three ways, and Kehai
shows the one that fits its window:

| Shape | Window | Grid |
| --- | --- | --- |
| Landscape | square to 2.4 : 1, like a 1280 × 800 panel | 12 × 8 |
| Bar | wider than 2.4 : 1, like a 1920 × 480 bar | 16 × 4 |
| Portrait | taller than wide, like a tablet on its end | 8 × 12 |

The grids keep cells close to square, so a widget means about the same size on every
display. A remote panel on a tablet turns with the tablet.

## Your own layouts

**Settings → Layout** lists the presets and the layouts of your own. Presets never
change, and one nobody has edited follows each release. The first change to a preset
saves a copy under **Yours** instead, so picking a layout never throws another away.
Selecting a card only selects it; **Use** is what changes the screen.

**Export** and **Import** write and read a layout as JSON, for committing to a
repository or sharing. That is the only time you need to see the JSON.

## Arranging

**Settings → Widgets** turns each widget on or off in the arrangement on screen; one
turned on goes in the first space it fits. **Arrange** opens a grid editor with one
tab per shape:

- drag a tile to move it, and drag its corner to resize it;
- drop a tile onto another and the two swap, so a full grid can still be rearranged;
- remove a tile you no longer want;
- change the columns and rows, and every tile keeps its proportion of the new grid.

A shape other than the window's is drawn at its own proportions, so a bar display can
be laid out from a desk monitor. The handles are sized for a finger.

## Themes

Themes live in **Settings → Appearance**, apart from layouts, so changing layout never
changes colours. Three ship — **Amber**, **Phosphor** and **Ice** — and each is
[thirteen custom properties](design.md#themes-are-thirteen-custom-properties).

The reasoning behind the presets, the shapes and the arranger is in the
[design notes](design.md).
