import { createContext, useContext } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { hhmmAt } from '../components/Stale';
import { applies, fill, get, num, ramp, text } from '../core/game';
import type { GameWidget, ItemReading, LineReading, MetersReading, NumbersReading, Reading, Side, StatsReading, TeamsReading } from '../core/game';
import { nightOf, useMatches } from '../core/gameSession';
import type { Night, Played } from '../core/gameSession';
import { phaseOf, statValues, teamsState } from '../core/gameState';
import type { ScoredSide, TeamsState } from '../core/gameState';
import { useNav } from '../core/nav';
import { useSettings } from '../core/settings';
import type { GamePayload } from '../core/payloads';
import { REMOTE_PANEL } from '../core/remoteSource';
import { useTileSize } from '../core/TileSize';
import type { WidgetDescription } from '../core/widget';
import { useTopic } from '../core/useTopic';
import { HEADER, Meter, Pane } from './chrome';

/**
 * A game's tile, drawn from its widget file. It is for the gaps: after you
 * die, at half time, between matches. While you play the panel is still (see
 * `useGames`), so nothing here copies the game's own HUD. In a match it tells
 * the match so far; out of one, tonight's matches, which the game forgets.
 *
 * Every game widget is this one component, so a widget file never brings code.
 */

export type GameDescription = WidgetDescription & { game: GameWidget };

const ACCENT = { first: 'var(--cc-accent)', second: 'var(--cc-accent-2)' };

/**
 * Whether the tile wears its game's own colours for each side, or the
 * theme's. The game's, unless its options say otherwise.
 */
const Look = createContext(true);

const sideColor = (s: Side, game: boolean) => (game && s.hex ? s.hex : ACCENT[s.color]);

/**
 * The player's own state from before they started watching someone else,
 * kept per widget, so a tile that remounts, or a second one, sees the same.
 */
const OWN = new Map<string, unknown>();

/** A number that leads: the score, the match's figures. Large and thin, as every leading number is. */
const big = (size: number, color = 'var(--cc-text)'): CSSProperties => ({
  fontSize: size,
  fontWeight: 250,
  letterSpacing: '-0.04em',
  lineHeight: 1,
  color,
  whiteSpace: 'nowrap',
});

const clip: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 };

/** One value with its label above. */
function Value({ label, value, size, color }: { label: string; value: string; size: number; color?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="cc-label" style={clip}>
        {label}
      </div>
      <div style={{ ...big(size, color), marginTop: 4 }}>{value}</div>
    </div>
  );
}

interface Ctx {
  data: unknown;
  /** The player's own state, for a reading that stays theirs while they watch someone. */
  own: unknown;
}

const dataOf = (ctx: Ctx, r: Reading) => (r.own ? ctx.own : ctx.data);

// -------------------------------------------------------------- the match

function Score({ sides, size }: { sides: ScoredSide[]; size: number }) {
  const game = useContext(Look);
  const side = (s: ScoredSide, align: 'flex-start' | 'flex-end') => (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: align, gap: 2, minWidth: 28 }}>
      <span style={{ fontSize: Math.max(13, Math.round(size * 0.2)), fontWeight: 600, color: sideColor(s, game) }}>{s.label}</span>
      <span className="cc-mini" style={{ visibility: s.you ? undefined : 'hidden' }}>
        You
      </span>
    </span>
  );
  const [a, b] = sides;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(size * 0.16) }}>
      {side(a, 'flex-end')}
      <span style={big(size, sideColor(a, game))}>{a.n ?? '–'}</span>
      <span style={{ ...big(size * 0.6, 'var(--cc-dim)') }}>–</span>
      <span style={big(size, sideColor(b, game))}>{b.n ?? '–'}</span>
      {side(b, 'flex-start')}
    </div>
  );
}

