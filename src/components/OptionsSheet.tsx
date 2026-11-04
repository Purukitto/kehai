import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { registry, useRegistry } from '../widgets/registry';
import { GameIcon } from './GameSetup';

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
  // Widgets from the folder join after the first render.
  useRegistry();
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
            borderRadius: 20,
            boxShadow: '0 0 0 2px var(--cc-accent), 0 0 0 100vmax rgba(0, 0, 0, 0.62)',
          }}
        />
      )}
      <div
        role="dialog"
        aria-label={`${name} options`}
        className="cc-glass"
        style={{
          position: 'fixed',
          top: 12,
          bottom: 12,
          [onLeft ? 'left' : 'right']: 12,
          width: width - 12,
          zIndex: 52,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 24,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: 56,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 16px 0 24px',
            borderBottom: '1px solid var(--cc-line)',
          }}
        >
          <GameIcon path={spec?.game?.source.icon ?? null} color="var(--cc-muted)" />
          <span className="cc-display" style={{ fontSize: 22 }}>{name}</span>
          <span className="cc-mini">Options</span>
          <div style={{ flex: 1 }} />
          <button className="cc-chip" style={{ padding: '6px 20px' }} onClick={onClose}>
            Done
          </button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '0 24px 16px',
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--cc-line-2) transparent',
          }}
        >
          {Options ? (
            <Options tile={held.tile} />
          ) : (
            <div style={{ padding: '24px 0', fontSize: 13, lineHeight: 1.6, color: 'var(--cc-muted)' }}>
              Nothing to set for {name}.
            </div>
          )}
        </div>

        <div
          style={{
            height: 52,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 16px 0 24px',
            borderTop: '1px solid var(--cc-line)',
          }}
        >
          {!inSettings && <span className="cc-mini">Also under Settings → Widgets</span>}
          <div style={{ flex: 1 }} />
          <button className="cc-chip" onClick={onArrange}>
            Arrange this layout
          </button>
        </div>
      </div>
    </>,
    document.getElementById('root') ?? document.body
  );
}
