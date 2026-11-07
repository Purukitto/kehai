# Changelog

What changed in each release, written for people using Kehai. Each version's section
is also its release notes, and what Kehai shows before it updates itself.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before
1.0.0 a minor version may change the layout format; when one does, it says so here.

## [Unreleased]

## [0.16.0] - 2026-11-07

### Added

- **A dock of your own.** The Dock tile holds buttons you choose, in groups, and each
  one shows what Kehai already knows: an app's notifications, an agent waiting in it,
  that it is playing or has the microphone, or a game's score during a match. A tap
  brings an app forward or starts it, starts a Steam game through Steam, or opens a
  link, a file or a folder you picked. **Scenes** do several of these in one tap, and can
  also switch the layout, start the focus timer, set the sound, the microphone, the
  music or the display's brightness. Hold the tile to add and arrange buttons. Windows
  only for now.
- **Mute the microphone from the panel.** The dock's **Mic** button mutes this PC's
  microphone for every app, shows in the danger colour while it is muted, and says
  which app is listening.
- **Tap a notification to open its app.** Its window comes to the front on the
  display it is on, or, with no window, the app starts from its Start menu entry,
  which also brings back an app waiting in the tray. Once it is up, the notification
  is cleared, as clicking it in Windows does. Windows doesn't tell other programs which
  chat or link a notification leads to, so this opens the app rather than that message.
  A notification that comes from no app, such as Windows' own notices, opens the
  Windows notification list instead. Rows that open have a › at the end. Windows only
  for now; on a tablet a tap says to open it on the PC.

### Changed

- The Panel preset has a Dock where the Focus timer was; the dock's Focus button starts
  and pauses the timer and shows its countdown. Your own layouts are unchanged.
- While a game or a video fills its display, a tap on a notification, an agent session
  or a dock button asks for a second tap before it brings a window forward.
- The Notifications tile shows only rows that fit whole, instead of cutting the last
  one through.

## [0.15.0] - 2026-11-06

### Added

- **Night turns the display itself down.** On a display that lets programs set its
  brightness (most do, over DDC/CI), night and the quiet panel lower its backlight
  instead of only darkening what Kehai draws, so text keeps its contrast and black is
  really dark. **Settings → Appearance → This display** sets the brightness they come
  back to, and the display's own buttons set it too. Kehai changes the display only
  when something changes, never in steps, and gives it your level back when it quits
  or is hidden in the tray. Windows only for now.

### Changed

- How dim the panel goes at night is a share of your brightness: A little and Half
  turn the backlight down, and A lot takes it as low as it goes and darkens what Kehai
  draws as well. On a display that doesn't answer, night darkens what Kehai draws, as
  before.
- The quiet Dimmed panel is turned down by the display's backlight where it can be,
  rather than drawn at half brightness on top of it.

## [0.14.0] - 2026-11-06

### Added

- **The graphics card, beside the processor.** The main readout's Machine tab shows
  the card's load, temperature and memory next to the processor's, with the last
  minute of its load. The Machine tile has a Graphics section, and the status strip
  can show **GPU** and **GPU temp**. Temperature, fan and power come from the card's
  driver where it reports them, and the temperature turns red at the driver's own
  warning point. Windows only for now.
- The status strip's readings and the main readout's tabs are chosen in their options:
  hold the tile, or right-click it. On a preset, a change saves a copy under Yours.
- On a PC with more than one graphics card, the same options choose which card the
  readings follow. Until then it is the one with the most memory of its own.

### Changed

- The presets' status strips show the graphics card. Where a strip has no room for
  more readings, GPU takes the place of Memory, which the Machine tab shows.
- A status strip in a single line shrinks its values until every reading fits, and
  leaves out whole any that still don't, instead of cutting the last one off.

## [0.13.0] - 2026-11-06

### Added

- **Tap an agent session to go to it.** Its window comes to the front on the display
  it is on: the agent's desktop app, VS Code or the terminal it runs in. The session
  waiting on you says **Go to**, and the row says for a moment what the tap did. The
  desktop app comes forward as a whole, and you pick the session in its own list.
  Ambient's agents line goes to the session it names. Windows only for now; on a
  tablet a tap says to open it on the PC.
- While agents wait on you, the tray's menu starts with up to three **Go to** items,
  longest waiting first, with how long each has waited.

### Changed

- A session you have closed leaves the agents list, and no longer counts as waiting on
  you, in the tile, the tray's icon and the main readout. Kehai reads which sessions
  are open from the small file the agent keeps for each one; [Privacy](docs/privacy.md)
  lists the four things it reads there.

## [0.12.2] - 2026-11-05

### Fixed