/** One square per round, in the colour of the side that won it, a gap at half time. */
function History({ r, t, width }: { r: TeamsReading; t: TeamsState; width: number }) {
  const game = useContext(Look);
  const count = Math.max(t.of ?? 0, t.results.length + 1, t.round ?? 0);
  const half = t.of ? t.of / 2 : 0;
  const gap = 3;
  const sq = Math.max(6, Math.min(16, Math.floor((width - (count - 1) * gap - (half ? gap * 3 : 0)) / count)));
  return (
    <div style={{ display: 'flex', gap, alignItems: 'center', flex: 'none' }} aria-label={`${t.results.length} rounds played`}>
      {Array.from({ length: count }, (_, i) => {
        const won = t.results[i];
        const style: CSSProperties =
          won !== undefined && won >= 0
            ? { background: sideColor(r.sides[won], game) }
            : i === t.results.length
              ? { boxShadow: 'inset 0 0 0 1.5px var(--cc-muted)' }
              : { background: 'var(--cc-line)' };
        return <i key={i} style={{ width: sq, height: sq, borderRadius: 2, flex: 'none', ...style, marginLeft: half && i === half ? gap * 3 : 0 }} />;
      })}
    </div>
  );
}

function roundText(t: TeamsState): string {
  if (t.round === undefined) return '';
  return `Round ${t.round}${t.of && t.round <= t.of ? ` of ${t.of}` : ''}`;
}

