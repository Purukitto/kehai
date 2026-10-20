import type { Area, Layout, ThemeId, Tile } from './types';

/**
 * Validates a stored layout into the typed shape.
 *
 * This exists because Import takes a file from outside the app, and because
 * JSON imports widen tuples to arrays. Anything malformed is reported rather
 * than thrown at the renderer — a bad layout should show a message, never a
 * blank panel.
 */

export class LayoutError extends Error {}

const THEMES: ThemeId[] = ['amber', 'phosphor', 'ice'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asArea(v: unknown, cols: number, rows: number, where: string): Area {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === 'number' && Number.isInteger(n))) {
    throw new LayoutError(`${where}: area must be four integers [rowStart, colStart, rowEnd, colEnd]`);
  }
  const [r1, c1, r2, c2] = v as number[];
  if (r2 <= r1 || c2 <= c1) {
    throw new LayoutError(`${where}: area end must be greater than start`);
  }
  if (r1 < 1 || c1 < 1 || r2 > rows + 1 || c2 > cols + 1) {
    throw new LayoutError(`${where}: area [${r1},${c1},${r2},${c2}] falls outside the ${cols}x${rows} grid`);
  }
  return [r1, c1, r2, c2];
}

export function parseLayout(input: unknown): Layout {
  if (!isRecord(input)) throw new LayoutError('layout must be an object');

  const { id, name, theme, grid, tiles } = input;

  if (typeof id !== 'string' || !id) throw new LayoutError('layout.id must be a non-empty string');
  if (typeof name !== 'string' || !name) throw new LayoutError('layout.name must be a non-empty string');
  if (typeof theme !== 'string' || !THEMES.includes(theme as ThemeId)) {
    throw new LayoutError(`layout.theme must be one of ${THEMES.join(', ')}`);
  }
  if (!isRecord(grid)) throw new LayoutError('layout.grid is missing');

  const cols = grid.cols;
  const rows = grid.rows;
  const gap = grid.gap ?? 1;
  if (typeof cols !== 'number' || cols < 1 || cols > 48) throw new LayoutError('grid.cols must be 1-48');
  if (typeof rows !== 'number' || rows < 1 || rows > 48) throw new LayoutError('grid.rows must be 1-48');
  if (typeof gap !== 'number' || gap < 0 || gap > 32) throw new LayoutError('grid.gap must be 0-32');

  if (!Array.isArray(tiles)) throw new LayoutError('layout.tiles must be an array');

  const parsed: Tile[] = tiles.map((t, i) => {
    const where = `tiles[${i}]`;
    if (!isRecord(t)) throw new LayoutError(`${where} must be an object`);
    if (typeof t.widget !== 'string' || !t.widget) {
      throw new LayoutError(`${where}.widget must be a non-empty string`);
    }
    const props = t.props === undefined ? {} : t.props;
    if (!isRecord(props)) throw new LayoutError(`${where}.props must be an object`);
    return { widget: t.widget, area: asArea(t.area, cols, rows, where), props };
  });

  return { id, name, theme: theme as ThemeId, grid: { cols, rows, gap }, tiles: parsed };
}

/** Non-throwing variant for anything user-supplied. */
export function safeParseLayout(input: unknown): { ok: true; layout: Layout } | { ok: false; reason: string } {
  try {
    return { ok: true, layout: parseLayout(input) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