- A widget's options sheet is as tall as what it holds. On a narrow sheet a setting's
  switch goes under its description, a group's name stays on one line, and Arrange
  this layout moves under the note beside it. A tile too wide to leave room beside the
  sheet is no longer outlined around the sheet's edges.
- Settings on a narrow window, such as a tablet on its end, shows its sections as a
  column of icons, so each page keeps the width. Rows there wrap the same way as in the
  sheets, and the token budget's choices read 1M, 5M, 10M and 20M.
- Token usage's figure stays inside a narrow tile, and its 5-hour block label stays on
  one line.
- A short focus timer tile keeps its buttons inside the tile and names the sprint in
  its title.
- A narrow one-row Now playing tile puts the title above the buttons where it is tall
  enough, and drops the previous-track button where it is not, so the title is never
  cut to a letter.
- The status tile lays two readings out side by side in a wide tile, each label over
  its value.
- In the display map, a small display's note and name stay inside it.
- The small notes on the panel while you play or are away are readable.
- The night dimming choices and the problems list under About are in sentence case,
  as the rest of Kehai is.

## [0.12.1] - 2026-11-05

### Fixed

- On a display bigger than the one it is laid out for, such as a main monitor, the
  panel now scales up to fit, instead of leaving small text in large empty tiles. It
  follows the window's size on any display. A remote panel's browser keeps its own
  zoom.
- A large clock on a wide tile no longer stacks the hours over the minutes and cuts
  off the date, and it grows with its tile.
- One-line tiles grow their text with their tile, and the main readout shows only as
  many agent rows as fit.
- The vitals tile no longer runs off the bottom on a panel scaled to 125%: it sizes
  its values to the room each row has, and goes to two columns when that gives them
  more. The token tile drops its subtitle when it is too short to hold it.

## [0.12.0] - 2026-11-04

### Changed

- **The panel goes still while you play.** In a CS2 round it turns dark and quiet,
  shows the score dimly and how many notifications and agents are waiting, and keeps
  them for when you are out of the round: when you die, at half time, after the
  match. A touch opens it sooner. The CS2 tile's options can leave the panel as it is
  instead, or switch layouts for the match as before.
- **The CS2 tile no longer copies the HUD.** Health, armour, money and the weapon are
  gone, since the game already shows them where you are looking. In the gaps it shows
  the score, who won each round and your match; between matches, **Tonight**: each
  match, how it ended and how you did, and the time played. Set up now asks CS2 for
  less; a copy set up with 0.11 can **Remove** and **Set up** again to write the
  smaller file.
- **A new look: obsidian glass.** Each tile is a rounded glass card over a charcoal page
  with a faint glow; JetBrains Mono at a light weight, with the time, the main readout
  and the score large and thin; plain sentences instead of tracked capitals; pill
  buttons; a champagne accent, which lights the main readout while an agent waits on
  you. The default theme is now called Obsidian, and the
  dimmest text stays readable on every tile. The date reads in words, and the
  sparklines are curves.

### Removed

- The Now playing equaliser.
- The CS2 tile's lighting, the flash and smoke washes, and showing it full screen, so
  the panel stays still in the middle of a round.
- `lighting` in a game widget's file, which is now ignored. `match.still` says when
  the player is in play.

## [0.11.0] - 2026-11-01

### Added

- A **Counter-Strike 2** widget: your health, armour, money, the weapon in your hands
  and its ammo, the score and round, who won each round, BOMB PLANTED, and your kills,
  assists, deaths and MVPs, while you play. Dead and watching a teammate, it shows
  theirs and says so. Between matches it keeps the last match's result. It fits itself
  to any tile, from one row to the whole panel, and tablets show it too.
- **Set up** for CS2, on its tile or under **Settings → Widgets**, finds the game
  through Steam and writes one file into its settings folder, the route Valve
  documents for overlays and peripherals. It shows you where first, what it asks the
  game for and what it never does: other players, where anyone is, or the bomb's
  timer. **Remove** takes the file out again, and other programs' files are left alone.
- The CS2 tile wears CS2's own colours, as RGB lighting does: each side's colour,
  health from green to red, money green. Its edge lights up in your side's colour at
  buy time, red while the bomb is down or your health is low, and orange while you
  burn, and a flash or smoke washes over it. Its options can use the theme's colours
  instead, or turn the lighting off.
- Tap the CS2 tile to show it full screen, and tap again to go back.
- In the CS2 tile's options, choose which readings it shows, and what happens when a
  match goes live: nothing, a layout of your choice, or the tile full screen. Nothing
  unless you choose.
