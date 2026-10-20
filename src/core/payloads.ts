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
