import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { SHAPES, SHAPE_ASPECT, firstFree, overlaps, withGrid, withTiles, withoutTile } from '../core/layout';
import { PRESETS, findLayout, isPreset, useSettings } from '../core/settings';
import type { Area, Arrangement, Shape, Tile } from '../core/types';
import { registry } from '../widgets/registry';

type Mode = 'move' | 'resize';

interface Drag {
  index: number;
  mode: Mode;
  startX: number;
  startY: number;
  startArea: Area;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Toolbar buttons, sized for a finger as much as a pointer. */
const TOOL: React.CSSProperties = { height: 36, padding: '0 16px' };

function hitList(area: Area, tiles: Tile[], ignore: number): number[] {
  const hits: number[] = [];
  tiles.forEach((t, i) => {
    if (i !== ignore && overlaps(area, t.area)) hits.push(i);
  });
  return hits;
}

/**
 * Packs tiles into the first free space, row-major, keeping their sizes.
 *
 * The escape hatch for a layout that already overlaps: once tiles are stacked,
 * every move out of the pile is itself a collision.
 */
function tidy(tiles: Tile[], cols: number, rows: number): Tile[] {
  const placed: Tile[] = [];

  for (const tile of tiles) {
    const h = tile.area[2] - tile.area[0];
    const w = tile.area[3] - tile.area[1];
    placed.push({ ...tile, area: firstFree(placed, w, h, cols, rows) ?? tile.area });
  }

  return placed;
}

/**
 * Direct manipulation of the layout.
 *
 * Move a tile onto an occupied space and the two swap places — refusing the
 * drop instead would make a full grid impossible to rearrange, since there is
 * nowhere free to stage a tile. Resize grows until it meets a neighbour rather
 * than refusing outright, so dragging a corner always does something.
 *
 * Nothing commits until release: the drag shows a preview, and the swap target
 * is marked while you hold it there.
 *
 * Each shape of the layout is arranged on its own tab. The shape this window
 * shows fills the screen; the others are drawn at their usual proportions, so
 * a bar display can be laid out from a desk monitor.
 */
export function Arranger({
  layoutId,
  initialShape,
  onDone,
}: {
  layoutId: string;
  initialShape: Shape;
  onDone: () => void;
}) {
  const { settings, editArrangement } = useSettings();
  // Follows the copy once the first edit to a preset has made one.
  const [target, setTarget] = useState(layoutId);
  const [shape, setShapeTab] = useState<Shape>(initialShape);
  const layout = findLayout(settings, target) ?? PRESETS.stage;
  const arrangement = layout.shapes[shape];
  const surface = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<Area | null>(null);
  const [selected, setSelected] = useState(0);

  const edit = (fn: (a: Arrangement) => Arrangement) => setTarget(editArrangement(target, shape, fn));
  const setTiles = (next: Tile[]) => edit((a) => withTiles(a, next));
  const setShape = (next: Shape) => {
    setShapeTab(next);
    setSelected(0);
  };

  const tiles = arrangement.tiles;
  const hits = drag && preview ? hitList(preview, tiles, drag.index) : [];
  const swapTarget = drag?.mode === 'move' && hits.length === 1 ? hits[0] : null;
  const blocked = drag?.mode === 'move' && hits.length > 1;

  const begin = useCallback(
    (e: React.PointerEvent, index: number, mode: Mode) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Capture keeps the drag alive when the pointer leaves the tile.
        // Losing it must not lose the drag itself.
      }
      setSelected(index);
      setPreview(tiles[index].area);
      setDrag({ index, mode, startX: e.clientX, startY: e.clientY, startArea: tiles[index].area });
    },
    [tiles]
  );

  const move = useCallback(
    (e: React.PointerEvent) => {
      if (!drag || !surface.current) return;

      const rect = surface.current.getBoundingClientRect();
      const { cols, rows, gap } = arrangement.grid;
      const cellW = (rect.width - gap * (cols - 1)) / cols;
      const cellH = (rect.height - gap * (rows - 1)) / rows;

      const dCol = Math.round((e.clientX - drag.startX) / Math.max(1, cellW + gap));
      const dRow = Math.round((e.clientY - drag.startY) / Math.max(1, cellH + gap));

      const [r1, c1, r2, c2] = drag.startArea;
      const [minCols, minRows] = registry[tiles[drag.index].widget]?.min ?? [1, 1];

      if (drag.mode === 'move') {
        const h = r2 - r1;
        const w = c2 - c1;
        const top = clamp(r1 + dRow, 1, rows + 1 - h);
        const left = clamp(c1 + dCol, 1, cols + 1 - w);
        setPreview([top, left, top + h, left + w]);
        return;
      }

      // Resize: take the largest rectangle the pointer asks for that still
      // clears the neighbours, shrinking edge by edge rather than refusing.
      let bottom = clamp(r2 + dRow, r1 + minRows, rows + 1);
      let right = clamp(c2 + dCol, c1 + minCols, cols + 1);

      while (right > c1 + minCols && hitList([r1, c1, bottom, right], tiles, drag.index).length) {
        right -= 1;
      }
      while (bottom > r1 + minRows && hitList([r1, c1, bottom, right], tiles, drag.index).length) {
        bottom -= 1;
      }

      setPreview([r1, c1, bottom, right]);
    },
    [drag, arrangement.grid, tiles]
  );

  const end = useCallback(() => {
    if (!drag || !preview) {
      setDrag(null);
      setPreview(null);
      return;
    }

    const next = tiles.map((t) => ({ ...t }));
    // A tap to select, or a drag that came back where it started, changes
    // nothing and must save nothing: on a preset, saving makes a copy.
    const moved = preview.some((edge, k) => edge !== drag.startArea[k]);

    if (drag.mode === 'move' && swapTarget !== null) {
      next[drag.index].area = tiles[swapTarget].area;
      next[swapTarget].area = drag.startArea;
      setTiles(next);
    } else if (moved && !hits.length) {
      next[drag.index].area = preview;
      setTiles(next);
    }
    // More than one tile underneath: no sensible swap, so the drag is dropped.

    setDrag(null);
    setPreview(null);
  }, [drag, preview, hits.length, swapTarget, tiles, setTiles]);

  const current = tiles[selected];
  const spec = current ? registry[current.widget] : undefined;
  const tangled = tiles.some((t, i) => hitList(t.area, tiles, i).length > 0);

  // The room the surface has, so a shape other than this window's can be
  // drawn at its own proportions inside it.
  const frame = useRef<HTMLDivElement | null>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setRoom({ w: Math.round(box.width), h: Math.round(box.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const aspect = SHAPE_ASPECT[shape];
  const fitted = Math.min(room.w, room.h * aspect);
  const surfaceSize =
    shape === initialShape || !room.w
      ? { width: '100%', height: '100%' }
      : { width: fitted, height: fitted / aspect };

  const stepper = (label: string, value: number, change: (v: number) => void) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className="cc-mini">{label}</span>
      <button className="cc-chip" style={{ width: 40, height: 36 }} onClick={() => change(Math.max(2, value - 1))}>
        −
      </button>
      <span style={{ fontSize: 12, width: 22, textAlign: 'center' }}>{value}</span>
      <button className="cc-chip" style={{ width: 40, height: 36 }} onClick={() => change(Math.min(24, value + 1))}>
        +
      </button>
    </div>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--cc-bg)' }}>
      <div
        style={{
          height: 48,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 16px',
          background: 'var(--cc-pane)',
          borderBottom: '1px solid var(--cc-line)',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.16em', color: 'var(--cc-accent)' }}>
          ARRANGE {layout.name.toUpperCase()}
        </span>
        <span className="cc-mini">
          {swapTarget !== null
            ? 'RELEASE TO SWAP'
            : blocked
              ? 'COVERS MORE THAN ONE TILE'
              : isPreset(target)
                ? 'A PRESET: YOUR FIRST CHANGE MAKES A COPY UNDER YOURS'
                : 'DRAG TO MOVE OR SWAP · CORNER TO RESIZE'}
        </span>
        {tangled && !drag && (
          <span className="cc-mini" style={{ color: 'var(--cc-danger)' }}>
            TILES OVERLAP
          </span>
        )}
        <div style={{ flex: 1 }} />
        {current && (
          <span className="cc-mini">
            {(registry[current.widget]?.name ?? current.widget).toUpperCase()} · {current.area[3] - current.area[1]}x
            {current.area[2] - current.area[0]}
            {spec ? ` · MIN ${spec.min[0]}x${spec.min[1]}` : ''}
          </span>
        )}
        {current && (
          // Only the selected tile: a layout can hold two of one widget, and
          // removing by kind took both.
          <button
            className="cc-chip"
            style={TOOL}
            onClick={() => {
              edit((a) => withoutTile(a, selected));
              setSelected(0);
            }}
          >
            REMOVE
          </button>
        )}
        <button
          className="cc-chip"
          style={TOOL}
          onClick={() => setTiles(tidy(tiles, arrangement.grid.cols, arrangement.grid.rows))}
          title="Pack tiles into free space, keeping their sizes"
        >
          TIDY
        </button>
        <button className="cc-chip cc-chip-on" style={TOOL} onClick={onDone}>
          DONE
        </button>
      </div>

      <div
        ref={frame}
        style={{ flex: 1, minHeight: 0, margin: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <div
          ref={surface}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          style={{
            ...surfaceSize,
            flex: 'none',
            display: 'grid',
            gridTemplateColumns: `repeat(${arrangement.grid.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${arrangement.grid.rows}, minmax(0, 1fr))`,
            gap: arrangement.grid.gap,
            // The cell lattice, so you can see what you are snapping to.
            backgroundImage:
              'repeating-linear-gradient(0deg, var(--cc-line) 0 1px, transparent 1px 100%), repeating-linear-gradient(90deg, var(--cc-line) 0 1px, transparent 1px 100%)',
            backgroundSize: `calc(100% / ${arrangement.grid.cols}) calc(100% / ${arrangement.grid.rows})`,
          }}
        >
          {tiles.map((tile, i) => {
            const dragging = drag?.index === i;
            const area = dragging && preview ? preview : tile.area;
            const [r1, c1, r2, c2] = area;
            const isSwap = swapTarget === i;
            const active = i === selected;

            const border = dragging && blocked
              ? 'var(--cc-danger)'
              : isSwap
                ? 'var(--cc-accent-2)'
                : active
                  ? 'var(--cc-accent)'
                  : 'var(--cc-line-2)';

            return (
              <div
                key={i}
                onPointerDown={(e) => begin(e, i, 'move')}
                style={{
                  gridArea: `${r1} / ${c1} / ${r2} / ${c2}`,
                  position: 'relative',
                  zIndex: dragging ? 5 : isSwap ? 2 : 1,
                  background: 'var(--cc-pane)',
                  border: `1px ${isSwap ? 'dashed' : 'solid'} ${border}`,
                  opacity: dragging ? 0.92 : 1,
                  cursor: dragging && drag.mode === 'move' ? 'grabbing' : 'grab',
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 0,
                  minHeight: 0,
                  touchAction: 'none',
                  userSelect: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', minWidth: 0 }}>
                  <svg width="9" height="11" viewBox="0 0 9 11" fill={active ? 'var(--cc-accent)' : 'var(--cc-line-2)'}>
                    <circle cx="1.6" cy="1.6" r="1.1" />
                    <circle cx="7.4" cy="1.6" r="1.1" />
                    <circle cx="1.6" cy="5.5" r="1.1" />
                    <circle cx="7.4" cy="5.5" r="1.1" />
                    <circle cx="1.6" cy="9.4" r="1.1" />
                    <circle cx="7.4" cy="9.4" r="1.1" />
                  </svg>
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: '0.14em',
                      color: active ? 'var(--cc-accent)' : 'var(--cc-muted)',
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {(registry[tile.widget]?.name ?? tile.widget).toUpperCase()}
                  </span>
                  <span className="cc-mini" style={{ fontSize: 9 }}>
                    {c2 - c1}x{r2 - r1}
                  </span>
                </div>

                {isSwap && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      color: 'var(--cc-accent-2)',
                      pointerEvents: 'none',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 5h9l-2.5-2.5M14 11H5l2.5 2.5" />
                    </svg>
                    <span style={{ fontSize: 10, letterSpacing: '0.18em' }}>SWAP</span>
                  </div>
                )}

                {/* A fingertip-sized corner around a small mark: the mark shows where
                    to grab, the corner is what takes the grab. */}
                <div
                  onPointerDown={(e) => begin(e, i, 'resize')}
                  title="Resize"
                  aria-label="Resize"
                  style={{
                    position: 'absolute',
                    right: -1,
                    bottom: -1,
                    width: 40,
                    height: 40,
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'flex-end',
                    cursor: 'nwse-resize',
                    touchAction: 'none',
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      background: active ? 'var(--cc-accent)' : 'var(--cc-line-2)',
                      clipPath: 'polygon(100% 0, 100% 100%, 0 100%)',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          height: 52,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          padding: '0 16px',
          background: 'var(--cc-pane)',
          borderTop: '1px solid var(--cc-line)',
        }}
      >
        <div style={{ display: 'flex' }}>
          {SHAPES.map((s) => (
            <button
              key={s}
              className={s === shape ? 'cc-chip cc-chip-on' : 'cc-chip'}
              style={{ height: 36, padding: '0 14px', marginLeft: -1 }}
              onClick={() => setShape(s)}
              title={s === initialShape ? 'The shape this window shows' : undefined}
            >
              {s.toUpperCase()}
              {s === initialShape ? ' · HERE' : ''}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {stepper('COLUMNS', arrangement.grid.cols, (cols) => edit((a) => withGrid(a, { cols })))}
        {stepper('ROWS', arrangement.grid.rows, (rows) => edit((a) => withGrid(a, { rows })))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="cc-mini">GAP</span>
          <div style={{ display: 'flex' }}>
            {[0, 1, 2, 4].map((gap) => (
              <button
                key={gap}
                className={gap === arrangement.grid.gap ? 'cc-chip cc-chip-on' : 'cc-chip'}
                style={{ width: 40, height: 36, marginLeft: -1 }}
                onClick={() => edit((a) => withGrid(a, { gap }))}
              >
                {gap}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
