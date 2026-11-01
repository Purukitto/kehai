import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { isThemeId, parseLayout, safeParseLayout } from './layout';
import type { NotifyApp, NotifyRemote, NotifyRule } from './payloads';
import type { Arrangement, Layout, Shape, ThemeId } from './types';
import ambient from '../layouts/ambient.layout.json';
import panel from '../layouts/panel.layout.json';
import stage from '../layouts/stage.layout.json';

export const PRESETS: Record<string, Layout> = {
  stage: parseLayout(stage),
  panel: parseLayout(panel),
  ambient: parseLayout(ambient),
};

export const PRESET_ORDER = ['stage', 'panel', 'ambient'];

export const isPreset = (id: string): boolean => Object.hasOwn(PRESETS, id);

export interface Settings {
  /** The layout on screen: a preset's id, or the id of one of yours. */
  layoutId: string;
  /**
   * Layouts you made: copies of a preset or of each other, and imports.
   * Presets are never stored, so one nobody has edited always follows the
   * version that shipped, and a release that adds to Stage reaches the people
   * using Stage.
   */
  layouts: Layout[];
  /** Not part of any layout, so changing layout never changes colours. */
  theme: ThemeId;
  /**
   * Token budget for the quota widget. No local source exposes the real plan
   * limit, so a percentage only exists once you decide what to measure against.
   */
  budgetTokens: number | null;
  /** Hide the header until the pointer reaches the top edge. */
  autoHideBar: boolean;
  /** The main readout's tab you last picked, kept across restarts. Null before any. */
  stageTab: string | null;
  /**
   * Whether the main readout moves to Agents while one waits on you, and back
   * to stageTab once none does. On unless turned off: it is the one thing on
   * the panel worth turning your head for.
   */
  followAttention: boolean;
  /**
   * Where the quota poller reads agent session transcripts. Null means the
   * engine's default. Kept here because this is the only settings store; the
   * engine hears it over `quota:command`.
   */
  transcriptRoot: string | null;
  /**
   * Let the engine ask GitHub for a new release once a day. Off unless turned
   * on: it is the only request Kehai makes, and the README promises none unasked.
   */
  autoCheckUpdates: boolean;
  /**
   * Block lengths for the focus timer. The engine runs the timer, so it hears
   * these over `flow:command` and cannot persist them itself.
   */
  focus: FocusSettings;
  /**
   * Whether the engine serves this panel to browsers on other machines. Off
   * unless turned on: it opens a port. The engine hears it over
   * `remote:command`; the key it hands out is the engine's, not stored here.
   */
  remote: RemoteSettings;
  /**
   * Whether first-run setup has been finished or skipped. A copy with settings
   * from before setup existed has done without it, and is not shown it.
   */
  setupDone: boolean;
  /**
   * Whether the engine may ask for notification access and read them. Off on
   * a fresh install until you press Allow, so the platform's prompt never
   * arrives unexplained. A copy from before this was asked at every launch,
   * and keeps that.
   */
  notificationsAsked: boolean;
  /** Everything Kehai draws turned down between two times, by this panel's clock. */
  night: NightSettings;
  /**
   * What the panel does while nobody is at this computer. The engine decides
   * when that is, from the delay here; a remote panel never goes quiet.
   */
  away: AwaySettings;
  /**
   * Which apps' notifications reach the panel, and what remote panels and
   * quiet times get. The engine applies them, and hears them over
   * `notify:rules`.
   */
  notify: NotifySettings;
  /**
   * Whether closing the panel has said once that Kehai carries on in the tray.
   * Every copy hears it the first time, since close used to quit.
   */
  hideExplained: boolean;
}

export interface NotifiedApp {
  /** As the app last called itself. */
  name: string;
  rule: NotifyRule;
  lastMs: number;
  /** Seen since the options were last open, so it is marked NEW there. */
  fresh: boolean;
}

export interface NotifySettings {
  /** Every app Kehai has seen a notification from, by the app's own id. */
  apps: Record<string, NotifiedApp>;
  remote: NotifyRemote;
  /** Only how many, while a focus block runs. */
  quietFocus: boolean;
}

/**
 * A copy updating from before these existed starts here too: a tablet that
 * was paired with every notification's text sees names only from now on,
 * which the changelog says.
 */
const NOTIFY_DEFAULTS: NotifySettings = { apps: {}, remote: 'name', quietFocus: true };

export type DimLevel = 'little' | 'half' | 'lot';

