## What this changes

<!-- One or two sentences. If it closes an issue, say "Closes #123". -->

## Why

<!-- What was wrong, or what this makes possible. Skip if the what covers it. -->

## Checks

- [ ] `bun run typecheck`
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] `bun run build`
- [ ] A change people will notice has a line under `## [Unreleased]` in `CHANGELOG.md`

## If this touches a poller

- [ ] Payload struct and `src/core/payloads.ts` interface both updated
- [ ] Topic added to `ENGINE_TOPICS` in `src/core/tauriSource.ts`
- [ ] Mock source publishes the topic, so the widget still has data in a browser
- [ ] `#[cfg(not(windows))]` stub reports unavailable rather than pretending

## If this touches the UI

- [ ] Checked at the smallest size the widget declares in its `<id>.widget.json`
- [ ] Checked in all three themes
- [ ] A topic with no data yet renders `--` or `Awaiting`, never `0`

## Notes for the reviewer

<!-- Anything deliberately left out, or a decision worth a second opinion. -->
