import { createContext, useContext } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { hhmmAt } from '../components/Stale';
import { applies, fill, get, holds, num, ramp, text } from '../core/game';
import type { EdgeRule, GameWidget, ItemReading, LineReading, MetersReading, NumbersReading, Reading, Side, StatsReading, TeamsReading, Tone } from '../core/game';
import { useNav } from '../core/nav';
import { useSettings } from '../core/settings';
import type { GamePayload } from '../core/payloads';
import { REMOTE_PANEL } from '../core/remoteSource';
import { useTileSize } from '../core/TileSize';
import type { WidgetDescription } from '../core/widget';
import { useTopic } from '../core/useTopic';
import { Pane } from './chrome';

/**
 * A game's tile, drawn from its widget file: the readings it lists, in order,
 * by the displays Kehai has. Every game widget is this one component, so a
 * widget file never brings code.
 */

export type GameDescription = WidgetDescription & { game: GameWidget };

const HEADER = 26;
const ACCENT = { first: 'var(--cc-accent)', second: 'var(--cc-accent-2)' };
const TONE: Record<Tone, string> = {
  first: 'var(--cc-accent)',
  second: 'var(--cc-accent-2)',
  danger: 'var(--cc-danger)',
  ok: 'var(--cc-ok)',
  text: 'var(--cc-text)',
  muted: 'var(--cc-muted)',
};

/**
 * Whether the tile wears its game's own colours, as RGB lighting for the game
 * does, or the theme's. The game's, unless its options say otherwise.
 */
const Look = createContext(true);

const sideColor = (s: Side, game: boolean) => (game && s.hex ? s.hex : ACCENT[s.color]);

/**
 * What a tile remembers past its own life: the last match, and the player's
 * own state from before they started watching someone else. Kept per widget,
 * so a tile that remounts, or a second one, sees the same.
 */
const MEMORY = new Map<string, { last?: { at: number; data: unknown }; own?: unknown }>();

function remember(id: string) {
  let m = MEMORY.get(id);
  if (!m) {
    m = {};
    MEMORY.set(id, m);
  }
  return m;
}

function group(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

const big = (size: number, color = 'var(--cc-text)', weight = 300): CSSProperties => ({
  fontSize: size,
  fontWeight: weight,
  lineHeight: 0.95,
  letterSpacing: '-0.03em',
  color,
  whiteSpace: 'nowrap',
});

const rule = <div style={{ height: 1, background: 'var(--cc-line)', flex: 'none' }} />;

function Blocks({ pct, color, n = 10, h = 10 }: { pct: number; color: string; n?: number; h?: number }) {
  const on = Math.round((Math.max(0, Math.min(100, pct)) / 100) * n);
  return (
    <div style={{ display: 'flex', gap: n > 12 ? 2 : 3, height: h, flex: 'none' }}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ flex: 1, background: i < on ? color : 'var(--cc-line)' }} />
      ))}
    </div>
  );
}

function Tag({ children, color = 'var(--cc-muted)' }: { children: ReactNode; color?: string }) {
  return (
    <span style={{ fontSize: 9, letterSpacing: '0.1em', padding: '2px 6px', border: '1px solid currentColor', color, flex: 'none' }}>
      {children}
    </span>
  );
}

/** One value with its label above. */
function Value({ label, value, size, color, extra }: { label: string; value: string; size: number; color?: string; extra?: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="cc-label">{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginTop: 6 }}>
        <span style={big(size, color)}>{value}</span>
        {extra}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- readings

interface Ctx {
  data: unknown;
  /** The player's own state, for a reading that stays theirs while they watch someone. */
  own: unknown;
  /** Whose state it is, when it is not the player's. */
  watching: string | null;
}

const labelled = (label: string, ctx: Ctx, r: Reading) => (ctx.watching && !r.own ? `${ctx.watching}’S ${label}` : label);
const dataOf = (ctx: Ctx, r: Reading) => (r.own ? ctx.own : ctx.data);

function teamsState(r: TeamsReading, data: unknown) {
  const you = text(data, r.you);
  const sides = r.sides.map((s) => ({ ...s, n: num(data, s.score), you: s.is === you }));
  const played = num(data, r.round?.path);
  const round = played === undefined ? undefined : played + (r.round?.add ?? 0);
  const ofKey = r.round?.of ? text(data, r.round.of.path) : undefined;
  const of = ofKey !== undefined ? r.round?.of?.values[ofKey] : undefined;
  const alert = r.alert && r.alert.is.includes(text(data, r.alert.path) ?? '') ? r.alert.text : null;
  let phase: string | null = null;
  for (const p of r.phase) {
    const v = text(data, p.path);
    if (v !== undefined && p.labels[v]) {
      phase = p.labels[v];
      break;
    }
  }
  const wins = get(data, r.history ?? '');
  const results =
    r.history && typeof wins === 'object' && wins !== null
      ? Object.entries(wins as Record<string, unknown>)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, v]) => r.sides.findIndex((s) => s.wins && String(v).startsWith(s.wins)))
      : [];
  return { sides, round, of, alert, phase, results };
}

