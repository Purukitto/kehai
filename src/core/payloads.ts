export interface CpuPayload {
  pct: number;
  threads: number[];
  clockGhz: number;
  /** Null where the platform exposes no usable sensor. Never coerce to zero. */
  tempC: number | null;
}

export interface MemPayload {
  usedGib: number;
  totalGib: number;
  swapUsedGib: number;
  swapTotalGib: number;
}

export interface NetInterface {
  name: string;
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

export interface NetPayload {
  rxBytesPerSec: number;
  txBytesPerSec: number;
  active: NetInterface[];
}

export interface Volume {
  name: string;
  mount: string;
  usedBytes: number;
  totalBytes: number;
}

export interface DiskPayload {
  volumes: Volume[];
}

export interface ModelUsage {
  model: string;
  tokens: number;
}

export interface QuotaPayload {
  /** False when there is nothing to read — not the same as a quiet window. */
  available: boolean;
  reason: string | null;
  provider: string;
  /** Counted inside the current block, once per reply. All zero when there is none. */
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  requests: number;
  /** Block length in hours. */
  windowHours: number;
  /**
   * When the current block began, or null when the last one has ended and the
   * next request starts another. Reconstructed from transcripts: the provider
   * does not publish its window, so treat the reset time as an estimate.
   */
  blockStartMs: number | null;
  /** Until the current block ends. Zero when there is none. */
  resetsInMs: number;
  /** Tokens per minute over the last quarter of the block length. */
  burnPerMin: number;
  models: ModelUsage[];
  /** The last `windowHours`, rolling, whatever block each request fell in. */
  history: number[];
  /**
   * The budget the user configured, not a limit read from a provider — no local
   * source exposes the real plan limit. Null means none set, and the widget
   * shows counts without a percentage rather than inventing one.
   */
  budgetTokens: number | null;
}

/** Renderer → engine on `quota:command`. Mirrors `Command` in `quota.rs`. */
export interface QuotaCommand {
  action: 'set_root';
  /** Folder holding one subfolder of `.jsonl` transcripts per project. Null means the default. */
  path: string | null;
}

export interface MediaPayload {
  playing: boolean;
  title: string;
  artist: string;
  elapsedSec: number;
  durationSec: number;
  hasArt: boolean;
  player: string;
}

/** Engine → renderer on `flow:pomodoro`. Mirrors `SprintPayload` in `flow.rs`. */
export interface SprintPayload {
  /** Idle is a block waiting to be started; it shows its full length. */
  state: 'idle' | 'running' | 'paused';
  mode: 'focus' | 'break';
  remainingSec: number;
  /**
   * The block on screen, which is not always the configured length: a changed
   * setting applies from the next block, not mid-countdown.
   */
  lengthSec: number;
  /** Which focus block this is, or which one the break follows. 1-based. */
  index: number;
  total: number;
  /** Kept across restarts, and reset at local midnight. */
  focusedTodaySec: number;
}

/**
 * Renderer → engine on `flow:command`. Mirrors `Command` in `flow.rs`. Start
 * and pause are separate rather than one toggle, so a command that arrives
 * twice cannot undo itself.
 */
export type FlowCommand =
  | { action: 'start' }
  | { action: 'pause' }
  | { action: 'skip' }
  | { action: 'reset' }
  | { action: 'configure'; focusMin: number; breakMin: number; sprints: number };

export interface ClockPayload {
  iso: string;
}

export interface NotifyItem {
  id: number;
  source: string;
  title: string;
  body: string;
  atMs: number;
}

export interface NotifyPayload {
  /** False when the platform refused access — not the same as an empty tray. */
  available: boolean;
  reason: string | null;
  items: NotifyItem[];
}

export interface ArtPayload {
  /** Data URL of the current cover, or null when the player exposes none. */
  dataUrl: string | null;
}

/** Engine → renderer on `app:update`. Mirrors `UpdatePayload` in `update.rs`. */
export interface UpdatePayload {
  /** The running version, read from the binary. */
  current: string;
  state: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'failed';
  /** The newer version on offer, or null when none is known. */
  latest: string | null;
  /** That release's changelog section, as written in CHANGELOG.md. */
  notes: string | null;
  /**
   * False for the portable build and dev builds: there is no installer to hand
   * over to, so the offer is a link to the release page instead.
   */
  installable: boolean;
  /** Why `installable` is false. */
  reason: string | null;
  /** 0–1 while downloading. Null when the server sent no length. */
  progress: number | null;
  /** When a check last succeeded. */
  checkedAtMs: number | null;
  /** The last failure, cleared by the next check that succeeds. */
  error: string | null;
  /** Whether the engine checks by itself — the setting, echoed back. */
  auto: boolean;
}

/**
 * Renderer → engine on `update:command`. Mirrors `Command` in `update.rs`.
 * Carries no URL: where updates come from is compiled into the engine.
 */
export type UpdateCommand =
  | { action: 'check' }
  | { action: 'install' }
  | { action: 'set_auto'; on: boolean }
  | { action: 'open_release' };
