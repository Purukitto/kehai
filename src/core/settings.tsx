import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { isThemeId, parseLayout, placeTile, regrid, safeParseLayout } from './layout';
import type { Area, Layout, ThemeId, Tile } from './types';
import ambient from '../layouts/ambient.layout.json';
import panel from '../layouts/panel.layout.json';
import stage from '../layouts/stage.layout.json';

export const PRESETS: Record<string, Layout> = {
  stage: parseLayout(stage),
  panel: parseLayout(panel),
  ambient: parseLayout(ambient),
};

export const PRESET_ORDER = ['stage', 'panel', 'ambient'];

export interface Settings {
  /** The preset this came from, or 'custom' once the layout is edited. */
  presetId: string;
  layout: Layout;
  /**
   * The last edited arrangement, kept while a preset is on screen so that
   * looking at a preset does not throw it away. Null while the arrangement on
   * screen is the custom one, or when there has never been one.
   */
  custom: Layout | null;
  /**
   * Token budget for the quota widget. No local source exposes the real plan
   * limit, so a percentage only exists once you decide what to measure against.
   */
  budgetTokens: number | null;
  /** Hide the header until the pointer reaches the top edge. */
  autoHideBar: boolean;
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
}

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

const STORAGE_KEY = 'kehai.settings.v1';
/** Pre-rename key. Read once so an existing arrangement survives the rename. */
const LEGACY_KEY = 'command-center.settings.v1';

function defaults(): Settings {
  return {
    presetId: 'stage',
    layout: PRESETS.stage,
    custom: null,
    budgetTokens: null,
    autoHideBar: false,
    transcriptRoot: null,
    autoCheckUpdates: false,
    focus: FOCUS_DEFAULTS,
    remote: REMOTE_DEFAULTS,
  };
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

/** Blank means the default, so it is stored as null rather than as ''. */
function folder(path: unknown): string | null {
  return typeof path === 'string' && path.trim() !== '' ? path.trim() : null;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return defaults();

    const parsed = JSON.parse(raw) as Partial<Settings>;
    const stored = safeParseLayout(parsed.layout);
    const storedId = typeof parsed.presetId === 'string' ? parsed.presetId : 'custom';
    const custom = safeParseLayout(parsed.custom);

    // An arrangement nobody has edited follows its preset as shipped, so a
    // release that adds to Stage reaches the people using Stage. Only the
    // theme is theirs: picking one is not an edit.
    //
    // A layout that will not parse costs only the layout. Throwing every other
    // setting away with it is how a grid change once wiped a budget, focus
    // lengths and the remote panel along with the arrangement.
    const presetId = stored.ok || PRESETS[storedId] ? storedId : 'stage';
    const shipped: Layout | undefined = PRESETS[presetId];
    if (!stored.ok) console.warn(`stored layout rejected, showing ${presetId} instead:`, stored.reason);
    const storedTheme = (parsed.layout as Partial<Layout> | undefined)?.theme;
    const theme = stored.ok ? stored.layout.theme : isThemeId(storedTheme) ? storedTheme : PRESETS.stage.theme;

    return {
      presetId,
      layout: shipped ? { ...shipped, theme } : stored.ok ? stored.layout : PRESETS.stage,
      custom: custom.ok ? custom.layout : null,
      budgetTokens: typeof parsed.budgetTokens === 'number' ? parsed.budgetTokens : null,
      autoHideBar: parsed.autoHideBar === true,
      transcriptRoot: folder(parsed.transcriptRoot),
      autoCheckUpdates: parsed.autoCheckUpdates === true,
      focus: focus(parsed.focus),
      remote: remote(parsed.remote),
    };
  } catch {
    return defaults();
  }
}

interface Store {
  settings: Settings;
  usePreset: (id: string) => void;
  /** Puts the kept custom arrangement back on screen. */
  restoreCustom: () => void;
  setTheme: (theme: ThemeId) => void;
  setBudget: (tokens: number | null) => void;
  setAutoHideBar: (on: boolean) => void;
  setTranscriptRoot: (path: string | null) => void;
  setAutoCheckUpdates: (on: boolean) => void;
  setFocus: (focus: Partial<FocusSettings>) => void;
  setRemote: (remote: Partial<RemoteSettings>) => void;
  setTiles: (tiles: Tile[]) => void;
  setTileArea: (index: number, area: Area) => void;
  setTileProp: (index: number, key: string, value: unknown) => void;
  /**
   * Adds the widget where there is room, or removes every tile of it. False
   * when there was no room to add it. `minOf` is the registry's minimum sizes,
   * passed in because the registry's widgets read this store.
   */
  toggleWidget: (widget: string, minOf: (widget: string) => [number, number]) => boolean;
  removeTile: (index: number) => void;
  setGrid: (grid: Partial<Layout['grid']>) => void;
  reset: () => void;
  importLayout: (raw: unknown) => string | null;
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