export interface NightSettings {
  on: boolean;
  /**
   * Minutes after midnight. From is usually later than to, and the night runs
   * over midnight. Fixed hours: sunset would need a location, and Kehai asks
   * for none.
   */
  fromMin: number;
  toMin: number;
  level: DimLevel;
}

/**
 * Clock is the time and only what is running or waiting on you. Panel is the
 * whole panel, dimmed, with notification text hidden. Nothing is dark until an
 * agent waits.
 */
export type QuietShow = 'clock' | 'panel' | 'nothing';

export interface AwaySettings {
  /** Minutes without input before the panel goes quiet. Null for never. */
  afterMin: number | null;
  show: QuietShow;
}

// What a fresh install starts with, and what setup offers. A copy updating from
// before these existed starts with both off, so nothing it does changes unasked.
const NIGHT_DEFAULTS: NightSettings = { on: true, fromMin: 22 * 60, toMin: 7 * 60, level: 'half' };
const AWAY_DEFAULTS: AwaySettings = { afterMin: 10, show: 'clock' };

export interface RemoteSettings {
  on: boolean;
  port: number;
  /** Whether remote panels may press media, notification and timer buttons. */
  control: boolean;
}

const REMOTE_DEFAULTS: RemoteSettings = { on: false, port: 5280, control: false };

export interface FocusSettings {
  focusMin: number;
  breakMin: number;
  sprints: number;
}

const FOCUS_DEFAULTS: FocusSettings = { focusMin: 25, breakMin: 5, sprints: 4 };

const STORAGE_KEY = 'kehai.settings.v2';
/**
 * Before layouts had shapes. Read when there is nothing newer, and never
 * written, so going back to 0.3 finds its settings where it left them.
 */
const V1_KEY = 'kehai.settings.v1';
/** Pre-rename key, in the same format as v1. */
const LEGACY_KEY = 'command-center.settings.v1';

function defaults(): Settings {
  return {
    layoutId: 'stage',
    layouts: [],
    theme: 'amber',
    budgetTokens: null,
    autoHideBar: false,
    stageTab: null,
    followAttention: true,
    transcriptRoot: null,
    autoCheckUpdates: false,
    focus: FOCUS_DEFAULTS,
    remote: REMOTE_DEFAULTS,
    setupDone: false,
    notificationsAsked: false,
    night: NIGHT_DEFAULTS,
    away: AWAY_DEFAULTS,
    notify: NOTIFY_DEFAULTS,
    hideExplained: false,
  };
}

export function findLayout(settings: Settings, id: string): Layout | undefined {
  return isPreset(id) ? PRESETS[id] : settings.layouts.find((l) => l.id === id);
}

/** The prefix keeps an id of yours from ever naming a preset. */
function freshId(layouts: Layout[]): string {
  let n = layouts.length + 1;
  while (layouts.some((l) => l.id === `yours-${n}`)) n += 1;
  return `yours-${n}`;
}

/** `name`, or `name 2`, `name 3`… whichever no layout of yours has yet. */
function uniqueName(name: string, layouts: Layout[]): string {
  const taken = (candidate: string) => layouts.some((l) => l.name === candidate);
  if (!taken(name)) return name;
  let n = 2;
  while (taken(`${name} ${n}`)) n += 1;
  return `${name} ${n}`;
}

function remote(raw: unknown): RemoteSettings {
  const r = (raw ?? {}) as Partial<Record<keyof RemoteSettings, unknown>>;
  const port = r.port;
  return {
    on: r.on === true,
    port: typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : REMOTE_DEFAULTS.port,
    control: r.control === true,
  };
}

/** Each length on its own, so one bad field does not discard the others. */
function focus(raw: unknown): FocusSettings {
  const r = (raw ?? {}) as Partial<Record<keyof FocusSettings, unknown>>;
  const pick = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback;
  return {
    focusMin: pick(r.focusMin, FOCUS_DEFAULTS.focusMin),
    breakMin: pick(r.breakMin, FOCUS_DEFAULTS.breakMin),
    sprints: pick(r.sprints, FOCUS_DEFAULTS.sprints),
  };
}

const minuteOfDay = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 24 * 60 ? v : fallback;

/** Settings stored before night existed have none, and stay off. */
function night(raw: unknown): NightSettings {
  if (raw === undefined) return { ...NIGHT_DEFAULTS, on: false };
  const r = (raw ?? {}) as Partial<Record<keyof NightSettings, unknown>>;
  return {
    on: r.on === true,
    fromMin: minuteOfDay(r.fromMin, NIGHT_DEFAULTS.fromMin),
    toMin: minuteOfDay(r.toMin, NIGHT_DEFAULTS.toMin),
    level: r.level === 'little' || r.level === 'lot' ? r.level : 'half',
  };
}

