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

These five commands are what CI runs, and they are the whole gate:

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
cargo test --manifest-path src-tauri/Cargo.toml
```

```bash
bun run build
```

`tsc` runs with `noUnusedLocals`, `noUnusedParameters` and `noFallthroughCasesInSwitch`,
so it catches more than you might expect. Clippy is enforced at `-D warnings`.

The tests are few, and live beside the code they check: the engine's parsing of
transcripts, where a format nobody documents has to be read right. A poller that
parses something similar deserves the same. The front end has none.

Keep pull requests to one thing. If a change touches both a poller and a widget, that
is fine — that is one thing — but a refactor bundled with a feature is two.

## How the pieces fit

Read [Architecture](docs/architecture.md) first. The short
version: sources are polled in Rust, normalised into one envelope shape, published to
topics on a bus, and consumed by widgets that subscribe to topics. Nothing else couples.

### Adding a widget

1. Write `src/widgets/YourWidget.tsx` and export the component. Its `Pane` label names
   what it shows, never the topic.
2. Describe it in `src/widgets/<id>.widget.json`: its `id`, the `name` and one-line
   `about` that Settings and the arranger show, its `min` size in grid cells, and the
   `sources` it reads, by their ids in `src/core/sources.ts`. `src/core/widget.ts`
   checks the file when Kehai starts. A new kind of data needs a new source there too.
3. Import both in `src/widgets/registry.ts`. That is the only place a widget is
   reachable from, so nothing in the grid changes.
4. Reference it by id from a layout in `src/layouts/`, or turn it on from
   **Settings → Layout → On this layout** at runtime.

A widget that reads a game needs no component: its file brings a `source` and
`readings` instead of `sources`, and `src/widgets/Game.tsx` draws it. Add the file to
`BUNDLED` in the registry, or drop it in the widgets folder to try it. [Writing a game
widget](docs/widgets.md#writing-a-game-widget) has the format. Read the game's terms
first, and use only a route its publisher documents or plainly allows.

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
Neither is a changelog entry — those are written for a different reader.

## Changelog

A change someone using Kehai would notice gets a line under `## [Unreleased]` in
[CHANGELOG.md](CHANGELOG.md), in the same pull request. That section becomes the
release notes, and it is what Kehai shows beside its Install button, so write it for
them:

- Say what changed for them, not how: "Notifications can be dismissed from the
  widget", not "add `notify:command`".
- One line where one line will do, under `### Added`, `### Changed`, `### Fixed` or
  `### Removed`.
- Leave out refactors, CI, docs and dependency bumps nobody can see.
- If an exported layout stops importing, say so.

## Releasing

1. Read `## [Unreleased]` over. It is about to become the release notes.
2. On an up-to-date `main` with a clean tree:

   ```bash
   bun run release minor
   ```

   `patch`, `minor`, `major` or an exact version; `--dry-run` shows what it would do.
   It sets the version in `package.json`, `tauri.conf.json`, `Cargo.toml` and
   `Cargo.lock`, moves Unreleased under the new version, commits
   `chore: release vX.Y.Z` and tags it.
3. Push the commit and the tag — the script prints the command. The tag starts the
   release workflow, which builds, signs, and drafts a GitHub release with the
   changelog section as its notes.
4. Read the draft over and publish it. Publishing is what installed copies see:
   `latest.json` is served from the latest *published* release, so a draft reaches
   no one. It also rebuilds the product page at purukitto.xyz/kehai, which takes its
   version, download links and live panel from the latest release. That needs a
   `SITE_DEPLOY_HOOK` secret holding the site's Vercel deploy hook; without one the
   **Product page** workflow says so and does nothing.

Besides the versioned files, each release carries `Kehai_x64-setup.exe`, a copy of the
installer whose name never changes, so `releases/latest/download/Kehai_x64-setup.exe`
always fetches the newest. It also carries `kehai-x.y.z-web.tar.gz`, the renderer on
its mock source, which is what the product page frames.

A prerelease (`bun run release 0.3.0-rc.1`) can be cut from any branch. GitHub marks
it as one, installed copies never update to it, and its changelog section is folded
into the real one when the release is cut.

To pull a bad release, turn it back into a draft. `latest` falls back to the release
before it, so nobody else gets it; anyone who already updated stays on it until a fix
ships. The product page's main download link follows `latest` by itself; run the
**Product page** workflow by hand to bring its other links back too.

### The signing key

Installed copies trust one public key, `plugins.updater.pubkey` in
`src-tauri/tauri.conf.json`. The matching private key is in two repository secrets,
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The release
workflow will not build without them, and stops if they do not match the public key.

**If the private key is lost, no installed copy can be updated again** — everyone
would have to reinstall by hand. Keep a copy somewhere other than GitHub.

To make one:

```bash
bunx tauri signer generate -w ~/.tauri/kehai.key
```

The contents of `kehai.key.pub` go in `pubkey`; the contents of `kehai.key` and its
password go in the two secrets.

### Trying an update before it ships

In a browser, `bun run dev` and **Settings → About → Check** walks the mock through
every state the engine reports, install included.

For the real thing, cut two prereleases and publish both. Install the first, then
start it from a terminal with the update feed pointed at the second:

```powershell
$env:KEHAI_UPDATE_ENDPOINT = 'https://github.com/Purukitto/kehai/releases/download/v0.3.0-rc.2/latest.json'
```

Then **Check** and **Install**. The variable only changes where the check looks. What
it finds must still be signed by the release key, for the version it claims, and be
newer than what is running.

## Reporting things

Bugs and feature requests go through the
[issue templates](https://github.com/Purukitto/kehai/issues/new/choose). For anything
security-sensitive, read [SECURITY.md](SECURITY.md) first and do not open a public
issue.
