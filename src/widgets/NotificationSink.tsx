import { useMemo, useState } from 'react';
import { bus } from '../core/bus';
import { mmss, p2 } from '../core/format';
import { useHideText } from '../core/quiet';
import { REMOTE_PANEL } from '../core/remoteSource';
import { useSettings } from '../core/settings';
import { useTileSize } from '../core/TileSize';
import { useTopic } from '../core/useTopic';
import type { NotifyCommand, NotifyItem, NotifyPayload, SprintPayload } from '../core/payloads';
import type { WidgetProps } from '../core/types';
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

function clear(ids: number[]) {
  bus.publish<NotifyCommand>('notify:command', 'widget.notify', { action: 'clear', ids });
}

/**
 * One row on the tile: a notification, or every one from an app set to show
 * its name only, as one row with how many.
 */
interface Line {
  key: string;
  app: string;
  source: string;
  atMs: number;
  /** Everything the row stands for, which its dismiss clears. */
  ids: number[];
  item: NotifyItem | null;
}

/** Newest first, as the items come. A name-only app's row sits where its newest one would. */
function lines(items: NotifyItem[]): Line[] {
  const out: Line[] = [];
  const grouped = new Map<string, Line>();
  for (const item of items) {
    if (!item.nameOnly) {
      out.push({ key: `${item.id}:${item.atMs}`, app: item.app, source: item.source, atMs: item.atMs, ids: [item.id], item });
      continue;
    }
    const group = grouped.get(item.app);
    if (group) {
      group.ids.push(item.id);
      continue;
    }
    const line = { key: `app:${item.app}`, app: item.app, source: item.source, atMs: item.atMs, ids: [item.id], item: null };
    grouped.set(item.app, line);
    out.push(line);
  }
  return out;
}