- A widgets folder for game widgets you write yourself, as one `.widget.json` file
  each: data, never code. **Settings → Widgets** lists each file, and why one did not
  load. `docs/widgets.md` says how to write one.

### Changed

- Kehai now also listens on `127.0.0.1`, for a game you have set up and only while one
  is. Nothing on your network can reach it, and a game's post needs the key in its file.

## [0.10.0] - 2026-11-01

### Added

- Kehai lives in the tray. Click its icon to show or hide the panel. Right-click it to
  move the panel to another display, open Settings, report a bug, check for updates or
  quit. The icon fills in while an agent waits on you.
- **Settings → Window → When Kehai starts** can keep the panel hidden, for a desk
  where a tablet is the panel. Kehai still reads this PC and serves the tablet.
- A log. Kehai writes down what it started, what failed and why, in a file on this PC,
  and never what it read. **Settings → About** lists the last problems, opens the
  log's folder, copies its last lines, and can log more detail until Kehai restarts.
- **Report a bug**, in Settings → About and in the tray's menu, opens a new issue on
  GitHub in your browser, with the version, Windows, your displays and the last
  problems filled in. Nothing is sent until you press Create there.
- When Kehai closed unexpectedly, the next start says so under the header, with a way
  to report it.

### Changed

- Kehai no longer has a taskbar button or a place in Alt+Tab, on every copy, including
  ones already installed. **Settings → Window → Taskbar button** brings both back.
- Closing the panel hides it in the tray rather than quitting, and says so the first
  time. Minimise is gone: with no taskbar button it had nowhere to go. Quit is in the
  tray's menu.
- Starting Kehai while it is already running shows the panel, rather than starting a
  second copy.

## [0.9.2] - 2026-11-01

### Fixed

- The tap that wakes a quiet panel no longer also presses whatever was under it.
- A narrow Now playing tile shows the volume as −, + and the level, instead of ten
  blocks too thin to hit.
- The window buttons in the header are now big enough to hit with a finger.
- With **Fill the display** off, Kehai moved to a display no bigger than 1280 × 800,
  such as a small panel or a bar, takes all of it instead of most of it.

## [0.9.1] - 2026-11-01

### Fixed

- Checking for updates no longer fails on networks where one of GitHub's download
  addresses does not answer. Kehai moves on to the next one within a few seconds.

## [0.9.0] - 2026-10-31

### Added

- Hold any tile, or right-click it, and that widget's options open beside it. The
  **Options** button under **Settings → Widgets** opens the same ones.
- Choose, app by app, whether notifications show, show only the app's name and how
  many, or hide. It is in the Notifications options and applies here and on every
  remote panel. A hidden app's notifications never leave this computer.
- While a focus block runs, the Notifications tile shows only how many are waiting and
  when the break comes. Its options can turn that off.

### Changed

- Remote panels now see each app's name and how many, not what its notifications say,
  including tablets paired before this version. **Same as here** in the Notifications
  options brings the text back, and **Nothing** shows them none.
- **Clear all** clears only what the tile shows. With an app's chip on it reads
  **Clear** and that app's name, and clears only that app. A hidden app's notifications
  stay in the Windows list.
- **Settings → Widgets** lists every widget Kehai comes with, what each one reads, and
  whether that is reporting.
- Turning widgets on and off in the layout on screen moved to **Settings → Layout → On
  this layout**, with an **Arrange** button for that layout beside it. Album art, the
  equaliser and the main readout following attention moved into those widgets' options.

## [0.8.0] - 2026-10-24

### Added

- Pair a tablet or phone by scanning a code. **Settings → Remote → Show code** shows it
  for two minutes; it covers itself again when the time is up or Settings closes, since
  it holds the key. The link beside it does the same in a browser.
- While it serves a remote panel, Kehai announces itself on your local network (its
  name and port, never the key), so a paired tablet can find it at a new address.
- Seek in **Now playing**: tap or drag the progress bar, or the line along the bottom of
  a one-row tile. The time shows as you drag, and the player moves when you let go.
- This computer's volume in **Now playing**, on Windows: the speaker after the skip
  buttons opens mute, −, + and ten steps to tap, and goes back to the buttons after a
  few seconds. A wide tile keeps it beside the buttons. With **Allow control** on, a
  remote panel can seek and change the volume too.
- **Settings → About → Support Kehai**, for anyone who wants to buy its author a coffee.

### Changed

- Settings → Remote lists this computer's real network adapters first and marks virtual
  ones, such as WSL's, which a tablet can't reach. Port now sits beside Status.
- A remote panel whose computer stops answering dims every tile and says since when it
  last heard from it, instead of showing old readings as if they were live. It notices
  within a minute even when the computer goes to sleep without saying goodbye.

