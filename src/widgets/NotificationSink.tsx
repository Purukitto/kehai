import { useMemo, useState } from 'react';
import { bus } from '../core/bus';
import { p2 } from '../core/format';
import { useTileSize } from '../core/TileSize';
import { useTopic } from '../core/useTopic';
import type { NotifyItem, NotifyPayload } from '../core/payloads';
import type { WidgetProps, WidgetSpec } from '../core/types';
import { Pane } from './chrome';

const PALETTE = ['var(--cc-accent)', 'var(--cc-accent-2)', 'var(--cc-ok)', 'var(--cc-muted)'];

/** Stable colour per source, so an app keeps its tag colour between polls. */
function sourceColor(source: string): string {
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) hash = (hash * 31 + source.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function shortSource(source: string): string {
  return source.replace(/\s+/g, ' ').trim().slice(0, 10).toUpperCase();
}

function timeOf(atMs: number): string {
  if (!atMs) return '--:--';
  const d = new Date(atMs);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

function dismiss(id: number) {
  bus.publish('notify:command', 'widget.notify', { action: 'dismiss', id });
}

function Row({ item, dense }: { item: NotifyItem; dense: boolean }) {
  const color = sourceColor(item.source);
  return (
    <div
      className="cc-notify-row"
      style={{
        flex: 'none',
        padding: dense ? '5px 10px 6px 8px' : '7px 12px 8px 10px',
        borderBottom: '1px solid var(--cc-line)',
        borderLeft: '2px solid transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span className="cc-mini" style={{ flex: 'none' }}>{timeOf(item.atMs)}</span>
        <span
          style={{
            fontSize: 9,
            letterSpacing: '0.1em',
            padding: '1px 5px',
            border: '1px solid currentColor',
            color,
            flex: 'none',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 96,
          }}
        >
          {shortSource(item.source)}
        </span>
        <div style={{ flex: 1 }} />
        <button
          className="cc-dismiss"
          onClick={() => dismiss(item.id)}
          aria-label="Dismiss"
          title="Dismiss — also clears it from the system tray"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <div
        style={{
          fontSize: dense ? 11 : 12,
          color: 'var(--cc-text)',
          marginTop: 3,
          lineHeight: 1.35,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {item.title || item.body || '(no text)'}
      </div>
      {!dense && item.body && item.title && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--cc-muted)',
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.body}
        </div>
      )}
    </div>
  );
}

function NotificationSink(_: WidgetProps) {
  const feed = useTopic<NotifyPayload>('sys:notify');
  const size = useTileSize();
  const [filter, setFilter] = useState('ALL');

  const sources = useMemo(() => {
    const names = new Set((feed?.items ?? []).map((i) => shortSource(i.source)));
    return ['ALL', ...[...names].sort().slice(0, 4)];
  }, [feed]);

  if (!feed) {
    return (
      <Pane label="NOTIFICATIONS">
        <span className="cc-mini">AWAITING FIRST EVENT</span>
      </Pane>
    );
  }

  // A refused listener must not look like a quiet day.
  if (!feed.available) {
    return (
      <Pane label="NOTIFICATIONS">
        <div style={{ margin: 'auto', textAlign: 'center', padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--cc-danger)' }}>LISTENER UNAVAILABLE</div>
          <div className="cc-mini" style={{ marginTop: 8, lineHeight: 1.6 }}>{feed.reason}</div>
        </div>
      </Pane>
    );
  }

  const visible = feed.items.filter((i) => filter === 'ALL' || shortSource(i.source) === filter);
  const dense = size.h < 320;

  return (
    <Pane label="NOTIFICATIONS" padded={false}>
      {size.h > 220 && sources.length > 1 && (
        <div
          style={{
            flex: 'none',
            display: 'flex',
            gap: 4,
            padding: '8px 10px',
            borderBottom: '1px solid var(--cc-line)',
            background: 'var(--cc-inset)',
            overflow: 'hidden',
          }}
        >
          {sources.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={filter === s ? 'cc-chip cc-chip-on' : 'cc-chip'}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {visible.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center' }}>
            <span className="cc-mini" style={{ color: 'var(--cc-line-2)' }}>NOTHING WAITING</span>
          </div>
        ) : (
          visible.map((item) => <Row key={item.id + ':' + item.atMs} item={item} dense={dense} />)
        )}
      </div>

      <div
        style={{
          flex: 'none',
          height: 26,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px',
          background: 'var(--cc-inset)',
          borderTop: '1px solid var(--cc-line)',
        }}
      >
        <span className="cc-mini">{feed.items.length} IN TRAY</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {filter !== 'ALL' && <span className="cc-mini" style={{ color: 'var(--cc-accent)' }}>FILTERED</span>}
          {feed.items.length > 0 && (
            <button
              className="cc-chip"
              style={{ padding: '2px 7px' }}
              onClick={() => bus.publish('notify:command', 'widget.notify', { action: 'clear' })}
              title="Dismiss everything, here and in the system tray"
            >
              CLEAR ALL
            </button>
          )}
        </div>
      </div>
    </Pane>
  );
}

export const notifySpec: WidgetSpec = {
  title: 'Notifications',
  about: 'Notifications from your apps, filterable, dismissed with a tap.',
  min: [2, 3],
  topics: ['sys:notify'],
  component: NotificationSink,
};
