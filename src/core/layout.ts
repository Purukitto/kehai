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

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && THEMES.includes(v as ThemeId);
}

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
  if (!isThemeId(theme)) {
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

  return { id, name, theme, grid: { cols, rows, gap }, tiles: parsed };
}

/** Half-open on both axes, so tiles that merely touch do not count. */
export function overlaps(a: Area, b: Area): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

/** The first space, row-major, where a `w` by `h` tile covers no other tile. */
export function firstFree(tiles: Tile[], w: number, h: number, cols: number, rows: number): Area | null {
  for (let r = 1; r + h <= rows + 1; r += 1) {
    for (let c = 1; c + w <= cols + 1; c += 1) {
      const candidate: Area = [r, c, r + h, c + w];
      if (!tiles.some((t) => overlaps(candidate, t.area))) return candidate;
    }
  }
  return null;
}

/**
 * Carries a layout onto a grid of another size, every edge moving to the same
 * proportion of the new grid.
 *
 * Without this, fewer columns left tiles hanging off the edge, and the next
 * launch threw the stored layout away. Each edge goes through one monotonic
 * mapping, so tiles that met still meet and tiles that did not overlap still
 * do not; only a tile squeezed to nothing is given back one cell.
 */
export function regrid(layout: Layout, cols: number, rows: number): Layout {
  const { cols: fromCols, rows: fromRows } = layout.grid;
  const edge = (e: number, from: number, to: number) => Math.round(((e - 1) * to) / from) + 1;
  const span = (start: number, end: number, size: number): [number, number] => {
    if (end > start) return [start, end];
    const last = Math.min(size + 1, start + 1);
    return [last - 1, last];
  };

  const tiles = layout.tiles.map((t) => {
    const [r1, r2] = span(edge(t.area[0], fromRows, rows), edge(t.area[2], fromRows, rows), rows);
    const [c1, c2] = span(edge(t.area[1], fromCols, cols), edge(t.area[3], fromCols, cols), cols);
    return { ...t, area: [r1, c1, r2, c2] as Area };
  });

  return { ...layout, grid: { ...layout.grid, cols, rows }, tiles };
}

/**
 * Finds room for a new tile without covering anything.
 *
 * Free space comes first, at twice the widget's minimum if that fits. On a
 * full grid — which every shipped preset is — the largest tile that can spare
 * a strip along its bottom or right edge without going under its own minimum
 * gives one up, and the new tile takes the whole strip. Null when no tile can.
 */
export function placeTile(
  layout: Layout,
  widget: string,
  minOf: (widget: string) => [number, number]
): Tile[] | null {
  const { cols, rows } = layout.grid;
  const tiles = layout.tiles;
  const [w, h] = minOf(widget);

  for (const [tw, th] of [
    [w * 2, h * 2],
    [w, h],
  ]) {
    const area = firstFree(tiles, tw, th, cols, rows);
    if (area) return [...tiles, { widget, area, props: {} }];
  }

  const largest = tiles
    .map((t, i) => ({ t, i, cells: (t.area[2] - t.area[0]) * (t.area[3] - t.area[1]) }))
    .sort((a, b) => b.cells - a.cells);

  for (const { t, i } of largest) {
    const [r1, c1, r2, c2] = t.area;
    const [minCols, minRows] = minOf(t.widget);
    const give = (shrunk: Area, taken: Area) =>
      tiles.map((x, j) => (j === i ? { ...x, area: shrunk } : x)).concat({ widget, area: taken, props: {} });

    if (r2 - r1 - h >= minRows && c2 - c1 >= w) return give([r1, c1, r2 - h, c2], [r2 - h, c1, r2, c2]);
    if (c2 - c1 - w >= minCols && r2 - r1 >= h) return give([r1, c1, r2, c2 - w], [r1, c2 - w, r2, c2]);
  }

  return null;
}

/** Non-throwing variant for anything user-supplied. */
export function safeParseLayout(input: unknown): { ok: true; layout: Layout } | { ok: false; reason: string } {
  try {
    return { ok: true, layout: parseLayout(input) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