## [0.7.0] - 2026-10-24

### Added

- A short setup the first time Kehai opens. Choose the display it is for and it moves
  there straight away; see what it can read on this machine; pick a layout and colours
  drawn for that display; and decide whether it starts with Windows. **Settings →
  About → Run setup again** brings it back. A copy updated from 0.6 skips it.
- **Settings → Window** shows your displays as Windows arranges them. Tap one and Kehai
  moves there, filling it or in a window.
- When the display Kehai is for is not connected, it opens in a window on the main
  display, says so in the header, and moves back by itself once the display returns.
- The panel turns down at night, from 22:00 to 07:00 to start with. **Settings →
  Appearance** sets the hours and how dim: a little, half or a lot.
- After ten minutes with nobody at the computer, the panel goes quiet: the time, dim,
  and only what is running or waiting on you, with notifications as a count and never
  their text. A touch or a nudge of the mouse brings it back, and the first tap only
  wakes it. **Settings → Appearance** sets the delay, or keeps the whole panel showing,
  dimmed, or keeps it dark until an agent waits. Not on Linux yet.
- While Windows is locked, Kehai stops drawing. Its lock screen covers every display
  anyway.
- Setup's last step turns night and away on together. A copy that already had
  settings keeps both off until you turn them on.

### Changed

- Notifications are read only once you press **Allow**, in setup, on the tile or under
  **Settings → Sources**, so Windows no longer asks the moment Kehai first opens. A copy
  that already reads them carries on.
- Dragging Kehai onto another display, or pressing F11, is remembered: it reopens there,
  the same way.
- **Reset everything** also runs setup again.

## [0.6.0] - 2026-10-22

### Added

- The layout's name in the header is a button: tap it for a list of every layout, or
  **Manage layouts** for Settings. On a touchscreen, swipe sideways along the header
  for the next or previous layout.

### Changed

- Nothing you can press is smaller than 28px, so the panel works by touch as well as
  with a mouse. The tile arranger's buttons and resize corners are bigger still.
- On a touchscreen, a notification's dismiss button stays in view instead of waiting
  for a hover that never comes, and the edge that brings back a hidden header is
  taller.

### Fixed

- Tapping a tile in the arranger to select it no longer saves a copy of a preset.

## [0.5.0] - 2026-10-22

### Added

- The main readout moves to Agents while an agent waits on you, and goes back to your
  tab once none does. Picking a tab yourself keeps it until another agent starts
  waiting. **Settings → Widgets** turns this off.
- The Agents tab shows how many are waiting, whichever tab is open.
- In a tall tile, as on a portrait display, the clock puts the hours over the minutes
  when that makes the digits much bigger.

### Changed

- Tiles are named for what they show, such as Token usage, Focus timer and
  Notifications, and no longer print internal topic names.
- Every bar under the main readout says what it measures. Without a budget, the
  Tokens bar shows how much of the 5-hour block has gone, rather than a burn-rate
  scale that meant nothing.
- "No budget set" is a quiet **Set a budget** button that opens the setting, which now
  lives under **Settings → Sources** beside agent tokens.
- The main readout's tabs are Tokens, Agents, Machine and Focus, and it remembers the
  one you picked across restarts.
- The Machine tab draws one bar per thread, and says which figure is processor and
  which is memory.
- Ambient shows waiting agents as a single large line.
- **Settings → Widgets** lists widgets by name, with a line on what each shows.

## [0.4.0] - 2026-10-21

### Added

- Every layout has an arrangement for a landscape panel, a bar display and a portrait
  screen, and Kehai shows the one that fits its window. Stage, Panel and Ambient are
  arranged all three ways, and a remote panel on a tablet turns with the tablet.
- Layouts of your own, as many as you like. **Settings → Layout** lists them beside the
  presets, with Use, Arrange, Rename, Export, Import and Delete. Choosing a layout no
  longer throws another away.
- The tile arranger has a tab for each shape, and sets the grid's columns, rows and gap.

### Changed

- Presets cannot be changed. The first change to one saves a copy under **Yours**,
  and a preset you have not changed always matches the latest release.
- The theme belongs to Kehai rather than to a layout, so changing layout keeps your
  colours.
- Clicking a layout selects it; **Use** puts it on screen.
- An arrangement you made in 0.3 is under **Yours** as "Custom", unchanged.
- Layouts exported from 0.3 still import. Layouts exported now do not import into 0.3
  or earlier.

### Removed

- Grid size and tile gap are no longer under Settings → Layout. They are in the
  arranger, per shape.

## [0.3.0] - 2026-10-21

### Added