function StatsRow({ r, ctx, size }: { r: StatsReading; ctx: Ctx; size: number }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="cc-label">{r.label}</div>
      <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
        {statValues(r, dataOf(ctx, r)).map((i) => (
          <div key={i.label} style={{ flex: 1, minWidth: 0 }}>
            <div className="cc-mini" style={clip}>
              {i.label}
            </div>
            <div style={{ ...big(size), marginTop: 2 }}>{i.v ?? '--'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const statsLine = (r: StatsReading, data: unknown) =>
  statValues(r, data)
    .slice(0, 3)
    .map((i) => i.v ?? '-')
    .join(' / ');

function MeterValue({ item, data }: { item: MetersReading['items'][number]; data: unknown }) {
  const game = useContext(Look);
  const v = num(data, item.value);
  const low = v !== undefined && item.low !== undefined && v < item.low;
  const plain = low ? 'var(--cc-danger)' : 'var(--cc-text)';
  const color = game && v !== undefined ? (ramp(item.ramp, v) ?? item.color ?? plain) : plain;
  const tagged = item.tag && get(data, item.tag.path) === true;
  return (
    <div style={{ minWidth: 0 }}>
      <Value label={tagged ? `${item.label} · ${item.tag?.text}` : item.label} value={v === undefined ? '--' : String(Math.round(v))} size={28} color={color} />
      <div style={{ marginTop: 8 }}>
        <Meter pct={v === undefined ? 0 : (v / item.max) * 100} color={color} />
      </div>
    </div>
  );
}

/**
 * The displays a game's file may use besides the score and the stats: values
 * a game shows nowhere else, such as a racing game's fuel for so many laps.
 */
function Others({ readings, ctx }: { readings: Reading[]; ctx: Ctx }) {
  const game = useContext(Look);
  const cells: ReactNode[] = [];
  for (const r of readings) {
    const data = dataOf(ctx, r);
    if (r.display === 'meters') {
      for (const item of r.items) cells.push(<MeterValue key={`${r.id}.${item.label}`} item={item} data={data} />);
    } else if (r.display === 'numbers') {
      for (const item of (r as NumbersReading).items) {
        const v = num(data, item.value);
        cells.push(
          <Value
            key={`${r.id}.${item.label}`}
            label={item.label}
            value={v === undefined ? '--' : `${item.prefix ?? ''}${Math.round(v).toLocaleString('en-US')}`}
            size={28}
            color={game ? item.color : undefined}
          />
        );
      }
    } else if (r.display === 'item') {
      const it = r as ItemReading;
      const raw = text(data, it.item);
      const name = raw === undefined ? undefined : (it.names[raw] ?? raw.replace(it.strip, '').replace(/_/g, ' '));
      const count = num(data, it.count);
      cells.push(<Value key={r.id} label={it.label} value={`${name ?? '--'}${count !== undefined ? ` · ${count}` : ''}`} size={18} />);
    } else if (r.display === 'line') {
      const l = r as LineReading;
      cells.push(<Value key={r.id} label={l.label} value={fill(l.text, data) ?? '--'} size={14} />);
    }
  }
  if (cells.length === 0) return null;
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 16 }}>{cells}</div>;
}

function Match({ g, widgetId, ctx, readings, watching, w, h, title }: { g: GameWidget; widgetId: string; ctx: Ctx; readings: Reading[]; watching: string | null; w: number; h: number; title: string }) {
  const game = useContext(Look);
  const teams = readings.find((r): r is TeamsReading => r.display === 'teams');
  const t = teams ? teamsState(teams, ctx.data) : null;
  const stats = readings.filter((r): r is StatsReading => r.display === 'stats');
  const others = readings.filter((r) => r.display !== 'teams' && r.display !== 'stats');
  const phase = t?.phase ?? null;
  const out = watching ? (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, fontSize: 14 }}>
      <span style={{ color: 'var(--cc-muted)', flex: 'none' }}>You’re out</span>
      <span style={{ ...clip, color: 'var(--cc-dim)' }}>watching {watching}</span>
    </div>
  ) : null;

  // One row: as many values as fit, in a line.
  if (h < 120) {
    const cells: [string, ReactNode][] = [];
    if (t) {
      cells.push([
        'Score',
        <>
          <span style={{ color: sideColor(t.sides[0], game) }}>
            {t.sides[0].label} {t.sides[0].n ?? '-'}
          </span>
          <span style={{ color: 'var(--cc-dim)' }}> – </span>
          <span style={{ color: sideColor(t.sides[1], game) }}>
            {t.sides[1].n ?? '-'} {t.sides[1].label}
          </span>
        </>,
      ]);
      cells.push([roundText(t) || 'Round', phase ?? '']);
    }
    if (watching) cells.push(['You’re out', `watching ${watching}`]);
    for (const s of stats) cells.push([s.items.slice(0, 3).map((i) => i.short).join(' / '), statsLine(s, dataOf(ctx, s))]);
    const fits = Math.max(2, Math.floor((w - 32) / 150));
    return (
      <Pane padded={false}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 32, padding: '0 16px', minWidth: 0 }}>
          {cells.slice(0, fits).map(([l, v], i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 'none', minWidth: 0 }}>
              <span className="cc-label">{l}</span>
              <span style={{ fontSize: h > 80 ? 20 : 16, fontWeight: 400, whiteSpace: 'nowrap' }}>{v}</span>
            </div>
          ))}
        </div>
      </Pane>
    );
  }

  const body = h - HEADER;
  const narrow = w < 400;
  const statusLine = t && (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flex: 'none', minWidth: 0 }}>
      <span style={{ fontSize: 14, color: 'var(--cc-muted)', whiteSpace: 'nowrap' }}>{roundText(t)}</span>
      <span style={{ flex: 1 }} />
      {phase && <span className="cc-mini">{phase}</span>}
    </div>
  );

  // Wide: the match on the left, the player's figures on the right.
  if (!narrow && w / body > 1.8 && w >= 700) {
    const half = Math.floor((w - 32 - 32) / 2);
    return (
      <Pane label={g.source.game} right={title} padded={false}>
        <div style={{ flex: 1, display: 'flex', gap: 32, padding: '8px 16px 16px', minHeight: 0 }}>
          {t && teams && (
            <div style={{ width: half, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16, minWidth: 0 }}>
              {statusLine}
              <Score sides={t.sides} size={Math.min(120, Math.floor(body * 0.32))} />
              <History r={teams} t={t} width={half} />
            </div>
          )}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 24, minWidth: 0 }}>
            {out}
            {stats.map((s) => (
              <StatsRow key={s.id} r={s} ctx={ctx} size={Math.min(48, Math.floor(body * 0.14))} />
            ))}
            <Others readings={others} ctx={ctx} />
          </div>
        </div>
      </Pane>
    );
  }

  const roomy = body > 420;
  return (
    <Pane label={narrow ? g.source.short : g.source.game} right={narrow ? phase : title} padded={false}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: roomy ? 'flex-start' : 'center', gap: roomy ? 24 : 16, padding: roomy ? '16px 16px' : '8px 16px 16px', minHeight: 0 }}>
        {t && teams && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!narrow && statusLine}
            <Score sides={t.sides} size={narrow ? Math.min(48, Math.floor(body * 0.22)) : Math.min(112, Math.floor(body * 0.2))} />
            {body > 200 && <History r={teams} t={t} width={w - 32} />}
            {narrow && <span className="cc-mini">{roundText(t)}</span>}
          </div>
        )}
        {out}
        {stats.map((s) =>
          narrow ? (
            <div key={s.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="cc-label">{s.items.slice(0, 3).map((i) => i.short).join(' / ')}</span>
              <span style={{ fontSize: 18 }}>{statsLine(s, dataOf(ctx, s))}</span>
            </div>
          ) : (
            <StatsRow key={s.id} r={s} ctx={ctx} size={roomy ? 40 : 28} />
          )
        )}
        {!narrow && body > 360 && <Others readings={others} ctx={ctx} />}
        {!narrow && body > 640 && <Earlier g={g} widgetId={widgetId} w={w} room={Math.floor((body - 520) / 40) - 1} />}
      </div>
    </Pane>
  );
}

