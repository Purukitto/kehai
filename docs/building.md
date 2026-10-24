# Building from source

[Documentation](README.md) › Building from source

Building takes about five minutes, if you would rather not trust a stranger's exe.

## You need

- [Bun](https://bun.sh)
- A [Rust](https://rustup.rs) toolchain, 1.85 or newer, and on Windows the MSVC build
  tools that `rustup` sets up
- Tauri's [platform prerequisites](https://tauri.app/start/prerequisites/)

## The renderer alone

```bash
bun install
```

```bash
bun run dev
```

That serves the renderer on <http://localhost:5273> with a mock source driving every
widget — the header reads `MOCK`. All widget and layout work can be done there, in a
browser, with no Rust in the loop.

## The desktop app

```bash
bun run tauri:build
```

The result is `src-tauri/target/release/kehai.exe` with the frontend embedded, plus
installers under `src-tauri/target/release/bundle/`. Under Tauri the Rust engine takes
over the topics it can source and the header reads `ENGINE` with a green dot, so which
source is live is visible rather than assumed.

### Debug builds behave differently on purpose

`main.rs` gates `windows_subsystem = "windows"` on `not(debug_assertions)`, so a
**debug build is console-subsystem**: it keeps a terminal, prints every poller's
diagnostics to it, and exits when that terminal is closed. That is the point of it.
Release is GUI-subsystem and silent.

A bare `cargo build` also loads the frontend from the Vite dev server instead of the
embedded bundle — convenient while iterating, useless once that server stops. It also
carries no panel to serve, so the [remote panel](remote-panel.md) needs a release
build. Anything about how Kehai behaves as an installed, autostarted app has to be
tested against a release build too.

## Scripts

| Command | Does |
| --- | --- |
| `bun run dev` | Vite on :5273 (`strictPort`, so it fails rather than moving) |
| `bun run build` | Typecheck and build the renderer into `dist/` |
| `bun run typecheck` | Typecheck only |
| `bun run tauri:dev` | Desktop shell against the dev server |
| `bun run tauri:build` | Release build and installers |
| `bun run release <patch\|minor\|major\|x.y.z>` | Bump the version, roll the changelog, commit and tag — see [Releasing](../CONTRIBUTING.md#releasing) |

Before a pull request, see [CONTRIBUTING.md](../CONTRIBUTING.md) for the checks CI
runs and the house style.