  // An edit makes what is on screen the custom arrangement, so any kept one is
  // replaced; Settings says so before you start.
  const editLayout = useCallback((fn: (layout: Layout) => Layout) => {
    setSettings((prev) => ({ ...prev, presetId: 'custom', layout: fn(prev.layout), custom: null }));
  }, []);

  const store = useMemo<Store>(
    () => ({
      settings,

      // The theme is not part of what a preset decides, and an arrangement
      // you made is kept rather than replaced.
      usePreset: (id) => {
        const preset = PRESETS[id];
        if (!preset) return;
        setSettings((prev) => ({
          ...prev,
          presetId: id,
          layout: { ...preset, theme: prev.layout.theme },
          custom: prev.presetId === 'custom' ? prev.layout : prev.custom,
        }));
      },

      restoreCustom: () =>
        setSettings((prev) =>
          prev.custom
            ? { ...prev, presetId: 'custom', layout: { ...prev.custom, theme: prev.layout.theme }, custom: null }
            : prev
        ),

      setTheme: (theme) =>
        setSettings((prev) => ({ ...prev, layout: { ...prev.layout, theme } })),

      setBudget: (budgetTokens) => setSettings((prev) => ({ ...prev, budgetTokens })),

      setAutoHideBar: (autoHideBar) => setSettings((prev) => ({ ...prev, autoHideBar })),

      setTranscriptRoot: (path) => setSettings((prev) => ({ ...prev, transcriptRoot: folder(path) })),

      setAutoCheckUpdates: (autoCheckUpdates) => setSettings((prev) => ({ ...prev, autoCheckUpdates })),

      setFocus: (next) => setSettings((prev) => ({ ...prev, focus: { ...prev.focus, ...next } })),

      setRemote: (next) => setSettings((prev) => ({ ...prev, remote: { ...prev.remote, ...next } })),

      setTiles: (tiles) => editLayout((layout) => ({ ...layout, tiles })),

      setTileArea: (index, area) =>
        editLayout((layout) => ({
          ...layout,
          tiles: layout.tiles.map((t, i) => (i === index ? { ...t, area } : t)),
        })),

      setTileProp: (index, key, value) =>
        editLayout((layout) => ({
          ...layout,
          tiles: layout.tiles.map((t, i) =>
            i === index ? { ...t, props: { ...(t.props ?? {}), [key]: value } } : t
          ),
        })),

      toggleWidget: (widget, minOf) => {
        if (settings.layout.tiles.some((t) => t.widget === widget)) {
          editLayout((layout) => ({ ...layout, tiles: layout.tiles.filter((t) => t.widget !== widget) }));
          return true;
        }
        const tiles = placeTile(settings.layout, widget, minOf);
        if (!tiles) return false;
        editLayout((layout) => ({ ...layout, tiles }));
        return true;
      },

      removeTile: (index) =>
        editLayout((layout) => ({ ...layout, tiles: layout.tiles.filter((_, i) => i !== index) })),

      setGrid: (grid) =>
        editLayout((layout) => {
          const cols = grid.cols ?? layout.grid.cols;
          const rows = grid.rows ?? layout.grid.rows;
          const fitted = cols === layout.grid.cols && rows === layout.grid.rows ? layout : regrid(layout, cols, rows);
          return { ...fitted, grid: { ...fitted.grid, ...grid } };
        }),

      reset: () => setSettings(defaults()),

      importLayout: (raw) => {
        const result = safeParseLayout(raw);
        if (!result.ok) return result.reason;
        setSettings((prev) => ({ ...prev, presetId: 'custom', layout: result.layout, custom: null }));
        return null;
      },
    }),
    [settings, editLayout]
  );

  return <SettingsContext.Provider value={store}>{children}</SettingsContext.Provider>;
}
