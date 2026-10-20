import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { parseLayout, safeParseLayout } from './layout';
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
}

const STORAGE_KEY = 'kehai.settings.v1';
/** Pre-rename key. Read once so an existing arrangement survives the rename. */
const LEGACY_KEY = 'command-center.settings.v1';

function defaults(): Settings {
  return {
    presetId: 'stage',
    layout: PRESETS.stage,
    budgetTokens: null,
    autoHideBar: false,
    transcriptRoot: null,
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
    const layout = safeParseLayout(parsed.layout);
    if (!layout.ok) {
      console.warn('stored layout rejected, falling back to Stage:', layout.reason);
      return defaults();
    }

    return {
      presetId: typeof parsed.presetId === 'string' ? parsed.presetId : 'custom',
      layout: layout.layout,
      budgetTokens: typeof parsed.budgetTokens === 'number' ? parsed.budgetTokens : null,
      autoHideBar: parsed.autoHideBar === true,
      transcriptRoot: folder(parsed.transcriptRoot),
    };
  } catch {
    return defaults();
  }
}

interface Store {
  settings: Settings;
  usePreset: (id: string) => void;
  setTheme: (theme: ThemeId) => void;
  setBudget: (tokens: number | null) => void;
  setAutoHideBar: (on: boolean) => void;
  setTranscriptRoot: (path: string | null) => void;
  setTiles: (tiles: Tile[]) => void;
  setTileArea: (index: number, area: Area) => void;
  setTileProp: (index: number, key: string, value: unknown) => void;
  toggleWidget: (widget: string) => void;
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

/** A widget added from settings lands here until it is dragged somewhere. */
function defaultArea(layout: Layout): Area {
  const rows = layout.grid.rows;
  const cols = layout.grid.cols;
  return [Math.max(1, rows - 3), 1, Math.max(2, rows - 1), Math.min(cols + 1, 5)];
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

  const editLayout = useCallback((fn: (layout: Layout) => Layout) => {
    setSettings((prev) => ({ ...prev, presetId: 'custom', layout: fn(prev.layout) }));
  }, []);

  const store = useMemo<Store>(
    () => ({
      settings,

      usePreset: (id) => {
        const preset = PRESETS[id];
        if (preset) setSettings((prev) => ({ ...prev, presetId: id, layout: preset }));
      },

      setTheme: (theme) =>
        setSettings((prev) => ({ ...prev, layout: { ...prev.layout, theme } })),

      setBudget: (budgetTokens) => setSettings((prev) => ({ ...prev, budgetTokens })),

      setAutoHideBar: (autoHideBar) => setSettings((prev) => ({ ...prev, autoHideBar })),

      setTranscriptRoot: (path) => setSettings((prev) => ({ ...prev, transcriptRoot: folder(path) })),

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

      toggleWidget: (widget) =>
        editLayout((layout) => {
          const present = layout.tiles.some((t) => t.widget === widget);
          if (present) {
            return { ...layout, tiles: layout.tiles.filter((t) => t.widget !== widget) };
          }
          return { ...layout, tiles: [...layout.tiles, { widget, area: defaultArea(layout), props: {} }] };
        }),

      setGrid: (grid) =>
        editLayout((layout) => ({ ...layout, grid: { ...layout.grid, ...grid } })),

      reset: () => setSettings(defaults()),

      importLayout: (raw) => {
        const result = safeParseLayout(raw);
        if (!result.ok) return result.reason;
        setSettings((prev) => ({ ...prev, presetId: 'custom', layout: result.layout }));
        return null;
      },
    }),
    [settings, editLayout]
  );

  return <SettingsContext.Provider value={store}>{children}</SettingsContext.Provider>;
}
