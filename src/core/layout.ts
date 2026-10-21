import type { Area, Arrangement, Layout, Shape, ThemeId, Tile } from './types';

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

export const SHAPES: Shape[] = ['landscape', 'bar', 'portrait'];

/**
 * Width over height for drawing a shape that is not the one on screen: the
 * arranger's surface and the thumbnails. 16:10, 4:1 and 10:16.
 */
export const SHAPE_ASPECT: Record<Shape, number> = { landscape: 1.6, bar: 4, portrait: 0.625 };

/** Square counts as landscape: it is what a landscape layout was drawn for. */
export function shapeOf(width: number, height: number): Shape {
  if (width <= 0 || height <= 0) return 'landscape';
  const ratio = width / height;
  if (ratio < 1) return 'portrait';
  if (ratio > 2.4) return 'bar';
  return 'landscape';
}

/** What Export writes, so a later format can tell this one apart. */
export const LAYOUT_FORMAT = 2;

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

function parseArrangement(input: unknown, where: string): Arrangement {
  if (!isRecord(input)) throw new LayoutError(`${where} must be an object`);
  const { grid, tiles } = input;
  if (!isRecord(grid)) throw new LayoutError(`${where}.grid is missing`);

  const cols = grid.cols;
  const rows = grid.rows;
  const gap = grid.gap ?? 1;
  if (typeof cols !== 'number' || cols < 1 || cols > 48) throw new LayoutError(`${where}.grid.cols must be 1-48`);
  if (typeof rows !== 'number' || rows < 1 || rows > 48) throw new LayoutError(`${where}.grid.rows must be 1-48`);
  if (typeof gap !== 'number' || gap < 0 || gap > 32) throw new LayoutError(`${where}.grid.gap must be 0-32`);

  if (!Array.isArray(tiles)) throw new LayoutError(`${where}.tiles must be an array`);

  const parsed: Tile[] = tiles.map((t, i) => {
    const at = `${where}.tiles[${i}]`;
    if (!isRecord(t)) throw new LayoutError(`${at} must be an object`);
    if (typeof t.widget !== 'string' || !t.widget) {
      throw new LayoutError(`${at}.widget must be a non-empty string`);
    }
    const props = t.props === undefined ? {} : t.props;
    if (!isRecord(props)) throw new LayoutError(`${at}.props must be an object`);
    return { widget: t.widget, area: asArea(t.area, cols, rows, at), props };
  });

  return { grid: { cols, rows, gap }, tiles: parsed };
}

/**
 * Reads a layout in either format.
 *
 * Before 0.4.0 a layout was one grid and its tiles, stretched over any window,
 * with a theme. Such a layout still imports: the one arrangement becomes all
 * three shapes, which is exactly how it used to look, and the theme is left
 * out because a layout no longer has one. A newer layout missing a shape gets
 * a copy of the first it has.
 */
export function parseLayout(input: unknown): Layout {
  if (!isRecord(input)) throw new LayoutError('layout must be an object');

  const { id, name, shapes } = input;
  if (typeof id !== 'string' || !id) throw new LayoutError('layout.id must be a non-empty string');
  if (typeof name !== 'string' || !name) throw new LayoutError('layout.name must be a non-empty string');

  if (shapes === undefined) {
    const one = parseArrangement(input, 'layout');
    return { id, name, shapes: { landscape: one, bar: one, portrait: one } };
  }

  if (!isRecord(shapes)) throw new LayoutError('layout.shapes must be an object');
  const given = SHAPES.filter((s) => shapes[s] !== undefined);
  if (!given.length) throw new LayoutError(`layout.shapes needs at least one of ${SHAPES.join(', ')}`);

  const read = Object.fromEntries(given.map((s) => [s, parseArrangement(shapes[s], `shapes.${s}`)])) as Partial<
    Record<Shape, Arrangement>
  >;
  const fallback = read[given[0]] as Arrangement;
  return {
    id,
    name,
    shapes: {
      landscape: read.landscape ?? fallback,
      bar: read.bar ?? fallback,
      portrait: read.portrait ?? fallback,
    },
  };
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
 * Carries an arrangement onto a grid of another size, every edge moving to
 * the same proportion of the new grid.
 *
 * Without this, fewer columns left tiles hanging off the edge, and the next
 * launch threw the stored layout away. Each edge goes through one monotonic
 * mapping, so tiles that met still meet and tiles that did not overlap still
 * do not; only a tile squeezed to nothing is given back one cell.
 */
export function regrid(arrangement: Arrangement, cols: number, rows: number): Arrangement {
  const { cols: fromCols, rows: fromRows } = arrangement.grid;
  const edge = (e: number, from: number, to: number) => Math.round(((e - 1) * to) / from) + 1;
  const span = (start: number, end: number, size: number): [number, number] => {
    if (end > start) return [start, end];
    const last = Math.min(size + 1, start + 1);
    return [last - 1, last];
  };

  const tiles = arrangement.tiles.map((t) => {
    const [r1, r2] = span(edge(t.area[0], fromRows, rows), edge(t.area[2], fromRows, rows), rows);
    const [c1, c2] = span(edge(t.area[1], fromCols, cols), edge(t.area[3], fromCols, cols), cols);
    return { ...t, area: [r1, c1, r2, c2] as Area };
  });

  return { grid: { ...arrangement.grid, cols, rows }, tiles };
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
  arrangement: Arrangement,
  widget: string,
  minOf: (widget: string) => [number, number]
): Tile[] | null {
  const { cols, rows } = arrangement.grid;
  const tiles = arrangement.tiles;
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

/** A new grid size or gap, with the tiles carried along when the size changes. */
export function withGrid(arrangement: Arrangement, grid: Partial<Arrangement['grid']>): Arrangement {
  const cols = grid.cols ?? arrangement.grid.cols;
  const rows = grid.rows ?? arrangement.grid.rows;
  const fitted =
    cols === arrangement.grid.cols && rows === arrangement.grid.rows ? arrangement : regrid(arrangement, cols, rows);
  return { ...fitted, grid: { ...fitted.grid, ...grid } };
}

export function withTiles(arrangement: Arrangement, tiles: Tile[]): Arrangement {
  return { ...arrangement, tiles };
}

export function withTileProp(arrangement: Arrangement, index: number, key: string, value: unknown): Arrangement {
  return withTiles(
    arrangement,
    arrangement.tiles.map((t, i) => (i === index ? { ...t, props: { ...(t.props ?? {}), [key]: value } } : t))
  );
}

/** Only the tile at `index`: an arrangement can hold two of one widget. */
export function withoutTile(arrangement: Arrangement, index: number): Arrangement {
  return withTiles(
    arrangement,
    arrangement.tiles.filter((_, i) => i !== index)
  );
}

/** Non-throwing variant for anything user-supplied. */
export function safeParseLayout(input: unknown): { ok: true; layout: Layout } | { ok: false; reason: string } {
  try {
    return { ok: true, layout: parseLayout(input) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