// ------------------------------------------------------------ the night

const RESULT: Record<Played['result'], { text: string; color: string }> = {
  won: { text: 'Won', color: 'var(--cc-ok)' },
  lost: { text: 'Lost', color: 'var(--cc-danger)' },
  tied: { text: 'Tied', color: 'var(--cc-muted)' },
  played: { text: 'Played', color: 'var(--cc-muted)' },
  left: { text: 'Left', color: 'var(--cc-dim)' },
};

function hoursText(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function tally(matches: Played[]): string {
  const won = matches.filter((m) => m.result === 'won').length;
  const lost = matches.filter((m) => m.result === 'lost').length;
  const parts = [won && `${won} won`, lost && `${lost} lost`].filter(Boolean);
  return parts.join(', ');
}

/** A match as it ended: the player's side's score first. */
const scoreText = (p: Played) => (p.score ? (p.you === 1 ? `${p.score[1]}–${p.score[0]}` : `${p.score[0]}–${p.score[1]}`) : '');

/** Tonight's matches as a list: a line of totals, then one row each, newest first. */
function NightRows({ g, night, w, room, small = false }: { g: GameWidget; night: Night; w: number; room: number; small?: boolean }) {
  const n = night.matches.length;
  const stats = g.readings.find((r): r is StatsReading => r.display === 'stats');
  const shorts = stats ? stats.items.slice(0, 3) : [];
  const narrow = w < 400;
  const rowH = 40;
  const cols = narrow ? '1fr auto' : w < 560 ? '1fr auto auto' : '48px 1fr auto auto auto';
  const won = night.matches.filter((m) => m.result === 'won').length;
  const lost = night.matches.filter((m) => m.result === 'lost').length;
  const totals: [string, string][] = [
    [String(n), n === 1 ? 'Match' : 'Matches'],
    [String(won), 'Won'],
    [String(lost), 'Lost'],
    [hoursText(night.playedMs).replace(' min', 'm').replace(' h ', 'h ').replace(/ h$/, 'h'), 'Played'],
  ];
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', flex: 'none' }}>
        <span className="cc-display" style={{ fontSize: narrow || small ? 22 : 30 }}>Tonight</span>
        {(narrow || small) && (
          <span style={{ fontSize: 14, color: 'var(--cc-muted)' }}>{`${n} match${n === 1 ? '' : 'es'} · ${hoursText(night.playedMs)}`}</span>
        )}
        {small && !narrow && <span style={{ fontSize: 14, color: 'var(--cc-dim)' }}>{tally(night.matches)}</span>}
      </div>
      {!narrow && !small && (
        // The night in four numbers, before the matches that make it.
        <div style={{ display: 'flex', gap: 40, marginTop: 20, flex: 'none' }}>
          {totals.map(([v, l]) => (
            <div key={l} style={{ minWidth: 0 }}>
              <div style={big(36)}>{v}</div>
              <div className="cc-label" style={{ marginTop: 6 }}>
                {l}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: small ? 8 : 24, minHeight: 0, overflow: 'hidden' }}>
        {!narrow && shorts.length > 0 && (
          <div className="cc-mini" style={{ display: 'grid', gridTemplateColumns: cols, gap: 16, paddingBottom: 6 }}>
            {w >= 560 && <span />}
            <span />
            <span />
            <span />
            <span style={{ textAlign: 'right' }}>{shorts.map((i) => i.short).join(' / ')}</span>
          </div>
        )}
        {night.matches.slice(0, room).map((p) => {
          const r = RESULT[p.result];
          return (
            <div
              key={p.at}
              style={{ display: 'grid', gridTemplateColumns: cols, gap: 16, alignItems: 'center', height: rowH, borderTop: '1px solid var(--cc-line)', fontSize: 14 }}
            >
              {w >= 560 && <span className="cc-mini">{hhmmAt(p.at)}</span>}
              <span style={clip}>{p.title || g.source.game}</span>
              {!narrow && <span style={{ color: r.color }}>{r.text}</span>}
              <span style={{ textAlign: 'right', color: narrow ? r.color : undefined }}>{scoreText(p) || (narrow ? r.text : '')}</span>
              {w >= 560 && (
                <span style={{ textAlign: 'right', color: 'var(--cc-muted)' }}>{shorts.map((i) => p.stats[i.label] ?? '-').join(' / ')}</span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Tonight's matches below the one being played, in a tile tall enough for both. */
function Earlier({ g, widgetId, w, room }: { g: GameWidget; widgetId: string; w: number; room: number }) {
  const night = nightOf(useMatches(widgetId), Date.now());
  if (night.matches.length === 0 || room < 1) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <NightRows g={g} night={night} w={w} room={room} small />
    </div>
  );
}

function Tonight({ g, widgetId, state, w, h, note }: { g: GameWidget; widgetId: string; state: string; w: number; h: number; note?: string }) {
  const list = useMatches(widgetId);
  const night = nightOf(list, Date.now());
  const n = night.matches.length;
  const summary = n ? `${n} match${n === 1 ? '' : 'es'} · ${hoursText(night.playedMs)}` : '';

  if (h < 120) {
    return (
      <Pane padded={false}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 24, padding: '0 16px', minWidth: 0 }}>
          <span className="cc-label" style={{ flex: 'none' }}>
            {g.source.short}
          </span>
          <span style={{ fontSize: 16, color: 'var(--cc-muted)', flex: 'none' }}>{state}</span>
          {n > 0 && <span style={{ ...clip, fontSize: 16 }}>Tonight {summary}</span>}
          {n > 0 && w > 600 && <span style={{ ...clip, fontSize: 16, color: 'var(--cc-muted)' }}>{tally(night.matches)}</span>}
        </div>
      </Pane>
    );
  }

  const body = h - HEADER;
  const narrow = w < 400;
  const room = Math.max(1, Math.floor((body - 16 - (narrow ? 72 : 150) - (note ? 28 : 0)) / 40));
  return (
    <Pane label={narrow ? g.source.short : g.source.game} right={state} padded={false}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '8px 16px 16px', minHeight: 0 }}>
        {n === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
            <div className="cc-display" style={{ fontSize: 26 }}>No matches yet tonight</div>
            {body > 140 && (
              <div style={{ fontSize: 13, color: 'var(--cc-muted)', lineHeight: 1.5, maxWidth: 440 }}>
                Each match goes here as it ends: how it went and how you did. The game forgets; Kehai keeps tonight’s.
              </div>
            )}
          </div>
        ) : (
          <NightRows g={g} night={night} w={w} room={room} />
        )}
        {note && (
          <div className="cc-mini" style={{ marginTop: 'auto', paddingTop: 12 }}>
            {note}
          </div>
        )}
      </div>
    </Pane>
  );
}

// --------------------------------------------------------------- the tile

function shown(r: Reading, props: Record<string, unknown>): boolean {
  const chosen = props.readings as Record<string, unknown> | undefined;
  const v = chosen?.[r.id];
  return typeof v === 'boolean' ? v : r.on;
}

export function GameTile(p: { widget: GameDescription; props: Record<string, unknown> }) {
  const { settings } = useSettings();
  return (
    <Look.Provider value={settings.games[p.widget.id]?.colours !== 'theme'}>
      <GameView {...p} />
    </Look.Provider>
  );
}

function Explain({ lines, action }: { lines: [string, string?]; action?: ReactNode }) {
  const { h } = useTileSize();
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, padding: '0 16px 16px', minHeight: 0 }}>
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>{lines[0]}</div>
      {lines[1] && h > 200 && <div style={{ fontSize: 13, color: 'var(--cc-muted)', lineHeight: 1.5, maxWidth: 440 }}>{lines[1]}</div>}
      {action && h > 180 && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

function GameView({ widget, props }: { widget: GameDescription; props: Record<string, unknown> }) {
  const g = widget.game;
  const short = g.source.short;
  const state = useTopic<GamePayload>(`game:${widget.id}`);
  const { w, h } = useTileSize();
  const nav = useNav();

  const one = (status: string, color?: string) => (
    <Pane padded={false}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 16, padding: '0 16px', minWidth: 0 }}>
        <span className="cc-label">{short}</span>
        <span style={{ fontSize: 14, color: color ?? 'var(--cc-muted)', whiteSpace: 'nowrap' }}>{status}</span>
      </div>
    </Pane>
  );
  const pane = (status: string, body: ReactNode, color?: string) =>
    h < 120 ? (
      one(status, color)
    ) : (
      <Pane label={w < 400 ? short : g.source.game} right={<span style={{ color }}>{status}</span>} padded={false}>
        {body}
      </Pane>
    );
  const setUp = (label: string) =>
    REMOTE_PANEL ? undefined : (
      <button className="cc-chip cc-primary" style={{ padding: '6px 16px' }} onClick={() => nav.openSettings('WIDGETS')}>
        {label}
      </button>
    );

  if (!state || state.setup === 'none') {
    return pane(
      'Not set up',
      <Explain
        lines={[
          `${short} isn’t sending anything to Kehai yet.`,
          REMOTE_PANEL
            ? 'It is set up on the PC Kehai runs on, under Settings → Widgets.'
            : `Set up writes one small file into ${short}’s settings folder, after showing you where.`,
        ]}
        action={setUp('Set up')}
      />
    );
  }
  if (state.setup === 'gone') {
    return pane('Not set up', <Explain lines={['The file Kehai wrote is gone.', `${short} won’t send anything without it.`]} action={setUp('Set up again')} />, 'var(--cc-danger)');
  }
  if (state.setup === 'waiting') {
    return pane(`Waiting for ${short}`, <Explain lines={[`Start ${short}, or restart it if it’s open.`, 'It reads Kehai’s file when it starts, and sends from then on.']} />);
  }

  const data = state.live ? state.data : null;
  const ph = phaseOf(g, data);
  if (data !== null && !ph.watching) OWN.set(widget.id, data);
  const tile = { w, h };
  if (!state.live) {
    return (
      <Tonight
        g={g}
        widgetId={widget.id}
        state={`${short} isn’t running`}
        note={state.heardMs ? `Last heard from ${short} at ${hhmmAt(state.heardMs)}` : undefined}
        {...tile}
      />
    );
  }
  if (!ph.inMatch || ph.over) {
    return <Tonight g={g} widgetId={widget.id} state={ph.over ? 'Match over' : 'In the menu'} {...tile} />;
  }

  const ctx: Ctx = { data, own: OWN.get(widget.id) ?? data };
  const readings = g.readings.filter((r) => shown(r, props) && applies(r, data));
  return <Match g={g} widgetId={widget.id} ctx={ctx} readings={readings} watching={ph.watching} title={fill(g.match.title, data) ?? ''} {...tile} />;
}
