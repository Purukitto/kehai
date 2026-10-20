# Contributing

Thanks for looking. Kehai is small and opinionated; the fastest way to get a change
merged is to match what is already there.

## Getting set up

You need [Bun](https://bun.sh), a [Rust](https://rustup.rs) toolchain (1.85 or newer)
and Tauri's [platform prerequisites](https://tauri.app/start/prerequisites/).

```bash
bun install
```

```bash
bun run dev
```

The dev server runs the renderer with a mock source driving every topic, so **widget,
layout and settings work needs no Rust at all** — the header reads `MOCK` and every
widget has data. Only work on a poller or the IPC bridge needs the desktop shell:

```bash
bun run tauri:dev
```

## Before you open a pull request

There is no test suite. These four commands are what CI runs, and they are the whole
gate:

```bash
bun run typecheck
```

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

```bash
bun run build
```

`tsc` runs with `noUnusedLocals`, `noUnusedParameters` and `noFallthroughCasesInSwitch`,
so it catches more than you might expect. Clippy is enforced at `-D warnings`.

Keep pull requests to one thing. If a change touches both a poller and a widget, that
is fine — that is one thing — but a refactor bundled with a feature is two.

## How the pieces fit

Read the [architecture section of the README](README.md#architecture) first. The short
version: sources are polled in Rust, normalised into one envelope shape, published to
topics on a bus, and consumed by widgets that subscribe to topics. Nothing else couples.

### Adding a widget

1. Write `src/widgets/YourWidget.tsx`. Export the component and a `WidgetSpec` naming
   its minimum size in grid cells and the topics it reads.
2. Add it to the map in `src/widgets/registry.ts`. That is the only place a widget is
   reachable from, so nothing in the grid changes.
3. Reference it by key from a layout in `src/layouts/`, or add it from
   **Settings → Widgets** at runtime.

Use the shared chrome in `src/widgets/chrome.tsx` (`Pane`, `Meter`, `Awaiting`) rather
than rolling your own. `Pane` must keep `flex: 1` or the grid cell shows through behind
it.

Responsiveness is **per tile, not per viewport** — the same widget can be three columns
wide in one preset and twelve in another on the same display. Branch on `useBreakpoint`,
which reads the measured grid cell and has a dead zone so a tile sitting on a threshold
cannot oscillate. Never measure the widget's own root: it feeds back into itself and
flickers.

### Adding a poller

1. Write `src-tauri/src/pollers/your_source.rs` with a `spawn(app: AppHandle)` that
   owns its own thread, and register it in `pollers::spawn_all`. One thread each is
   deliberate — a stalled source can then only stall itself.
2. Define the payload struct with `#[serde(rename_all = "camelCase")]`, and add a
   comment naming the TypeScript interface it mirrors.
3. **Mirror it by hand** in `src/core/payloads.ts`. Nothing generates or checks this,
   so changing one side means changing the other.
4. **Add the topic to `ENGINE_TOPICS`** in `src/core/tauriSource.ts`, or the mock will
   keep publishing over your real data.
5. Publish something to the same topic from `src/core/mockSource.ts` so the widget
   still has data in a browser.

Platform-specific code goes in a `#[cfg(windows)] mod platform` with a
`#[cfg(not(windows))]` stub that returns an explicit "unavailable" reason. A widget
must be able to say it has no source; it must never pretend.

New window or plugin APIs need an entry in `src-tauri/capabilities/default.json`, and
anything loading an external resource needs the CSP in `src-tauri/tauri.conf.json`
widened.

## House style

- **`undefined` is a real state.** A topic with no event yet renders `--` or
  `Awaiting`, never `0`. A `null` sensor reading stays null rather than being coerced.
- **Inline styles plus CSS custom properties.** A theme is thirteen properties under a
  `.t-<id>` class in `src/styles/tokens.css`. Only a handful of `cc-*` utility classes
  exist in `base.css`; everything else is inline. No CSS-in-JS library, no Tailwind.
- **Comments explain why, not what.** If a line needs a comment to say what it does,
  rename something instead. If a decision looks arbitrary, say why it is not.
- Tiles carry a `boxShadow` hairline, not borders — the separation has to survive a
  sparse arrangement where there is no neighbour to draw against.

## Commits

Conventional-ish prefixes, lowercase, imperative: `feat:`, `fix:`, `docs:`, `refactor:`,
`chore:`. The subject line says what changed; the body says why, if that is not obvious.
Neither is a changelog entry — that gets written at release.

## Reporting things

Bugs and feature requests go through the
[issue templates](https://github.com/Purukitto/kehai/issues/new/choose). For anything
security-sensitive, read [SECURITY.md](SECURITY.md) first and do not open a public
issue.
