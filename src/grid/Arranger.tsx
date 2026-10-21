import { useCallback, useRef, useState } from 'react';
import { firstFree, overlaps } from '../core/layout';
import { useSettings } from '../core/settings';
import type { Area, Tile } from '../core/types';
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
 */
export function Arranger({ onDone }: { onDone: () => void }) {
  const { settings, setTiles, removeTile } = useSettings();
  const layout = settings.layout;
  const surface = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<Area | null>(null);
  const [selected, setSelected] = useState(0);

  const tiles = layout.tiles;
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
      const { cols, rows, gap } = layout.grid;
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
    [drag, layout.grid, tiles]
  );

  const end = useCallback(() => {
    if (!drag || !preview) {
      setDrag(null);
      setPreview(null);
      return;
    }

    const next = tiles.map((t) => ({ ...t }));

    if (drag.mode === 'move' && swapTarget !== null) {
      next[drag.index].area = tiles[swapTarget].area;
      next[swapTarget].area = drag.startArea;
      setTiles(next);
    } else if (!hits.length) {
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

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--cc-bg)' }}>
      <div
        style={{
          height: 34,
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
          ARRANGE TILES
        </span>
        <span className="cc-mini">
          {swapTarget !== null
            ? 'RELEASE TO SWAP'
            : blocked
              ? 'COVERS MORE THAN ONE TILE'
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
            {current.widget.toUpperCase()} · {current.area[3] - current.area[1]}x
            {current.area[2] - current.area[0]}
            {spec ? ` · MIN ${spec.min[0]}x${spec.min[1]}` : ''}
          </span>
        )}
        {current && (
          // Only the selected tile: a layout can hold two of one widget, and
          // removing by kind took both.
          <button
            className="cc-chip"
            onClick={() => {
              removeTile(selected);
              setSelected(0);
            }}
          >
            REMOVE
          </button>
        )}
        <button
          className="cc-chip"
          onClick={() => setTiles(tidy(tiles, layout.grid.cols, layout.grid.rows))}
          title="Pack tiles into free space, keeping their sizes"
        >
          TIDY
        </button>
        <button className="cc-chip cc-chip-on" onClick={onDone}>
          DONE
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: 16 }}>
        <div
          ref={surface}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          style={{
            height: '100%',
            display: 'grid',
            gridTemplateColumns: `repeat(${layout.grid.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${layout.grid.rows}, minmax(0, 1fr))`,
            gap: layout.grid.gap,
            // The cell lattice, so you can see what you are snapping to.
            backgroundImage:
              'repeating-linear-gradient(0deg, var(--cc-line) 0 1px, transparent 1px 100%), repeating-linear-gradient(90deg, var(--cc-line) 0 1px, transparent 1px 100%)',
            backgroundSize: `calc(100% / ${layout.grid.cols}) calc(100% / ${layout.grid.rows})`,
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
                    {tile.widget.toUpperCase()}
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

                <div
                  onPointerDown={(e) => begin(e, i, 'resize')}
                  title="Resize"
                  style={{
                    position: 'absolute',
                    right: -1,
                    bottom: -1,
                    width: 18,
                    height: 18,
                    background: active ? 'var(--cc-accent)' : 'var(--cc-line-2)',
                    cursor: 'nwse-resize',
                    touchAction: 'none',
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