function PhaseChip({ alert, phase }: { alert: string | null; phase: string | null }) {
  if (alert) {
    return (
      <span className="cc-chip" style={{ gap: 7, color: 'var(--cc-danger)', borderColor: 'var(--cc-danger)', padding: '3px 10px' }}>
        <i style={{ width: 6, height: 6, background: 'var(--cc-danger)' }} />
        {alert}
      </span>
    );
  }
  if (!phase) return null;
  const live = phase === 'LIVE';
  return (
    <span
      className="cc-chip"
      style={{ gap: 7, padding: '3px 10px', ...(live ? { color: 'var(--cc-accent)', borderColor: 'var(--cc-accent)' } : {}) }}
    >
      {live && <i style={{ width: 6, height: 6, background: 'var(--cc-accent)' }} />}
      {phase}
    </span>
  );
}

function Score({ sides, size }: { sides: (Side & { n?: number; you: boolean })[]; size: number }) {
  const game = useContext(Look);
  const side = (s: (typeof sides)[number]) => (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <span style={{ fontSize: Math.max(10, size * 0.16), letterSpacing: '0.18em', fontWeight: 600, color: sideColor(s, game) }}>{s.label}</span>
      {s.you && <span className="cc-mini" style={{ fontSize: 9, color: sideColor(s, game) }}>YOU</span>}
    </span>
  );
  const [a, b] = sides;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.18 }}>
      {side(a)}
      <span style={big(size, sideColor(a, game), 200)}>{a.n ?? '–'}</span>
      <span style={{ fontSize: size * 0.5, fontWeight: 200, color: 'var(--cc-dim)' }}>–</span>
      <span style={big(size, sideColor(b, game), 200)}>{b.n ?? '–'}</span>
      {side(b)}
    </div>
  );
}

/** One square per round, coloured by who won it, a gap at half time. */
function History({ r, results, of, round, width }: { r: TeamsReading; results: number[]; of?: number; round?: number; width: number }) {
  const game = useContext(Look);
  const count = Math.max(of ?? 0, results.length + 1, round ?? 0);
  const half = of ? of / 2 : 0;
  const gap = 3;
  const sq = Math.max(6, Math.min(20, Math.floor((width - (count - 1) * gap - (half ? gap * 3 : 0)) / count)));
  return (
    <div style={{ display: 'flex', gap, alignItems: 'center', flex: 'none' }}>
      {Array.from({ length: count }, (_, i) => {
        const won = results[i];
        const style: CSSProperties =
          won !== undefined && won >= 0
            ? { background: sideColor(r.sides[won], game) }
            : i === results.length
              ? { boxShadow: 'inset 0 0 0 1.5px var(--cc-text)' }
              : { background: 'var(--cc-line)' };
        return <i key={i} style={{ width: sq, height: sq, flex: 'none', ...style, marginLeft: half && i === half ? gap * 3 : 0 }} />;
      })}
    </div>
  );
}

function RoundLine({ round, of, alert, phase }: { round?: number; of?: number; alert: string | null; phase: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 'none' }}>
      <span className="cc-label">{round !== undefined ? `ROUND ${round}${of && round <= of ? ` OF ${of}` : ''}` : ''}</span>
      <span style={{ flex: 1 }} />
      <PhaseChip alert={alert} phase={phase} />
    </div>
  );
}

