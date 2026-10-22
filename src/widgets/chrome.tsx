import type { ReactNode } from 'react';

/**
 * The shell every tile shares: pane background, optional header, no radius.
 * The header names what the tile shows; which bus topic feeds it is for the
 * code, not for the panel.
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
            height: 26,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
            background: 'var(--cc-pane-2)',
            borderBottom: '1px solid var(--cc-line)',
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.15em' }}>{label}</span>
          <div style={{ flex: 1 }} />
          {right}
        </div>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: padded ? 18 : 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Segmented meter. The gradient overlay punches the terminal-block gaps. */
export function Meter({ pct, color, height = 12 }: { pct: number; color: string; height?: number }) {
  return (
    <div
      style={{
        position: 'relative',
        height,
        background: 'var(--cc-inset)',
        border: '1px solid var(--cc-line)',
        flex: 'none',
      }}
    >
      <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'repeating-linear-gradient(90deg, transparent 0 5px, var(--cc-pane) 5px 6px)',
        }}
      />
    </div>
  );
}

export function Awaiting({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center', flex: 1 }}>
      <span className="cc-label">{label}</span>
      <span style={{ fontSize: 30, fontWeight: 200, color: 'var(--cc-line-2)' }}>--</span>
      <span className="cc-mini" style={{ fontSize: 10 }}>AWAITING FIRST EVENT</span>
    </div>
  );
}
