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

/**
 * Worked out from how each transcript ends. `tool` is a call that has not
 * returned, which is also all a permission prompt looks like — nothing is
 * written until it is answered — so nothing claims to know it is one.
 */
export type AgentState = 'error' | 'waiting' | 'tool' | 'working';

/** Mirrors `AgentSession` in `agents.rs`. */
export interface AgentSession {
  /** The transcript's name, which is the session's id. */
  id: string;
  /** The folder the agent works in, or the repository a worktree belongs to. */
  project: string;
  worktree: string | null;
  state: AgentState;
  /**
   * When it entered `state`: the prompt that started the turn, the oldest tool
   * call still unanswered, or the line that stopped it.
   */
  sinceMs: number;
  /** Sub-agents it started that are still at work. */
  subagents: number;
}

/** Engine → renderer on `dev:agents`. Mirrors `AgentsPayload` in `agents.rs`. */
export interface AgentsPayload {
  /** False when there is nothing to read — not the same as no sessions. */
  available: boolean;
  reason: string | null;
  /**
   * Sessions written to in the last hour, the ones waiting on you first and
   * longest-waiting first within each state.
   */
  sessions: AgentSession[];
}

export interface MediaPayload {
  playing: boolean;
  title: string;
  artist: string;
  elapsedSec: number;
  durationSec: number;
  hasArt: boolean;
  player: string;
  /** The player takes a new position. Some browser tabs don't. */
  canSeek: boolean;
}

/**
 * Engine → renderer on `media:volume`: this computer's main output, as the
 * volume keys turn it, whatever is playing. Null where Kehai can't reach it.
 * Mirrors `VolumePayload` in `media.rs`.
 */
export interface VolumePayload {
  /** 0 to 100. */
  level: number;
  muted: boolean;
}

/** Renderer → engine on `media:command`. Mirrors `Command` in `media.rs`. */
export type MediaCommand =
  | { action: 'playpause' | 'next' | 'previous' }
  | { action: 'seek'; positionSec: number }
  /** Unmutes too, as the volume keys do. */
  | { action: 'volume'; level: number }
  | { action: 'mute'; muted: boolean };

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
  /**
   * True until Kehai has been told it may read notifications. Nothing is read,
   * and the platform is asked nothing, before that.
   */
  pending: boolean;
  reason: string | null;
  items: NotifyItem[];
}

/**
 * Renderer → engine on `notify:command`. Mirrors `Command` in `notify.rs`.
 * `listen` is the go-ahead to ask for access and start reading; sent again, it
 * asks again after a refusal.
 */
export type NotifyCommand = { action: 'listen' } | { action: 'dismiss'; id: number } | { action: 'clear' };

export interface ArtPayload {
  /** Data URL of the current cover, or null when the player exposes none. */
  dataUrl: string | null;
}

/** One connected display. Mirrors `Display` in `display.rs`. */
export interface DisplayInfo {
  /** Stable across restarts where the platform has a device path for it. */
  id: string;
  /** As the system numbers it, so 2 here is 2 in its own display settings. */
  number: number;
  /** What the monitor calls itself, when it says. */
  name: string | null;
  /** Physical pixels, in the system's arrangement of all the displays. */
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  primary: boolean;
}

/**
 * Engine → local renderer on `app:displays`. Mirrors `DisplaysPayload` in
 * `display.rs`. Never sent to a remote panel, which has no window to place.
 */
export interface DisplaysPayload {
  displays: DisplayInfo[];
  /** The display the window is on now. */
  current: string | null;
  /** The display Kehai is for, which is not `current` while it is missing. */
  chosen: string | null;
  /** Kept from when it was chosen, so a missing display can still be named. */
  chosenName: string | null;
  chosenNumber: number | null;
  /** The chosen display is not connected, so Kehai is in a window on the main one. */
  missing: boolean;
  fill: boolean;
}

/** Renderer → engine on `display:command`. Mirrors `Command` in `display.rs`. */
export type DisplayCommand = { action: 'show'; id: string; fill: boolean };

/**
 * Engine → local renderer on `os:presence`. Mirrors `PresencePayload` in
 * `presence.rs`. Never sent to a remote panel: when you are at your desk is
 * nobody else's business.
 */
export interface PresencePayload {
  /** False where the system gives no idle time: not the same as always here. */
  available: boolean;
  reason: string | null;
  /**
   * Away once nothing has been pressed, moved or touched for the delay the
   * renderer sent. Locked while the system's lock screen covers every display.
   */
  state: 'here' | 'away' | 'locked';
}

/**
 * Renderer → engine on `presence:command`. Mirrors `Command` in
 * `presence.rs`. Null for never; until it arrives, nobody is ever away.
 */
export type PresenceCommand = { action: 'configure'; awayAfterSec: number | null };

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

/** One address another device might reach the host on. Mirrors `Address` in `remote.rs`. */
export interface RemoteAddress {
  /** The network adapter's own name, such as Ethernet or Wi-Fi. */
  adapter: string;
  ip: string;
  /** Made by software on the host (WSL, Hyper-V, Docker, a VM), so no other device can reach it. */
  virtual: boolean;
  /** Opens the panel at this address, key and name included. */
  link: string;
}

/**
 * Engine → local renderer on `app:remote`. Mirrors `RemotePayload` in
 * `remote.rs`. Never sent to a remote panel: it carries the key.
 */
export interface RemotePayload {
  on: boolean;
  listening: boolean;
  port: number;
  /** What this machine calls itself, as the links and the network name it. */
  name: string;
  /** Where another machine can open the panel, real adapters first. */
  addresses: RemoteAddress[];
  key: string | null;
  control: boolean;
  /** Remote panels connected right now. */
  clients: number;
  error: string | null;
}

/** Renderer → engine on `remote:command`. Mirrors `Command` in `remote.rs`. */
export type RemoteCommand =
  | { action: 'configure'; on: boolean; port: number; control: boolean }
  | { action: 'new_key' };

/**
 * Renderer → engine on `update:command`. Mirrors `Command` in `update.rs`.
 * Carries no URL: where updates come from is compiled into the engine.
 */
export type UpdateCommand =
  | { action: 'check' }
  | { action: 'install' }
  | { action: 'set_auto'; on: boolean }
  | { action: 'open_release' }
  | { action: 'open_support' };
