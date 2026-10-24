import { useLayoutEffect, useRef, useState } from 'react';
import type { DisplayInfo } from '../core/payloads';

/** What a display is called on the panel: its own name, or its number. */
export function displayLabel(d: { name: string | null; number: number | null }): string {
  return d.name ? d.name.toUpperCase() : `DISPLAY ${d.number ?? '?'}`;
}

/** Margin around the arrangement inside the map. */
const PAD = 20;

/**
 * The displays as the system arranges them, at their real proportions, each
 * one a button. `chosen` is outlined in the accent. `current` is where Kehai
 * is now, and a window that does not fill its display is drawn inside it.
 *
 * Everything about a display is written inside its own rectangle: displays
 * stacked one above another leave no room between them for a caption.
 */
export function DisplayMap({
  displays,
  chosen,
  current,
  filled,
  hint,
  height,
  onPick,
}: {
  displays: DisplayInfo[];
  chosen: string | null;
  current: string | null;
  filled: boolean;
  /** A tag for the chosen display, such as why it was picked. */
  hint?: string;
  height: number;
  onPick?: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Measured before the first paint, so the map never flashes empty.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const left = Math.min(...displays.map((d) => d.x));
  const top = Math.min(...displays.map((d) => d.y));
  const spanW = Math.max(...displays.map((d) => d.x + d.width)) - left;
  const spanH = Math.max(...displays.map((d) => d.y + d.height)) - top;
  const k = displays.length && width ? Math.min((width - PAD * 2) / spanW, (height - PAD * 2) / spanH) : 0;
  const ox = (width - spanW * k) / 2;
  const oy = (height - spanH * k) / 2;

  return (
    <div
      ref={box}
      style={{
        position: 'relative',
        height,
        flex: 'none',
        background: 'var(--cc-inset)',
        border: '1px solid var(--cc-line)',
        overflow: 'hidden',
      }}
    >
      {k > 0 &&
        displays.map((d) => {
          const x = ox + (d.x - left) * k + 3;
          const y = oy + (d.y - top) * k + 3;
          const w = d.width * k - 6;
          const h = d.height * k - 6;
          const on = d.id === chosen;
          const here = d.id === current;
          // What fits, from the most to the least needed: the number, the
          // tags, then the name and size.
          const roomy = h >= 90 && w >= 150;
          const tags = h >= 50 && w >= 90;
          const digits = Math.max(16, Math.min(56, h * (roomy ? 0.32 : tags ? 0.34 : 0.5)));
          const marker = here && !filled && w >= 220 && h >= 130;
          const label = `${displayLabel(d)}, ${d.width} by ${d.height}${d.primary ? ', main display' : ''}${here ? ', Kehai is here' : ''}`;
          return (
            <button
              key={d.id}
              onClick={onPick ? () => onPick(d.id) : undefined}
              disabled={!onPick}
              aria-pressed={on}
              aria-label={label}
              title={label}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: w,
                height: h,
                background: on ? 'var(--cc-pane-2)' : 'var(--cc-pane)',
                border: on ? '2px solid var(--cc-accent)' : '1px solid var(--cc-line-2)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                cursor: onPick ? 'pointer' : 'default',
                padding: '4px 6px',
                overflow: 'hidden',
              }}
            >
              {marker && (
                <span
                  style={{
                    position: 'absolute',
                    left: 8,
                    top: 8,
                    width: Math.min(64, w * 0.25),
                    height: Math.min(40, h * 0.2),
                    border: `1px solid ${on ? 'var(--cc-accent)' : 'var(--cc-text)'}`,
                    background: 'var(--cc-bg)',
                  }}
                />
              )}
              <span style={{ fontSize: digits, fontWeight: 200, lineHeight: 0.9, color: on ? 'var(--cc-accent)' : 'var(--cc-muted)' }}>
                {d.number}
              </span>
              {roomy && (
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    color: on ? 'var(--cc-text)' : 'var(--cc-muted)',
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {d.name ? `${displayLabel(d)} · ` : ''}
                  {d.width} × {d.height}
                </span>
              )}
              {tags && (d.primary || here || (on && hint)) && (
                <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {d.primary && <Tag color="var(--cc-muted)">MAIN</Tag>}
                  {here && <Tag color={on ? 'var(--cc-accent)' : 'var(--cc-text)'}>KEHAI IS HERE</Tag>}
                  {on && hint && <Tag color="var(--cc-accent-2)">{hint}</Tag>}
                </span>
              )}
            </button>
          );
        })}
    </div>
  );
}

function Tag({ color, children }: { color: string; children: string }) {
  return (
    <span style={{ fontSize: 9, letterSpacing: '0.1em', padding: '2px 6px', border: '1px solid currentColor', color, flex: 'none' }}>
      {children}
    </span>
  );
}
