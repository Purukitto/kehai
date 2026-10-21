import { TileSizeProvider } from '../core/TileSize';
import type { Arrangement } from '../core/types';
import { registry } from '../widgets/registry';

/**
 * Renders one shape of a layout. The gutters are the grid gap showing the page
 * background through, which is why tiles carry no borders of their own.
 */
export function Grid({ arrangement }: { arrangement: Arrangement }) {
  return (
    <div
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

        const Widget = spec.component;
        return (
          <TileSizeProvider key={i} style={style}>
            <Widget props={tile.props ?? {}} />
          </TileSizeProvider>
        );
      })}
    </div>
  );
}