/** Likewise: never away, unless this was chosen. */
function away(raw: unknown): AwaySettings {
  if (raw === undefined) return { ...AWAY_DEFAULTS, afterMin: null };
  const r = (raw ?? {}) as Partial<Record<keyof AwaySettings, unknown>>;
  const after = r.afterMin;
  return {
    afterMin: typeof after === 'number' && Number.isInteger(after) && after > 0 ? after : null,
    show: r.show === 'panel' || r.show === 'nothing' ? r.show : 'clock',
  };
}

/** Each app on its own, so one bad entry costs only itself. */
function notify(raw: unknown): NotifySettings {
  const r = (raw ?? {}) as Partial<Record<keyof NotifySettings, unknown>>;
  const apps: Record<string, NotifiedApp> = {};
  if (r.apps && typeof r.apps === 'object') {
    for (const [id, value] of Object.entries(r.apps as Record<string, unknown>)) {
      const a = (value ?? {}) as Partial<Record<keyof NotifiedApp, unknown>>;
      if (typeof a.name !== 'string') continue;
      apps[id] = {
        name: a.name,
        rule: a.rule === 'name' || a.rule === 'hide' ? a.rule : 'show',
        lastMs: typeof a.lastMs === 'number' ? a.lastMs : 0,
        fresh: a.fresh === true,
      };
    }
  }
  return {
    apps,
    remote: r.remote === 'same' || r.remote === 'nothing' ? r.remote : 'name',
    quietFocus: r.quietFocus !== false,
  };
}

/** Blank means the default, so it is stored as null rather than as ''. */
function folder(path: unknown): string | null {
  return typeof path === 'string' && path.trim() !== '' ? path.trim() : null;
}

type Where = Pick<Settings, 'layoutId' | 'layouts' | 'theme'>;

/**
 * Settings from before layouts had shapes. Then there was one arrangement of
 * your own at most — on screen, or kept under Custom while a preset was — and
 * it becomes a layout of yours with that arrangement in every shape, which is
 * how it looked on any window then. The theme came from the layout.
 */
function fromV1(parsed: Record<string, unknown>): Where {
  const stored = parsed.layout as { theme?: unknown } | undefined;
  const theme = isThemeId(stored?.theme) ? stored.theme : 'amber';
  const presetId = typeof parsed.presetId === 'string' ? parsed.presetId : 'custom';

  const layouts: Layout[] = [];
  for (const candidate of [presetId === 'custom' ? parsed.layout : undefined, parsed.custom]) {
    const got = safeParseLayout(candidate);
    if (got.ok) layouts.push({ ...got.layout, id: freshId(layouts), name: uniqueName('Custom', layouts) });
  }

  const layoutId = presetId === 'custom' ? (layouts[0]?.id ?? 'stage') : isPreset(presetId) ? presetId : 'stage';
  return { layoutId, layouts, theme };
}

/** Each layout of yours on its own, so one that will not parse costs only itself. */
function fromV2(parsed: Record<string, unknown>): Where {
  const layouts: Layout[] = [];
  for (const raw of Array.isArray(parsed.layouts) ? parsed.layouts : []) {
    const got = safeParseLayout(raw);
    if (!got.ok) console.warn('stored layout rejected:', got.reason);
    else if (!isPreset(got.layout.id) && !layouts.some((l) => l.id === got.layout.id)) layouts.push(got.layout);
  }

  const wanted = typeof parsed.layoutId === 'string' ? parsed.layoutId : 'stage';
  const layoutId = isPreset(wanted) || layouts.some((l) => l.id === wanted) ? wanted : 'stage';
  return { layoutId, layouts, theme: isThemeId(parsed.theme) ? parsed.theme : 'amber' };
}

function load(): Settings {
  try {
    const v2 = localStorage.getItem(STORAGE_KEY);
    const raw = v2 ?? localStorage.getItem(V1_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return defaults();

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      ...(v2 ? fromV2(parsed) : fromV1(parsed)),
      budgetTokens: typeof parsed.budgetTokens === 'number' ? parsed.budgetTokens : null,
      autoHideBar: parsed.autoHideBar === true,
      stageTab: typeof parsed.stageTab === 'string' ? parsed.stageTab : null,
      followAttention: parsed.followAttention !== false,
      transcriptRoot: folder(parsed.transcriptRoot),
      autoCheckUpdates: parsed.autoCheckUpdates === true,
      focus: focus(parsed.focus),
      remote: remote(parsed.remote),
      setupDone: parsed.setupDone !== false,
      notificationsAsked: parsed.notificationsAsked !== false,
      night: night(parsed.night),
      away: away(parsed.away),
      notify: notify(parsed.notify),
      hideExplained: parsed.hideExplained === true,
    };
  } catch {
    return defaults();
  }
}

