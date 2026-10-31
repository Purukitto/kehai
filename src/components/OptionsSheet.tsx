import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { registry } from '../widgets/registry';

/** Which widget's options are open, and the tile they were opened from. */
export interface Held {
  widget: string;
  /** The tile's place in the arrangement on screen, or null when it is not on screen. */
  tile: number | null;
  /** Where the tile is, to keep it lit beside the sheet. Null from Settings. */
  rect: DOMRect | null;
}

const SHEET_W = 620;
/** Narrower than this, it covers part of the tile rather than squeeze its rows. */
const SHEET_MIN = 360;

/**
 * One widget's options, beside the tile they were opened from.
 *
 * The rest of the panel dims and the tile stays lit, so a change shows on it as
 * it is made, and the sheet opens on the side away from it. From Settings there
 * is no tile, and it opens on the right.
 */
export function OptionsSheet({
  held,
  onClose,
  onArrange,
  inSettings = false,
}: {
  held: Held;
  onClose: () => void;
  onArrange: () => void;
  inSettings?: boolean;
}) {
  const spec = registry[held.widget];
  const Options = spec?.options;
  const name = spec?.name ?? held.widget;
  const rect = held.rect;
  const onLeft = rect !== null && rect.left + rect.width / 2 > window.innerWidth / 2;
  // As wide as the room beside the tile allows, so the tile stays in view.
  const room = rect === null ? SHEET_W : onLeft ? rect.left : window.innerWidth - rect.right;
  const width = Math.min(window.innerWidth, Math.max(SHEET_MIN, Math.min(SHEET_W, room)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 50, background: rect ? 'transparent' : 'rgba(0, 0, 0, 0.62)' }}
      />
      {rect && (
        <div
          style={{
            position: 'fixed',
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            zIndex: 51,
            pointerEvents: 'none',
            boxShadow: '0 0 0 2px var(--cc-accent), 0 0 0 100vmax rgba(0, 0, 0, 0.62)',
          }}
        />
      )}
      <div
        role="dialog"
        aria-label={`${name} options`}
        style={{
          position: 'fixed',
          top: 0,
          bottom: 0,
          [onLeft ? 'left' : 'right']: 0,
          width,
          zIndex: 52,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--cc-pane-2)',
          [onLeft ? 'borderRight' : 'borderLeft']: '1px solid var(--cc-line-2)',
        }}
      >
        <div
          style={{
            height: 52,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            padding: '0 20px',
            borderBottom: '1px solid var(--cc-line)',
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.2em' }}>{name.toUpperCase()}</span>
          <span className="cc-label">OPTIONS</span>
          <div style={{ flex: 1 }} />
          <button className="cc-chip cc-chip-on" style={{ padding: '8px 22px' }} onClick={onClose}>
            DONE
          </button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '4px 20px 16px',
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--cc-line-2) transparent',
          }}
        >
          {Options ? (
            <Options tile={held.tile} />
          ) : (
            <div style={{ padding: '22px 0', fontSize: 12, lineHeight: 1.6, color: 'var(--cc-muted)' }}>
              Nothing to set for {name}.
            </div>
          )}
        </div>

        <div
          style={{
            height: 46,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 20px',
            borderTop: '1px solid var(--cc-line)',
            background: 'var(--cc-inset)',
          }}
        >
          {!inSettings && <span className="cc-mini">ALSO UNDER SETTINGS → WIDGETS</span>}
          <div style={{ flex: 1 }} />
          <button className="cc-chip" style={{ padding: '7px 13px' }} onClick={onArrange}>
            ARRANGE THIS LAYOUT
          </button>
        </div>
      </div>
    </>,
    document.getElementById('root') ?? document.body
  );
}