function Meter({ item, data, size, prefix }: { item: MetersReading['items'][number]; data: unknown; size: number; prefix: (l: string) => string }) {
  const game = useContext(Look);
  const v = num(data, item.value);
  const low = v !== undefined && item.low !== undefined && v < item.low;
  const plain = low ? 'var(--cc-danger)' : 'var(--cc-text)';
  const color = game && v !== undefined ? (ramp(item.ramp, v) ?? item.color ?? plain) : plain;
  const tagged = item.tag && get(data, item.tag.path) === true;
  return (
    <div style={{ minWidth: 0 }}>
      <Value label={prefix(item.label)} value={v === undefined ? '--' : String(Math.round(v))} size={size} color={color} extra={tagged ? <Tag>{item.tag?.text}</Tag> : null} />
      <div style={{ marginTop: 9 }}>
        <Blocks pct={v === undefined ? 0 : (v / item.max) * 100} color={color} />
      </div>
    </div>
  );
}

function numberText(item: NumbersReading['items'][number], data: unknown): string {
  const v = num(data, item.value);
  return v === undefined ? '--' : `${item.prefix ?? ''}${group(v)}`;
}

function itemState(r: ItemReading, data: unknown) {
  const raw = text(data, r.item);
  const name = raw === undefined ? undefined : (r.names[raw] ?? raw.replace(r.strip, '').replace(/_/g, ' ').toUpperCase());
  const count = num(data, r.count);
  const max = num(data, r.max);
  const rest = num(data, r.rest);
  return { name, count, max, rest };
}

function Item({ r, ctx, size, compact = false }: { r: ItemReading; ctx: Ctx; size: number; compact?: boolean }) {
  const game = useContext(Look);
  const { name, count, max, rest } = itemState(r, dataOf(ctx, r));
  const low = count !== undefined && max && r.low && count / max < r.low.below ? (game ? r.low.color : 'var(--cc-accent)') : undefined;
  if (compact) {
    return <Value label={name ?? labelled(r.label, ctx, r)} value={count !== undefined ? `${count} / ${rest ?? 0}` : '--'} size={size} color={low} />;
  }
  return (
    <div style={{ minWidth: 0 }}>
      <div className="cc-label">{labelled(r.label, ctx, r)}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: size, fontWeight: 300 }}>{name ?? '--'}</span>
        {count !== undefined && (
          <span style={{ fontSize: size, fontWeight: 300, color: low }}>
            {count}
            <span style={{ color: 'var(--cc-dim)' }}> / {rest ?? 0}</span>
          </span>
        )}
      </div>
      {count !== undefined && max ? (
        <div style={{ marginTop: 9 }}>
          <Blocks pct={(count / max) * 100} color={low ?? 'var(--cc-muted)'} n={Math.min(max, 30)} h={6} />
        </div>
      ) : null}
    </div>
  );
}

function statValues(r: StatsReading, data: unknown) {
  return r.items.map((i) => ({ ...i, v: num(data, i.value) }));
}