interface Store {
  settings: Settings;
  /** The layout on screen. */
  layout: Layout;
  useLayout: (id: string) => void;
  /** Adds a copy under Yours, named after the original, and returns its id. */
  copyLayout: (id: string) => string;
  renameLayout: (id: string, name: string) => void;
  /** Removes one of yours. If it was on screen, Stage takes its place. */
  deleteLayout: (id: string) => void;
  /**
   * Changes one shape of a layout and returns the id of the layout changed.
   *
   * A preset cannot change, so the first edit to one makes a copy under
   * Yours, edits the copy, and puts it on screen if the preset was. The
   * returned id is the copy's, which is what the next edit should name.
   */
  editArrangement: (id: string, shape: Shape, fn: (arrangement: Arrangement) => Arrangement) => string;
  /** Adds a layout from outside Kehai under Yours. */
  importLayout: (raw: unknown) => { ok: true; id: string } | { ok: false; reason: string };
  setTheme: (theme: ThemeId) => void;
  setBudget: (tokens: number | null) => void;
  setAutoHideBar: (on: boolean) => void;
  setStageTab: (tab: string) => void;
  setFollowAttention: (on: boolean) => void;
  setTranscriptRoot: (path: string | null) => void;
  setAutoCheckUpdates: (on: boolean) => void;
  setFocus: (focus: Partial<FocusSettings>) => void;
  setRemote: (remote: Partial<RemoteSettings>) => void;
  setSetupDone: (done: boolean) => void;
  /** The go-ahead to ask for notification access. There is no taking it back here. */
  allowNotifications: () => void;
  setNight: (night: Partial<NightSettings>) => void;
  setAway: (away: Partial<AwaySettings>) => void;
  /**
   * Setup's one row for both: on keeps whatever times and delay were chosen,
   * and gives a delay where there was none.
   */
  setQuiet: (on: boolean) => void;
  /** Adds apps seen for the first time, at SHOW, and keeps names and times current. */
  noteApps: (apps: NotifyApp[]) => void;
  setAppRule: (id: string, rule: NotifyRule) => void;
  setNotify: (next: Partial<Omit<NotifySettings, 'apps'>>) => void;
  /** The options have been open, so nothing in them is new any more. */
  seenApps: () => void;
  /** Closing the panel has said where Kehai goes. */
  explainedHide: () => void;
  /** Back to a fresh install's settings, setup included. */
  reset: () => void;
}

const SettingsContext = createContext<Store | null>(null);

