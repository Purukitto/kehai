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
  // A tile too wide to leave room is partly under the sheet. Its ring would only
  // show as stray edges round the sheet, so it keeps the dimming and goes unlit.
  const covered = rect !== null && width > room;

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
            boxShadow: covered ? '0 0 0 100vmax rgba(0, 0, 0, 0.62)' : '0 0 0 2px var(--cc-accent), 0 0 0 100vmax rgba(0, 0, 0, 0.62)',
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
          // As tall as what it holds, up to the window, rather than a full-height
          // slab with a few rows at the top of it.
          maxHeight: 'calc(100% - 24px)',
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
            minWidth: 0,
          }}
        >
          <GameIcon path={spec?.game?.source.icon ?? null} color="var(--cc-muted)" />
          <span className="cc-display" style={{ fontSize: 22, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </span>
          <span className="cc-mini" style={{ flex: 'none' }}>
            Options
          </span>
          <div style={{ flex: 1 }} />
          <button className="cc-chip" style={{ padding: '6px 20px' }} onClick={onClose}>
            Done
          </button>
        </div>

        <div
          style={{
            flex: '1 1 auto',
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

        {/* The note and the button share a line where they fit, and the button drops under it where they don't. */}
        <div
          style={{
            minHeight: 52,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 12,
            rowGap: 8,
            padding: '10px 16px 10px 24px',
            borderTop: '1px solid var(--cc-line)',
          }}
        >
          {!inSettings && (
            <span className="cc-mini" style={{ whiteSpace: 'nowrap' }}>
              Also under Settings → Widgets
            </span>
          )}
          <button className="cc-chip" style={{ marginLeft: 'auto' }} onClick={onArrange}>
            Arrange this layout
          </button>
        </div>
      </div>
    </>,
    document.getElementById('root') ?? document.body
  );
}