function Stats({ r, ctx, size }: { r: StatsReading; ctx: Ctx; size: number }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="cc-label">{r.own && ctx.watching ? `YOUR ${r.label.replace(/^THIS /, '')}` : r.label}</div>
      <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
        {statValues(r, dataOf(ctx, r)).map((i) => (
          <div key={i.label} style={{ flex: 1, minWidth: 0 }}>
            <div className="cc-mini" style={{ letterSpacing: '0.14em' }}>{i.label}</div>
            <div style={{ fontSize: size, fontWeight: 300, marginTop: 4 }}>{i.v ?? '--'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function statsLine(r: StatsReading, data: unknown): string {
  return statValues(r, data)
    .map((i) => `${i.v ?? '-'} ${i.short}`)
    .join(' · ');
}

function Line({ r, ctx }: { r: LineReading; ctx: Ctx }) {
  return (
    <div className="cc-mini" style={{ lineHeight: 1.7, color: 'var(--cc-muted)', minWidth: 0 }}>
      {labelled(r.label, ctx, r)}
      <br />
      <span style={{ color: 'var(--cc-text)' }}>{fill(r.text, dataOf(ctx, r)) ?? '--'}</span>
    </div>
  );
}

// --------------------------------------------------------------- the tile

function Centred({ children }: { children: ReactNode }) {
  return <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12, padding: '0 22px', minHeight: 0 }}>{children}</div>;
}

function LastMatch({ g, last, dim = false }: { g: GameWidget; last: { at: number; data: unknown }; dim?: boolean }) {
  const game = useContext(Look);
  const teams = g.readings.find((r): r is TeamsReading => r.display === 'teams' && applies(r, last.data));
  const stats = g.readings.find((r): r is StatsReading => r.display === 'stats');
  const t = teams ? teamsState(teams, last.data) : null;
  const over = g.match.phase !== undefined && g.match.over.includes(text(last.data, g.match.phase) ?? '');
  const mine = t?.sides.find((s) => s.you);
  const theirs = t?.sides.find((s) => !s.you);
  const result =
    !over || !mine || mine.n === undefined || theirs?.n === undefined
      ? 'UNFINISHED'
      : mine.n > theirs.n
        ? 'WON'
        : mine.n < theirs.n
          ? 'LOST'
          : 'TIED';
  const color = result === 'WON' ? 'var(--cc-ok)' : result === 'LOST' ? 'var(--cc-danger)' : 'var(--cc-muted)';
  return (
    <div style={{ padding: '12px 14px', background: 'var(--cc-inset)', border: '1px solid var(--cc-line)', opacity: dim ? 0.7 : undefined }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="cc-label">LAST MATCH · {hhmmAt(last.at)}</span>
        <span style={{ flex: 1 }} />
        <span className="cc-mini">{fill(g.match.title, last.data) ?? ''}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 10 }}>
        <span style={big(result === 'UNFINISHED' ? 22 : 40, color)}>{result}</span>
        {t && (
          <span style={{ fontSize: 24, fontWeight: 300 }}>
            <span style={{ color: sideColor(t.sides[0], game) }}>{t.sides[0].n ?? '-'}</span>
            <span style={{ color: 'var(--cc-dim)' }}> – </span>
            <span style={{ color: sideColor(t.sides[1], game) }}>{t.sides[1].n ?? '-'}</span>
          </span>
        )}
      </div>
      {stats && (
        <div className="cc-mini" style={{ marginTop: 8, color: 'var(--cc-text)', letterSpacing: '0.1em' }}>
          {statsLine(stats, last.data)}
        </div>
      )}
    </div>
  );
}

function shown(r: Reading, props: Record<string, unknown>): boolean {
  const chosen = props.readings as Record<string, unknown> | undefined;
  const v = chosen?.[r.id];
  return typeof v === 'boolean' ? v : r.on;
}

/**
 * The tile's edge and washes, as RGB lighting does for the same game: a strip
 * in the player's side's colour, the edge lit by the first of the widget's
 * rules that holds, and a wash as strong as a flash or smoke is.
 */
function Lit({ g, data, on, children }: { g: GameWidget; data: unknown; on: boolean; children: ReactNode }) {
  const game = useContext(Look);
  const teams = g.readings.find((r): r is TeamsReading => r.display === 'teams');
  const sideBy = (v: string | undefined) => (v === undefined ? undefined : teams?.sides.find((x) => x.is === v));
  const you = teams ? sideBy(text(data, teams.you)) : undefined;
  const winner = teams?.winner ? sideBy(text(data, teams.winner)) : undefined;
  const colourOf = (c: EdgeRule['color'], tone: Tone) => {
    const side = c === 'you' ? you : c === 'winner' ? winner : undefined;
    if (side) return sideColor(side, game);
    return c === 'you' || c === 'winner' || !game ? TONE[tone] : c;
  };
  const edge = on ? g.lighting.edge.find((r) => holds(data, r.when)) : undefined;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {children}
      {you && <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 2, background: sideColor(you, game), pointerEvents: 'none' }} />}
      {edge && <div className={edge.pulse ? 'cc-edge cc-edge-pulse' : 'cc-edge'} style={{ '--cc-edge': colourOf(edge.color, edge.tone) } as CSSProperties} />}
      {on &&
        g.lighting.overlays.map((o) => {
          const share = Math.max(0, Math.min(1, (num(data, o.path) ?? 0) / o.max));
          return share > 0.02 ? (
            <div
              key={o.path}
              style={{ position: 'absolute', inset: 0, background: game ? o.color : TONE[o.tone], opacity: share * 0.75, pointerEvents: 'none', transition: 'opacity 150ms linear' }}
            />
          ) : null;
        })}
    </div>
  );
}