export function useSettings(): Store {
  const store = useContext(SettingsContext);
  if (!store) throw new Error('useSettings used outside SettingsProvider');
  return store;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // A private window or a locked-down profile can refuse storage. The app
      // still works; the arrangement just will not survive a restart.
    }
  }, [settings]);

  const store = useMemo<Store>(() => {
    // Ids are worked out from the settings this store was made with, so the
    // caller gets one back straight away. The store is remade on every
    // change, so the next call sees the layout this one added.
    const nextId = freshId(settings.layouts);

    return {
      settings,
      layout: findLayout(settings, settings.layoutId) ?? PRESETS.stage,

      useLayout: (id) =>
        setSettings((prev) => (findLayout(prev, id) ? { ...prev, layoutId: id } : prev)),

      copyLayout: (id) => {
        setSettings((prev) => {
          const source = findLayout(prev, id);
          if (!source) return prev;
          const copy = { ...source, id: nextId, name: uniqueName(`${source.name} copy`, prev.layouts) };
          return { ...prev, layouts: [...prev.layouts, copy] };
        });
        return nextId;
      },

      renameLayout: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed || isPreset(id)) return;
        setSettings((prev) => ({
          ...prev,
          layouts: prev.layouts.map((l) =>
            l.id === id ? { ...l, name: uniqueName(trimmed, prev.layouts.filter((o) => o.id !== id)) } : l
          ),
        }));
      },

      deleteLayout: (id) =>
        setSettings((prev) => ({
          ...prev,
          layouts: prev.layouts.filter((l) => l.id !== id),
          layoutId: prev.layoutId === id ? 'stage' : prev.layoutId,
        })),

      editArrangement: (id, shape, fn) => {
        if (!isPreset(id)) {
          setSettings((prev) => ({
            ...prev,
            layouts: prev.layouts.map((l) =>
              l.id === id ? { ...l, shapes: { ...l.shapes, [shape]: fn(l.shapes[shape]) } } : l
            ),
          }));
          return id;
        }
        setSettings((prev) => {
          const preset = PRESETS[id];
          const copy: Layout = {
            id: nextId,
            name: uniqueName(`${preset.name} copy`, prev.layouts),
            shapes: { ...preset.shapes, [shape]: fn(preset.shapes[shape]) },
          };
          return {
            ...prev,
            layouts: [...prev.layouts, copy],
            layoutId: prev.layoutId === id ? nextId : prev.layoutId,
          };
        });
        return nextId;
      },

      importLayout: (raw) => {
        const result = safeParseLayout(raw);
        if (!result.ok) return result;
        setSettings((prev) => ({
          ...prev,
          layouts: [
            ...prev.layouts,
            { ...result.layout, id: nextId, name: uniqueName(result.layout.name, prev.layouts) },
          ],
        }));
        return { ok: true, id: nextId };
      },

      setTheme: (theme) => setSettings((prev) => ({ ...prev, theme })),

      setBudget: (budgetTokens) => setSettings((prev) => ({ ...prev, budgetTokens })),

      setAutoHideBar: (autoHideBar) => setSettings((prev) => ({ ...prev, autoHideBar })),

      setStageTab: (stageTab) => setSettings((prev) => ({ ...prev, stageTab })),

      setFollowAttention: (followAttention) => setSettings((prev) => ({ ...prev, followAttention })),

      setTranscriptRoot: (path) => setSettings((prev) => ({ ...prev, transcriptRoot: folder(path) })),

      setAutoCheckUpdates: (autoCheckUpdates) => setSettings((prev) => ({ ...prev, autoCheckUpdates })),

      setFocus: (next) => setSettings((prev) => ({ ...prev, focus: { ...prev.focus, ...next } })),

      setRemote: (next) => setSettings((prev) => ({ ...prev, remote: { ...prev.remote, ...next } })),

      setSetupDone: (setupDone) => setSettings((prev) => ({ ...prev, setupDone })),

      allowNotifications: () => setSettings((prev) => ({ ...prev, notificationsAsked: true })),

      setNight: (next) => setSettings((prev) => ({ ...prev, night: { ...prev.night, ...next } })),

      setAway: (next) => setSettings((prev) => ({ ...prev, away: { ...prev.away, ...next } })),

      setQuiet: (on) =>
        setSettings((prev) => ({
          ...prev,
          night: { ...prev.night, on },
          away: { ...prev.away, afterMin: on ? (prev.away.afterMin ?? AWAY_DEFAULTS.afterMin) : null },
        })),

      noteApps: (seen) =>
        setSettings((prev) => {
          let apps: Record<string, NotifiedApp> | null = null;
          for (const a of seen) {
            const known = prev.notify.apps[a.id];
            if (known && known.name === a.name && known.lastMs >= a.lastMs) continue;
            apps ??= { ...prev.notify.apps };
            apps[a.id] = known
              ? { ...known, name: a.name, lastMs: Math.max(known.lastMs, a.lastMs) }
              : { name: a.name, rule: 'show', lastMs: a.lastMs, fresh: true };
          }
          // Unchanged settings are not stored again every few seconds.
          return apps ? { ...prev, notify: { ...prev.notify, apps } } : prev;
        }),

      setAppRule: (id, rule) =>
        setSettings((prev) => {
          const known = prev.notify.apps[id];
          if (!known) return prev;
          return { ...prev, notify: { ...prev.notify, apps: { ...prev.notify.apps, [id]: { ...known, rule } } } };
        }),

      setNotify: (next) => setSettings((prev) => ({ ...prev, notify: { ...prev.notify, ...next } })),

      seenApps: () =>
        setSettings((prev) => {
          if (!Object.values(prev.notify.apps).some((a) => a.fresh)) return prev;
          const apps = Object.fromEntries(Object.entries(prev.notify.apps).map(([id, a]) => [id, { ...a, fresh: false }]));
          return { ...prev, notify: { ...prev.notify, apps } };
        }),

      explainedHide: () => setSettings((prev) => (prev.hideExplained ? prev : { ...prev, hideExplained: true })),

      reset: () => setSettings(defaults()),
    };
  }, [settings]);

  return <SettingsContext.Provider value={store}>{children}</SettingsContext.Provider>;
}
