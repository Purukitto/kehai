import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { PRESETS, PRESET_ORDER, useSettings } from '../core/settings';

/** Presets first, then yours in the order they were made: the order a swipe walks. */
function useOrder(): string[] {
  const { settings } = useSettings();
  return [...PRESET_ORDER, ...settings.layouts.map((l) => l.id)];
}

/** Far enough to be meant, and mostly sideways, so a tap or a scroll never switches. */
const SWIPE_PX = 48;

/**
 * Sideways swipes along the header change layout on a touchscreen: left for
 * the next, right for the one before, wrapping at either end.
 *
 * Touch and pen only. A mouse drag on the header moves the window, and a mouse
 * has the button anyway.
 */
export function useLayoutSwipe() {
  const { settings, useLayout } = useSettings();
  const order = useOrder();
  const start = useRef<{ x: number; y: number; id: number } | null>(null);

  const step = (by: number) => {
    const at = Math.max(0, order.indexOf(settings.layoutId));
    useLayout(order[(at + by + order.length) % order.length]);
  };

  return {
    onPointerDown: (e: ReactPointerEvent) => {
      start.current = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY, id: e.pointerId };
    },
    onPointerUp: (e: ReactPointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}

/**
 * The layout on screen, named in the header, and a tap away from any other.
 * The list opens over the panel rather than inside the header, which can be
 * hiding itself at the top edge.
 */
export function LayoutSwitcher({ onManage }: { onManage: () => void }) {
  const { settings, layout, useLayout } = useSettings();
  const order = useOrder();
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAnchor(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anchor]);

  const toggle = () => {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const r = button.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  };

  const choose = (id: string) => {
    useLayout(id);
    setAnchor(null);
  };

  const row = (id: string, name: string, kind: string) => {
    const on = id === settings.layoutId;
    return (
      <button
        key={id}
        onClick={() => choose(id)}
        aria-current={on}
        style={{
          height: 40,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 14px',
          border: 0,
          borderBottom: '1px solid var(--cc-line)',
          background: on ? 'var(--cc-pane-2)' : 'transparent',
          boxShadow: on ? 'inset 2px 0 0 var(--cc-accent)' : 'none',
          color: on ? 'var(--cc-accent)' : 'var(--cc-text)',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 11, letterSpacing: '0.14em', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name.toUpperCase()}
        </span>
        <span className="cc-mini" style={{ fontSize: 9 }}>
          {on ? 'IN USE' : kind}
        </span>
      </button>
    );
  };

  return (
    <>
      <button
        ref={button}
        // Remounts on every change of layout, which replays the flash: a swipe
        // that landed says where it landed.
        key={layout.id}
        className="cc-chip cc-flash"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        title="Change layout. On a touchscreen, swipe along the header."
        onClick={toggle}
        style={{ gap: 7, padding: '0 10px', maxWidth: 220 }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{layout.name.toUpperCase()}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ flex: 'none' }}>
          <path d="M1 2.5h6L4 6Z" />
        </svg>
      </button>
      {anchor &&
        createPortal(
          <>
            <div onClick={() => setAnchor(null)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
            <div
              role="menu"
              style={{
                position: 'fixed',
                top: anchor.top,
                right: anchor.right,
                zIndex: 41,
                width: 260,
                maxHeight: `calc(100vh - ${anchor.top + 12}px)`,
                overflowY: 'auto',
                background: 'var(--cc-pane)',
                border: '1px solid var(--cc-line-2)',
              }}
            >
              {order.map((id) => {
                const preset = PRESETS[id];
                const mine = settings.layouts.find((l) => l.id === id);
                return preset ? row(id, preset.name, 'PRESET') : mine ? row(id, mine.name, 'YOURS') : null;
              })}
              <button
                onClick={() => {
                  setAnchor(null);
                  onManage();
                }}
                style={{
                  height: 40,
                  width: '100%',
                  padding: '0 14px',
                  border: 0,
                  background: 'var(--cc-inset)',
                  color: 'var(--cc-muted)',
                  fontSize: 10,
                  letterSpacing: '0.14em',
                  textAlign: 'left',
                }}
              >
                MANAGE LAYOUTS…
              </button>
            </div>
          </>,
          document.body
        )}
    </>
  );
}