export function GameTile(p: { widget: GameDescription; props: Record<string, unknown> }) {
  const { settings } = useSettings();
  return (
    <Look.Provider value={settings.games[p.widget.id]?.colours !== 'theme'}>
      <GameView {...p} />
    </Look.Provider>
  );
}

function GameView({ widget, props }: { widget: GameDescription; props: Record<string, unknown> }) {
  const { settings } = useSettings();
  const lighting = settings.games[widget.id]?.lighting !== false;
  const g = widget.game;
  const name = g.source.game.toUpperCase();
  const state = useTopic<GamePayload>(`game:${widget.id}`);
  const { w, h } = useTileSize();
  const nav = useNav();
  const mem = remember(widget.id);

  const data = state?.data ?? null;
  const inMatch = data !== null && get(data, g.match.in) !== undefined;
  const self = g.subject ? text(data, g.subject.self) : undefined;
  const who = g.subject ? text(data, g.subject.who) : undefined;
  const watching = g.subject && self !== undefined && who !== undefined && self !== who ? (text(data, g.subject.name) ?? '?').toUpperCase() : null;
  if (data !== null && state?.heardMs) {
    if (inMatch) mem.last = { at: state.heardMs, data };
    if (!watching) mem.own = data;
  }

  const right = (t: string, color?: string) => <span style={{ fontSize: 10, letterSpacing: '0.12em', color: color ?? 'var(--cc-dim)' }}>{t}</span>;
  // A one-row tile says only the game and its state; a narrow one names the
  // game shortly, so its state still fits beside it.
  const pane = (t: string, body: ReactNode, color?: string) =>
    h < 120 ? (
      <Pane padded={false}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px', minWidth: 0 }}>
          <span className="cc-label">{g.source.short}</span>
          <span style={{ fontSize: 14, color: color ?? 'var(--cc-muted)', whiteSpace: 'nowrap' }}>{t}</span>
        </div>
      </Pane>
    ) : (
      <Pane label={w < 400 ? g.source.short.toUpperCase() : name} right={right(w < 300 ? t.replace(/ FOR .*$/, '') : t, color)} padded={false}>
        {body}
      </Pane>
    );

  if (!state || state.setup === 'none') {
    return pane(
      'NOT SET UP',
      <Centred>
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>{g.source.short} isn’t sending anything to Kehai yet.</div>
        {h > 230 && <div style={{ fontSize: 12, color: 'var(--cc-muted)', lineHeight: 1.6 }}>
          {REMOTE_PANEL ? 'It is set up on the PC Kehai runs on, under Settings → Widgets.' : `SET UP writes one small file into ${g.source.short}’s settings folder, after showing you where.`}
        </div>}
        {!REMOTE_PANEL && h > 200 && (
          <div>
            <button className="cc-chip" style={{ padding: '8px 22px', color: 'var(--cc-accent)', borderColor: 'var(--cc-accent)' }} onClick={() => nav.openSettings('WIDGETS')}>
              SET UP
            </button>
          </div>
        )}
      </Centred>
    );
  }
  if (state.setup === 'gone') {
    return pane(
      'NOT SET UP',
      <Centred>
        <i style={{ width: 8, height: 8, background: 'var(--cc-danger)' }} />
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>The file Kehai wrote is gone.</div>
        {h > 230 && <div style={{ fontSize: 12, color: 'var(--cc-muted)', lineHeight: 1.6 }}>{g.source.short} won’t send anything without it.</div>}
        {!REMOTE_PANEL && h > 200 && (
          <div>
            <button className="cc-chip" style={{ padding: '8px 22px', color: 'var(--cc-accent)', borderColor: 'var(--cc-accent)' }} onClick={() => nav.openSettings('WIDGETS')}>
              SET UP AGAIN
            </button>
          </div>
        )}
      </Centred>,
      'var(--cc-danger)'
    );
  }
  if (state.setup === 'waiting') {
    return pane(
      `WAITING FOR ${g.source.short}`,
      <Centred>
        <div className="cc-label" style={{ color: 'var(--cc-accent-2)' }}>SET UP · NOTHING HEARD YET</div>
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>Start {g.source.short}, or restart it if it’s open.</div>
        {h > 230 && <div style={{ fontSize: 12, color: 'var(--cc-muted)', lineHeight: 1.6 }}>It reads Kehai’s file when it starts, and sends from then on.</div>}
      </Centred>,
      'var(--cc-accent-2)'
    );
  }
  if (!state.live) {
    return pane(
      `${g.source.short} ISN’T RUNNING`,
      <Centred>
        {state.heardMs && <div style={{ fontSize: 14, color: 'var(--cc-muted)' }}>Last heard from {g.source.short} at {hhmmAt(state.heardMs)}.</div>}
        {mem.last && h > 220 && <LastMatch g={g} last={mem.last} dim />}
      </Centred>
    );
  }
  const over = g.match.phase !== undefined && g.match.over.includes(text(data, g.match.phase) ?? '');
  if (!inMatch || over) {
    return pane(
      over ? 'MATCH OVER' : 'IN THE MENU',
      <Centred>
        {mem.last ? (
          h > 220 ? <LastMatch g={g} last={mem.last} /> : <div className="cc-mini">LAST MATCH · {hhmmAt(mem.last.at)}</div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--cc-muted)' }}>No match since Kehai started.</div>
        )}
        {h > 300 && <div className="cc-mini" style={{ lineHeight: 1.6 }}>THE TILE FILLS WHEN THE NEXT MATCH STARTS.</div>}
      </Centred>
    );
  }

  const ctx: Ctx = { data, own: mem.own ?? data, watching };
  const readings = g.readings.filter((r) => shown(r, props) && applies(r, data));
  const title = fill(g.match.title, data) ?? '';
  // A tap shows the tile full screen, and another goes back.
  return (
    <div
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
      onClick={() => nav.setFull(nav.full === widget.id ? null : widget.id)}
      title={nav.full === widget.id ? 'Back to the layout' : 'Full screen'}
    >
      <Lit g={g} data={data} on={lighting}>
        <Live g={g} readings={readings} ctx={ctx} w={w} h={h} name={name} title={title} />
      </Lit>
    </div>
  );
}

