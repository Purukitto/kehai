import type { ReactNode } from 'react';

/**
 * The shell every tile shares: pane background and an optional title. The
 * title names what the tile shows, quietly, in the corner; which bus topic
 * feeds it is for the code, not for the panel. A tile whose content says what
 * it is, a clock, goes without one.
 */
export function Pane({
  label,
  right,
  children,
  padded = true,
}: {
  label?: string;
  right?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <div
      style={{
        // Fill the tile. Without this the pane is only as tall as its content
        // and the rest of the cell shows the grid background through.
        flex: 1,
        background: 'var(--cc-pane)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {label && (
        <div
          style={{
            height: HEADER,
            flex: 'none',
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            padding: '0 16px',
            minWidth: 0,
          }}
        >
          <span className="cc-label" style={{ whiteSpace: 'nowrap' }}>{label}</span>
          <div style={{ flex: 1 }} />
          <span className="cc-mini" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {right}
          </span>
        </div>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: padded ? 16 : 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** How tall a pane's title is, for a tile that works out what fits under it. */
export const HEADER = 28;

/** A plain bar: how much of something there is. */
export function Meter({ pct, color, height = 4 }: { pct: number; color: string; height?: number }) {
  return (
    <div style={{ height, background: 'var(--cc-line)', borderRadius: height / 2, overflow: 'hidden', flex: 'none' }}>
      <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, background: color, borderRadius: height / 2 }} />
    </div>
  );
}

export function Awaiting({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center', flex: 1 }}>
      <span className="cc-label">{label}</span>
      <span style={{ fontSize: 30, fontWeight: 300, color: 'var(--cc-line-2)' }}>--</span>
      <span className="cc-mini">Nothing heard yet</span>
    </div>
  );
}
