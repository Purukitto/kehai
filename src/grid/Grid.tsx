import { HOLD_MS, RING_AFTER_MS, useHold } from '../core/hold';
import { TileSizeProvider } from '../core/TileSize';
import type { Arrangement, WidgetSpec } from '../core/types';
import { registry } from '../widgets/registry';

/** The ring that fills under a finger while a tile is held. */
function HoldRing({ x, y }: { x: number; y: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className="cc-hold-ring"
      width="72"
      height="72"
      viewBox="0 0 72 72"
      style={{ left: x - 36, top: y - 36, ['--cc-hold-c' as string]: c, ['--cc-hold-ms' as string]: `${HOLD_MS - RING_AFTER_MS}ms` }}
    >
      <circle cx="36" cy="36" r={r + 7} fill="var(--cc-bg)" fillOpacity="0.8" />
      <circle cx="36" cy="36" r={r} fill="none" stroke="var(--cc-line-2)" strokeWidth="4" />
      <circle
        className="cc-hold-arc"
        cx="36"
        cy="36"
        r={r}
        fill="none"
        stroke="var(--cc-accent)"
        strokeWidth="4"
        strokeDasharray={c}
        transform="rotate(-90 36 36)"
      />
    </svg>
  );
}

function Tile({
  spec,
  props,
  style,
  onHold,
}: {
  spec: WidgetSpec;
  props: Record<string, unknown>;
  style: React.CSSProperties;
  onHold?: (el: HTMLElement) => void;
}) {
  const { ring, handlers } = useHold((el) => onHold?.(el));
  const Widget = spec.component;
  return (
    <TileSizeProvider style={style} handlers={onHold ? handlers : undefined}>
      <Widget props={props} />
      {ring && <HoldRing x={ring.x} y={ring.y} />}
    </TileSizeProvider>
  );
}

/**
 * Renders one shape of a layout. The gutters are the grid gap showing the page
 * background through, which is why tiles carry no borders of their own.
 *
 * Holding a tile, or right-clicking it, asks for that widget's options.
 */
export function Grid({
  arrangement,
  onHold,
}: {
  arrangement: Arrangement;
  /** The tile's place in the arrangement, and the tile itself. */
  onHold?: (tile: number, el: HTMLElement) => void;
}) {
  return (
    <div
      className="cc-tiles"
      style={{
        height: '100%',
        display: 'grid',
        gridTemplateColumns: `repeat(${arrangement.grid.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${arrangement.grid.rows}, minmax(0, 1fr))`,
        gap: arrangement.grid.gap,
        // Uncovered cells must read as empty, not as gutter.
        background: 'var(--cc-bg)',
      }}
    >
      {arrangement.tiles.map((tile, i) => {
        const spec = registry[tile.widget];
        const [r1, c1, r2, c2] = tile.area;
        const style: React.CSSProperties = {
          gridArea: `${r1} / ${c1} / ${r2} / ${c2}`,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          // Hairline per tile rather than a gutter-coloured backdrop, so the
          // separation survives however sparse the arrangement is.
          boxShadow: '0 0 0 1px var(--cc-line)',
        };

        if (!spec) {
          return (
            <div key={i} style={{ ...style, background: 'var(--cc-pane)', alignItems: 'center', justifyContent: 'center' }}>
              <span className="cc-mini">UNKNOWN WIDGET: {tile.widget}</span>
            </div>
          );
        }

        return (
          <Tile
            key={i}
            spec={spec}
            props={tile.props ?? {}}
            style={style}
            onHold={onHold ? (el) => onHold(i, el) : undefined}
          />
        );
      })}
    </div>
  );
}