function Row({ line, dense }: { line: Line; dense: boolean }) {
  const color = sourceColor(line.source);
  const item = line.item;
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
        <span className="cc-mini" style={{ flex: 'none' }}>{timeOf(line.atMs)}</span>
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
          {shortSource(line.source)}
        </span>
        <div style={{ flex: 1 }} />
        <button
          className="cc-dismiss"
          onClick={() => clear(line.ids)}
          aria-label="Dismiss"
          title={item ? 'Dismiss — also clears it from the system tray' : 'Dismiss them all — also clears them from the system tray'}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      {item ? (
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
      ) : (
        <div style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--cc-muted)', marginTop: 4 }}>
          {line.ids.length} NEW
          {!dense && (
            <span className="cc-mini" style={{ letterSpacing: '0.06em', marginLeft: 10 }}>
              WHAT THEY SAY ISN’T SHOWN
            </span>
          )}
        </div>
      )}
      {!dense && item && item.body && item.title && (
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

/** How many, and from how many apps, while a focus block holds the list back. */
function Count({ items, why }: { items: NotifyItem[]; why: string }) {
  const size = useTileSize();
  const apps = new Set(items.map((i) => i.app)).size;
  return (
    <div style={{ margin: 'auto', textAlign: 'center', padding: 16 }}>
      <div style={{ fontSize: Math.max(28, Math.min(96, size.h * 0.28)), fontWeight: 200, lineHeight: 1, color: 'var(--cc-text)' }}>
        {items.length}
      </div>
      <div className="cc-label" style={{ marginTop: 12, color: 'var(--cc-muted)' }}>
        {items.length === 0 ? 'NOTHING WAITING' : `WAITING, FROM ${apps} ${apps === 1 ? 'APP' : 'APPS'}`}
      </div>
      <div className="cc-mini" style={{ marginTop: 8 }}>
        {why}
      </div>
    </div>
  );
}

export function NotificationSink(_: WidgetProps) {
  const { settings, allowNotifications } = useSettings();
  const feed = useTopic<NotifyPayload>('sys:notify');
  const sprint = useTopic<SprintPayload>('flow:pomodoro');
  const size = useTileSize();
  const hideText = useHideText();
  // An app's id, or ALL.
  const [filter, setFilter] = useState('ALL');

  const chips = useMemo(() => {
    const names = new Map<string, string>();
    for (const i of feed?.items ?? []) if (!names.has(i.app)) names.set(i.app, shortSource(i.source));
    return [...names].sort((a, b) => a[1].localeCompare(b[1])).slice(0, 4);
  }, [feed]);

  if (!feed) {
    return (
      <Pane label="NOTIFICATIONS">
        <span className="cc-mini">AWAITING FIRST EVENT</span>
      </Pane>
    );
  }

  // Not refused, just not asked: a quiet tile with the one button that asks.
  // A remote panel cannot give the host's go-ahead, so it only says so.
  if (feed.pending) {
    return (
      <Pane label="NOTIFICATIONS">
        <div style={{ margin: 'auto', textAlign: 'center', padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--cc-muted)' }}>NOT ALLOWED YET</div>
          <div className="cc-mini" style={{ marginTop: 8, lineHeight: 1.6 }}>
            {REMOTE_PANEL ? 'Allow it on the machine Kehai runs on.' : 'Kehai reads none of them until you allow it.'}
          </div>
          {!REMOTE_PANEL && (
            <button className="cc-chip cc-chip-on" style={{ marginTop: 12, padding: '7px 16px' }} onClick={allowNotifications}>
              ALLOW
            </button>
          )}
        </div>
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

  // The host shows remote panels none of them, and this is one.
  if (feed.withheld) {
    return (
      <Pane label="NOTIFICATIONS">
        <div style={{ margin: 'auto', textAlign: 'center', padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--cc-muted)' }}>KEPT ON THE PC</div>
          <div className="cc-mini" style={{ marginTop: 8, lineHeight: 1.6 }}>
            The PC shows remote panels none of its notifications.
          </div>
        </div>
      </Pane>
    );
  }

  const focusing = settings.notify.quietFocus && sprint?.state === 'running' && sprint.mode === 'focus';
  if (focusing && !hideText) {
    return (
      <Pane label="NOTIFICATIONS" right={<span className="cc-mini" style={{ color: 'var(--cc-accent)' }}>FOCUSING</span>}>
        <Count items={feed.items} why={`THE LIST COMES BACK AT THE BREAK, IN ${mmss(sprint.remainingSec)}`} />
      </Pane>
    );
  }

  // Nobody is at the desk: how many, not who from or what they say.
  if (hideText) {
    return (
      <Pane label="NOTIFICATIONS">
        <div style={{ margin: 'auto', textAlign: 'center', padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--cc-muted)' }}>
            {feed.items.length === 0 ? 'NOTHING WAITING' : `${feed.items.length} IN TRAY`}
          </div>
          {feed.items.length > 0 && (
            <div className="cc-mini" style={{ marginTop: 8 }}>
              HIDDEN WHILE YOU ARE AWAY
            </div>
          )}
        </div>
      </Pane>
    );
  }

  // A chip whose app has gone from the list leaves nothing to filter by.
  const on = chips.some(([id]) => id === filter) ? filter : 'ALL';
  const visible = feed.items.filter((i) => on === 'ALL' || i.app === on);
  const rows = lines(visible);
  const dense = size.h < 320;
  const onName = chips.find(([id]) => id === on)?.[1];
  const textless = REMOTE_PANEL && feed.items.length > 0 && feed.items.every((i) => i.nameOnly);

  return (
    <Pane label="NOTIFICATIONS" padded={false}>
      {size.h > 220 && chips.length > 0 && (
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
          {[['ALL', 'ALL'], ...chips].map(([id, name]) => (
            <button key={id} onClick={() => setFilter(id)} className={on === id ? 'cc-chip cc-chip-on' : 'cc-chip'}>
              {name}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {rows.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center' }}>
            <span className="cc-mini" style={{ color: 'var(--cc-line-2)' }}>NOTHING WAITING</span>
          </div>
        ) : (
          rows.map((line) => <Row key={line.key} line={line} dense={dense} />)
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
        <span className="cc-mini">
          {textless
            ? 'WHAT THEY SAY STAYS ON THE PC'
            : on === 'ALL'
              ? `${feed.items.length} SHOWN`
              : `${visible.length} OF ${feed.items.length} SHOWN`}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {on !== 'ALL' && <span className="cc-mini" style={{ color: 'var(--cc-accent)' }}>FILTERED</span>}
          {visible.length > 0 && (
            <button
              className="cc-chip"
              style={{ padding: '2px 7px' }}
              onClick={() => clear(visible.map((i) => i.id))}
              title="Dismiss what the tile shows, here and in the system tray. A hidden app's stay."
            >
              {onName ? `CLEAR ${onName}` : 'CLEAR ALL'}
            </button>
          )}
        </div>
      </div>
    </Pane>
  );
}