function Watching({ tag, who }: { tag: string; who: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', background: 'var(--cc-inset)', border: '1px solid var(--cc-line)', flex: 'none' }}>
      <Tag color="var(--cc-danger)">{tag}</Tag>
      <span style={{ fontSize: 12, color: 'var(--cc-muted)' }}>
        Watching <span style={{ color: 'var(--cc-text)' }}>{who.toLowerCase()}</span>
      </span>
    </div>
  );
}

function Live({ g, readings, ctx, w, h, name, title }: { g: GameWidget; readings: Reading[]; ctx: Ctx; w: number; h: number; name: string; title: string }) {
  const game = useContext(Look);
  const numColor = (item: NumbersReading['items'][number]) => (game ? item.color : undefined);
  const teams = readings.find((r): r is TeamsReading => r.display === 'teams');
  const t = teams ? teamsState(teams, ctx.data) : null;
  const meters = readings.filter((r): r is MetersReading => r.display === 'meters').flatMap((r) => r.items.map((item) => ({ r, item })));
  const numbers = readings.filter((r): r is NumbersReading => r.display === 'numbers').flatMap((r) => r.items.map((item) => ({ r, item })));
  const item = readings.find((r): r is ItemReading => r.display === 'item');
  const stats = readings.find((r): r is StatsReading => r.display === 'stats');
  const line = readings.find((r): r is LineReading => r.display === 'line');
  const prefix = (r: Reading) => (l: string) => labelled(l, ctx, r);
  const scoreShort = t ? (
    <span style={{ fontSize: 10, letterSpacing: '0.12em' }}>
      <span style={{ color: sideColor(t.sides[0], game) }}>
        {t.sides[0].label} {t.sides[0].n ?? '-'}
      </span>
      <span style={{ color: 'var(--cc-dim)' }}> – </span>
      <span style={{ color: sideColor(t.sides[1], game) }}>
        {t.sides[1].n ?? '-'} {t.sides[1].label}
      </span>
      {t.round !== undefined && <span style={{ color: 'var(--cc-dim)' }}> · R{t.round}</span>}
    </span>
  ) : null;
  const banner = ctx.watching && g.subject ? <Watching tag={g.subject.tag} who={ctx.watching} /> : null;

  // One row: readings in a line, as many as fit.
  if (h < 120) {
    const cells: [string, ReactNode][] = [];
    if (t) {
      cells.push([
        'SCORE',
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
      cells.push(['ROUND', t.alert ? <span style={{ color: 'var(--cc-danger)' }}>{t.round ?? ''} · {t.alert}</span> : `${t.round ?? ''}${t.phase ? ` · ${t.phase}` : ''}`]);
    }
    if (ctx.watching) cells.push([g.subject?.tag ?? '', ctx.watching]);
    for (const m of meters) cells.push([prefix(m.r)(m.item.label), String(num(dataOf(ctx, m.r), m.item.value) ?? '--')]);
    for (const n of numbers) cells.push([prefix(n.r)(n.item.label), numberText(n.item, dataOf(ctx, n.r))]);
    if (item) {
      const s = itemState(item, dataOf(ctx, item));
      cells.push([s.name ?? item.label, s.count !== undefined ? `${s.count} / ${s.rest ?? 0}` : '--']);
    }
    if (stats) cells.push([stats.items.map((i) => i.short).join(' / '), statValues(stats, dataOf(ctx, stats)).map((i) => i.v ?? '-').join(' / ')]);
    const fits = Math.max(2, Math.floor((w - 36) / 130));
    return (
      <Pane padded={false}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 26, padding: '0 18px', minWidth: 0 }}>
          {cells.slice(0, fits).map(([l, v], i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 'none', minWidth: 0 }}>
              <span className="cc-label">{l}</span>
              <span style={{ fontSize: h > 80 ? 20 : 16, fontWeight: 300, whiteSpace: 'nowrap' }}>{v}</span>
            </div>
          ))}
        </div>
      </Pane>
    );
  }

  const first = meters[0];
  const firstNumber = numbers[0];

  // Tiny: the first meter large, the first number under it.
  if (w < 260) {
    return (
      <Pane label={g.source.short.toUpperCase()} right={scoreShort} padded={false}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, padding: '0 14px' }}>
          {first && <Meter item={first.item} data={dataOf(ctx, first.r)} size={44} prefix={prefix(first.r)} />}
          {firstNumber && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="cc-label">{prefix(firstNumber.r)(firstNumber.item.label)}</span>
              <span style={{ fontSize: 15, color: numColor(firstNumber.item) }}>{numberText(firstNumber.item, dataOf(ctx, firstNumber.r))}</span>
            </div>
          )}
        </div>
      </Pane>
    );
  }

  // Small: the first meter large; the next and the first number beside each other; the item in a line.
  if (w < 400) {
    const s = item ? itemState(item, dataOf(ctx, item)) : null;
    return (
      <Pane label={g.source.short.toUpperCase()} right={scoreShort} padded={false}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14, padding: '0 16px' }}>
          {banner}
          {first && <Meter item={first.item} data={dataOf(ctx, first.r)} size={56} prefix={prefix(first.r)} />}
          <div style={{ display: 'flex', gap: 18 }}>
            {meters[1] && <Value label={prefix(meters[1].r)(meters[1].item.label)} value={String(num(dataOf(ctx, meters[1].r), meters[1].item.value) ?? '--')} size={22} />}
            {firstNumber && <Value label={prefix(firstNumber.r)(firstNumber.item.label)} value={numberText(firstNumber.item, dataOf(ctx, firstNumber.r))} size={22} color={numColor(firstNumber.item)} />}
          </div>
          {s?.name && (
            <div style={{ fontSize: 13, color: 'var(--cc-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.name}
              {s.count !== undefined && ` · ${s.count} / ${s.rest ?? 0}`}
            </div>
          )}
        </div>
      </Pane>
    );
  }

  const body = h - HEADER;
  const meterGrid = (size: number) =>
    meters.length > 0 && (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        {meters.map((m) => (
          <Meter key={m.item.label} item={m.item} data={dataOf(ctx, m.r)} size={size} prefix={prefix(m.r)} />
        ))}
      </div>
    );

  // Half: the Panel tile's size.
  if (w < 560 && body < 434) {
    return (
      <Pane label={name} right={<span style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--cc-dim)' }}>{title}</span>} padded={false}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 16px', minHeight: 0 }}>
          {t && <RoundLine {...t} />}
          {t && <Score sides={t.sides} size={body > 330 ? 52 : 40} />}
          {banner}
          {meterGrid(30)}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {firstNumber && <Value label={prefix(firstNumber.r)(firstNumber.item.label)} value={numberText(firstNumber.item, dataOf(ctx, firstNumber.r))} size={22} color={numColor(firstNumber.item)} />}
            {item && <Item r={item} ctx={ctx} size={22} compact />}
          </div>
          {stats && (
            <div className="cc-mini" style={{ marginTop: 'auto', display: 'flex', gap: 16 }}>
              <span>{ctx.watching ? 'YOUR MATCH' : stats.label}</span>
              <span style={{ color: 'var(--cc-text)' }}>{statsLine(stats, dataOf(ctx, stats))}</span>
            </div>
          )}
        </div>
      </Pane>
    );
  }

  const scoreSize = Math.min(150, Math.floor(body * 0.2));
  const header = <span style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--cc-dim)' }}>{title}</span>;

  // Wide, a bar display or the whole of a landscape one: score | vitals | the item and the match.
  if (w / body > 1.5 && w >= 900) {
    const col = ((w - 52 - 2 - 4 * 34) * 1.15) / 3.15;
    return (
      <Pane label={name} right={header} padded={false}>
        <div style={{ flex: 1, display: 'flex', gap: 34, padding: '22px 26px', minHeight: 0 }}>
          {t && teams && (
            <>
              <div style={{ flex: 1.15, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
                <RoundLine {...t} />
                <Score sides={t.sides} size={scoreSize} />
                <History r={teams} results={t.results} of={t.of} round={t.round} width={col} />
                {line && <Line r={line} ctx={ctx} />}
              </div>
              <div style={{ width: 1, background: 'var(--cc-line)' }} />
            </>
          )}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 22 }}>
            {banner}
            {meters.map((m, i) => (
              <Meter key={m.item.label} item={m.item} data={dataOf(ctx, m.r)} size={i === 0 ? 54 : 34} prefix={prefix(m.r)} />
            ))}
            {numbers.map((n) => (
              <Value key={n.item.label} label={prefix(n.r)(n.item.label)} value={numberText(n.item, dataOf(ctx, n.r))} size={34} color={numColor(n.item)} />
            ))}
          </div>
          {(item || stats) && (
            <>
              <div style={{ width: 1, background: 'var(--cc-line)' }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 28 }}>
                {item && <Item r={item} ctx={ctx} size={26} />}
                {stats && <Stats r={stats} ctx={ctx} size={26} />}
              </div>
            </>
          )}
        </div>
      </Pane>
    );
  }

  // Tall or square: everything, the height left over shared between the rows.
  const pad = w > 700 ? 30 : 24;
  const roomy = body > 680;
  return (
    <Pane label={name} right={header} padded={false}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 14, padding: `${pad - 4}px ${pad}px`, minHeight: 0 }}>
        {t && teams && (
          <>
            <RoundLine {...t} />
            <Score sides={t.sides} size={scoreSize} />
            <History r={teams} results={t.results} of={t.of} round={t.round} width={w - pad * 2} />
            {rule}
          </>
        )}
        {banner}
        {meterGrid(roomy ? 64 : 52)}
        {(numbers.length > 0 || line) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, alignItems: 'end' }}>
            {numbers.map((n) => (
              <Value key={n.item.label} label={prefix(n.r)(n.item.label)} value={numberText(n.item, dataOf(ctx, n.r))} size={36} color={numColor(n.item)} />
            ))}
            {line && <Line r={line} ctx={ctx} />}
          </div>
        )}
        {(item || stats) && rule}
        {item && <Item r={item} ctx={ctx} size={28} />}
        {stats && <Stats r={stats} ctx={ctx} size={28} />}
      </div>
    </Pane>
  );
}