- An **Agents** tile shows which coding-agent sessions are working and which are
  waiting on you, and for how long. Stage has an Agents tab, and the vitals strip can
  count the ones waiting. It reads the same local transcripts as token usage, never
  what you or the agent wrote.

### Changed

- Panel has an Agents tile beside the notifications, and Stage counts waiting agents
  in its corner. A preset you have not rearranged picks up changes like these by
  itself, and keeps your theme.

### Fixed

- Changing the grid's columns or rows could make Kehai forget every setting the next
  time it started. Tiles now keep their proportions when the grid changes, and a
  layout that cannot be read costs only the layout.
- Picking a preset no longer throws away your own arrangement or changes your theme.
  **Custom** brings the arrangement back.
- A widget turned on in **Settings → Widgets** goes into free space, or takes a strip
  from the largest tile, instead of landing on top of other tiles.
- **Remove** in the tile arranger removes the selected tile, not every tile of that kind.
- **Reset everything** asks for a second press before it resets.
- The clock shrinks to fit a narrow tile instead of being cut off.

## [0.2.0] - 2026-10-21

The first published release. 0.1.0 never left draft, so everything it lists is in
here too; what follows is what changed since.

### Added

- The focus timer has buttons: start, pause, skip and reset it from its tile or from
  Stage's sprint tab. **Settings → Sources** sets how long focus blocks and breaks
  are, and today's focused time survives a restart.
- Linux: what is playing, with transport controls, from any MPRIS player, and the
  notification feed. Notifications show from the moment Kehai starts; Linux keeps no
  history to read back.
- A remote panel: **Settings → Remote** serves the dashboard to a browser on another
  machine on your network, paired by a link. Remote panels only look, unless you allow
  them to press the media, notification and timer buttons. The same port has a small
  API for scripts. It is off until you turn it on.
- F11 goes fullscreen on a remote panel too.

### Changed

- Agent token usage counts the current 5-hour block instead of the last five hours,
  and shows when the block resets. The reset time is an estimate: the provider does
  not publish how its window works.

### Fixed

- The focus timer showed a made-up countdown in the desktop app. It now runs for real,
  and waits for you to start it.
- Stage's main tile reaches the bottom of its space instead of stopping short.
- The font is built in. Kehai no longer fetches it from Google Fonts, and looks right
  on a machine that has never been online.
- Agent token usage counted most replies two or three times, because the transcript
  repeats a reply's usage on every line of it. Each reply now counts once.
- Agent token usage includes sub-agents, whose transcripts sit in folders the count
  never looked in.

### Known issues

- CPU temperature is usually missing on Windows, where reading it needs a kernel driver.
- Media and notifications are not available on macOS.
- The remote panel is plain HTTP. Use it on a network you trust.
- The installers are unsigned, so SmartScreen warns the first time you run one.

## [0.1.0] - 2026-10-21

Cut but never published. Everything here first shipped in 0.2.0.

### Added

- A dashboard for a small secondary display: CPU, memory, network and disks, what is
  playing, your notifications, agent token usage, a clock and a focus timer.
- Three layouts — Stage, Panel and Ambient — and three themes — Amber, Phosphor and Ice.
- Drag tiles to move and resize them, and share an arrangement as JSON.
- Reopens on the display you left it on, can start with Windows, and goes fullscreen
  with F11.
- Updates itself. **Settings → About** checks for a new version and installs it:
  Kehai closes, updates and opens again. **Check automatically** looks once a day, and
  is off unless you turn it on.

### Known issues

- Media and notifications work on Windows only. Linux and macOS show telemetry.
- CPU temperature is usually missing on Windows, where reading it needs a kernel driver.
- The font loads from Google Fonts, so the first launch needs a connection.
- The installers are unsigned, so SmartScreen warns the first time you run one.

[Unreleased]: https://github.com/Purukitto/kehai/compare/v0.16.0...HEAD
[0.16.0]: https://github.com/Purukitto/kehai/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/Purukitto/kehai/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/Purukitto/kehai/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/Purukitto/kehai/compare/v0.12.2...v0.13.0
[0.12.2]: https://github.com/Purukitto/kehai/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/Purukitto/kehai/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/Purukitto/kehai/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/Purukitto/kehai/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/Purukitto/kehai/compare/v0.9.2...v0.10.0
[0.9.2]: https://github.com/Purukitto/kehai/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/Purukitto/kehai/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/Purukitto/kehai/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/Purukitto/kehai/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/Purukitto/kehai/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Purukitto/kehai/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Purukitto/kehai/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Purukitto/kehai/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Purukitto/kehai/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Purukitto/kehai/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Purukitto/kehai/releases/tag/v0.1.0
