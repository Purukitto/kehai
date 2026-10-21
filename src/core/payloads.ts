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
  /** Tokens counted inside the rolling window. */
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  requests: number;
  /** Window length in hours, and when the oldest counted event falls out. */
  windowHours: number;
  resetsInMs: number;
  /** Tokens per minute over the last quarter of the window. */
  burnPerMin: number;
  models: ModelUsage[];
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

export interface SprintPayload {
  running: boolean;
  mode: 'focus' | 'break';
  remainingSec: number;
  index: number;
  total: number;
  focusedTodaySec: number;
}

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
