import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { bus } from '../core/bus';
import { GLYPHS, groupOf, keyOf, sceneLine, usePress } from '../core/dock';
import type { DockButton, Glyph, Live } from '../core/dock';
import { mmss } from '../core/format';
import { ON_TABLET } from '../core/front';
import { phaseOf, teamsOf, teamsState } from '../core/gameState';
import type { Said } from '../core/front';
import type {
  DockIconsPayload,
  DockStatePayload,
  FlowCommand,
  GamePayload,
  MediaCommand,
  MediaPayload,
  MicCommand,
  MicPayload,
  NotifyPayload,
  SprintPayload,
  VolumePayload,
} from '../core/payloads';
import { findLayout, useSettings } from '../core/settings';
import { useTileSize } from '../core/TileSize';
import { useTopic } from '../core/useTopic';
import type { WidgetProps } from '../core/types';
import { Pane, HEADER } from './chrome';
import { registry } from './registry';

/** Smaller than this, a button is too small for a finger, and the rest go behind +N. */
const MIN = 64;
/** A small tile's buttons, icons only, at the 36 px a button needs. */
const MIN_TIGHT = 36;
/** Bigger than this, a button only spreads its icon over glass. */
const MAX = 148;
const GAP = 8;
const PAD = 12;

/** Where the buttons go: columns, rows and each one's size, and how many fit. */
interface Fit {
  cols: number;
  rows: number;
  w: number;
  h: number;
  /** Buttons shown before a +N takes the last place. Equal to the count when all fit. */
  shown: number;
}

/** The arrangement that gives the biggest buttons for `n`, or as many as fit at `MIN`. */
export function fit(n: number, W: number, H: number): Fit {
  let best: Fit | null = null;
  let bestScore = -1;
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(Math.max(1, n) / cols);
    const w = Math.min(MAX, (W - GAP * (cols - 1)) / cols);
    const h = Math.min(MAX, (H - GAP * (rows - 1)) / rows);
    // Square-ish wins: a button much wider than tall wastes its sides.
    const score = Math.min(w, h) - Math.abs(w - h) * 0.15;
    if (score > bestScore) {
      bestScore = score;
      best = { cols, rows, w, h, shown: n };
    }
  }
  if (best && Math.min(best.w, best.h) >= MIN) return best;
  const at = (min: number): Fit => {
    const cols = Math.max(1, Math.floor((W + GAP) / (min + GAP)));
    const rows = Math.max(1, Math.floor((H + GAP) / (min + GAP)));
    const w = Math.min(MAX, (W - GAP * (cols - 1)) / cols);
    const h = Math.min(MAX, (H - GAP * (rows - 1)) / rows);
    const places = cols * rows;
    return { cols, rows, w, h, shown: places >= n ? n : Math.max(0, places - 1) };
  };
  // A small tile would hold a place or two at a finger's width with a name;
  // icons alone, a little smaller, make it worth having.
  const roomy = at(MIN);
  if (roomy.cols * roomy.rows >= 4) return roomy;
  const tight = at(MIN_TIGHT);
  return tight.cols * tight.rows > roomy.cols * roomy.rows ? tight : roomy;
}

export function Icon({ glyph, size, color = 'currentColor', fill = false }: { glyph: Glyph; size: number; color?: string; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? color : 'none'} stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={GLYPHS[glyph]} />
    </svg>
  );
}

/** What a button shows under its name, and how it looks, from what Kehai knows. */
interface Look {
  icon: ReactNode;
  line: string | null;
  lineColor?: string;
  /** A count on the icon's corner. */
  badge: { n: number; accent: boolean } | null;
  /** A dot under it: a window of it is open. */
  dot: boolean;
  /** Lit: the toggle is on, or the timer runs. */
  lit: boolean;
  /** Muted things are in the danger colour, so a muted mic is never missed. */
  alarm: boolean;
  /** A game's cover fills the button. */
  cover: string | null;
  /** The hint a screen reader gets for the tap. */
  does: string;
}

const on = (b: DockButton, l: Live) => !b.off?.includes(l);

/** The game widget that reads this Steam game, if any, and the score it has. */
function useMatch(): (steamId: string) => string | null {
  // Every game widget's state at once, whatever widgets the folder adds later.
  const [all, setAll] = useState<Record<string, GamePayload>>({});
  useEffect(() => bus.subscribe('game:*', (e) => e.topic !== 'game:setup' && setAll((prev) => ({ ...prev, [e.topic.slice(5)]: e.data as GamePayload }))), []);
  return (steamId) => {
    for (const w of Object.values(registry)) {
      const s = all[w.id];
      if (String(w.game?.source.steamApp) !== steamId || !s?.live || !s.data || !w.game) continue;
      if (!phaseOf(w.game, s.data).inMatch) continue;
      const r = teamsOf(w.game, s.data);
      if (!r) return 'In a match';
      const t = teamsState(r, s.data);
      const you = t.sides.find((x) => x.you);
      const them = t.sides.find((x) => !x.you);
      return you && them ? `${you.n ?? 0} – ${them.n ?? 0}` : 'In a match';
    }
    return null;
  };
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function Dock({ props }: WidgetProps) {
  const { settings, useLayout } = useSettings();
  const size = useTileSize();
  const state = useTopic<DockStatePayload>('dock:state');
  const icons = useTopic<DockIconsPayload>('dock:icons')?.icons;
  const notify = useTopic<NotifyPayload>('sys:notify');
  const media = useTopic<MediaPayload>('media:now_playing');
  const volume = useTopic<VolumePayload>('media:volume');
  const mic = useTopic<MicPayload>('os:mic');
  const sprint = useTopic<SprintPayload>('flow:pomodoro');
  const match = useMatch();
  const { press, saidOf } = usePress(useLayout);
  const [more, setMore] = useState(false);

  const group = groupOf(settings.dock, props.group);
  const buttons = group.buttons.map((id) => settings.dock.buttons[id]).filter(Boolean);
  const layoutName = (id: string) => findLayout(settings, id)?.name ?? 'gone';
  const counts = new Map((notify?.apps ?? []).map((a) => [a.id, a.count]));

  const look = (b: DockButton, px: number): Look => {
    const plain: Look = { icon: null, line: null, badge: null, dot: false, lit: false, alarm: false, cover: null, does: `Open ${b.name}` };
    if (b.kind === 'app' && b.target?.kind === 'app') {
      const key = keyOf(b.target);
      const live = state?.live[key];
      const src = icons?.[key];
      const notes = on(b, 'notes') ? (counts.get(b.target.id) ?? 0) : 0;
      const waiting = on(b, 'waiting') ? (live?.waiting ?? 0) : 0;
      const playing = on(b, 'playing') && media?.playing === true && media.playerApp === b.target.id;
      const listening = on(b, 'mic') && live?.listening === true;
      const line = waiting
        ? `${waiting} waiting`
        : playing
          ? 'Playing'
          : listening
            ? 'On the mic'
            : notes
              ? `${notes} new`
              : null;
      return {
        ...plain,
        icon: src ? <img src={src} width={px} height={px} alt="" style={{ display: 'block', borderRadius: px * 0.22 }} /> : <Mono name={b.name} px={px} />,
        line,
        lineColor: waiting ? 'var(--cc-accent)' : undefined,
        badge: waiting ? { n: waiting, accent: true } : notes ? { n: notes, accent: false } : null,
        dot: on(b, 'open') && live?.running === true,
      };
    }
    if (b.kind === 'game' && b.target?.kind === 'game') {
      const key = keyOf(b.target);
      const live = state?.live[key];
      const score = on(b, 'match') ? match(b.target.id) : null;
      const running = live?.running === true;
      return {
        ...plain,
        cover: icons?.[key] ?? null,
        icon: <Mono name={b.name} px={px} />,
        line: score ?? (running ? 'Playing' : null),
        lineColor: score ? 'var(--cc-text)' : undefined,
        dot: on(b, 'open') && running,
      };
    }
    if (b.kind === 'link' && b.target) {
      const t = b.target;
      const where = t.kind === 'link' ? new URL(t.url).host.replace(/^www\./, '') : t.kind === 'path' ? (t.path.split(/[\\/]/).filter(Boolean).pop() ?? t.path) : '';
      return { ...plain, icon: <Icon glyph={b.glyph ?? (t.kind === 'path' ? (t.folder ? 'folder' : 'file') : 'link')} size={px} />, line: where };
    }
    if (b.kind === 'scene') {
      const steps = b.steps ?? [];
      return { ...plain, icon: <Icon glyph={b.glyph ?? 'play'} size={px} />, line: steps.length === 1 ? sceneLine(steps, layoutName) : `${steps.length} steps`, does: `Run ${b.name}: ${steps.length} steps` };
    }
    if (b.kind === 'toggle') {
      switch (b.toggle) {
        case 'mic': {
          if (!mic?.available) return { ...plain, icon: <Icon glyph="mic" size={px} color="var(--cc-dim)" />, line: 'No microphone', does: 'Mute the microphone' };
          const who = mic.listening[0];
          return {
            ...plain,
            icon: <Icon glyph={mic.muted ? 'micOff' : 'mic'} size={px} color={mic.muted ? 'var(--cc-danger)' : undefined} />,
            line: mic.muted ? 'Muted' : who ? `Live · ${who}` : 'On',
            lineColor: mic.muted ? 'var(--cc-danger)' : who ? 'var(--cc-ok)' : undefined,
            alarm: mic.muted,
            lit: !mic.muted && Boolean(who),
            does: mic.muted ? 'Unmute the microphone' : 'Mute the microphone',
          };
        }
        case 'sound': {
          const muted = volume?.muted === true;
          return {
            ...plain,
            icon: <Icon glyph={muted ? 'soundOff' : 'sound'} size={px} color={muted ? 'var(--cc-danger)' : undefined} />,
            line: volume ? (muted ? 'Muted' : `${volume.level}%`) : null,
            lineColor: muted ? 'var(--cc-danger)' : undefined,
            alarm: muted,
            does: muted ? 'Unmute the sound' : 'Mute the sound',
          };
        }
        case 'focus': {
          const running = sprint?.state === 'running';
          return {
            ...plain,
            icon: <Icon glyph="focus" size={px} />,
            line: !sprint ? null : running ? mmss(sprint.remainingSec) : sprint.state === 'paused' ? `Paused · ${mmss(sprint.remainingSec)}` : 'Start',
            lineColor: running ? 'var(--cc-text)' : undefined,
            lit: running,
            does: running ? 'Pause the focus timer' : 'Start the focus timer',
          };
        }
        case 'media': {
          const playing = media?.playing === true;
          return {
            ...plain,
            icon: <Icon glyph={playing ? 'pause' : 'media'} size={px} />,
            line: !media || !media.title ? 'Nothing playing' : playing ? 'Playing' : 'Paused',
            lit: playing,
            does: playing ? 'Pause' : 'Play',
          };
        }
      }
    }
    return plain;
  };

  const flip = (b: DockButton) => () => {
    switch (b.toggle) {
      case 'mic':
        if (mic?.available) bus.publish<MicCommand>('mic:command', 'widget.dock', { action: 'mute', muted: !mic.muted });
        return;
      case 'sound':
        bus.publish<MediaCommand>('media:command', 'widget.dock', { action: 'mute', muted: !volume?.muted });
        return;
      case 'focus':
        bus.publish<FlowCommand>('flow:command', 'widget.dock', { action: sprint?.state === 'running' ? 'pause' : 'start' });
        return;
      case 'media':
        bus.publish<MediaCommand>('media:command', 'widget.dock', { action: 'playpause' });
    }
  };

  const W = size.w - PAD * 2;
  const H = size.h - HEADER - PAD * 2;

  if (buttons.length === 0) {
    return (
      <Pane label={group.name}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 10 }}>
          <span style={{ fontSize: 14 }}>No buttons in {group.name} yet</span>
          {!ON_TABLET && <span className="cc-mini">Hold the tile to add apps, games, toggles and scenes.</span>}
        </div>
      </Pane>
    );
  }

  const list = more ? buttons : buttons;
  const f = more ? fit(list.length, W, H) : fit(buttons.length, W, H);
  const overflow = !more && f.shown < buttons.length;
  const visible = overflow ? buttons.slice(0, f.shown) : list;
  // A free place says where the next button goes.
  const room = !ON_TABLET && !more && !overflow && f.cols * f.rows > buttons.length;

  const cell: CSSProperties = { width: f.w, height: f.h };

  return (
    <Pane
      label={more ? `${group.name} · all ${buttons.length}` : group.name}
      right={more ? <button className="cc-chip" style={{ minHeight: 22, padding: '0 10px' }} onClick={() => setMore(false)}>Back</button> : undefined}
      padded={false}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: PAD,
          display: 'grid',
          gridTemplateColumns: `repeat(${f.cols}, ${f.w}px)`,
          gridAutoRows: `${f.h}px`,
          gap: GAP,
          justifyContent: 'center',
          alignContent: more ? 'start' : 'center',
          overflowY: more ? 'auto' : 'hidden',
        }}
      >
        {visible.map((b) => (
          <Button key={b.id} b={b} look={look(b, iconPx(f))} said={saidOf(b.id)} style={cell} f={f} onPress={() => press(b, flip(b))} />
        ))}
        {overflow && (
          <button className="cc-dock-btn" data-dock-more style={{ ...cell, ...BTN }} onClick={() => setMore(true)} aria-label={`Show all ${buttons.length}`}>
            <span className="cc-display" style={{ fontSize: Math.round(iconPx(f) * 0.7), color: 'var(--cc-muted)' }}>
              +{buttons.length - f.shown}
            </span>
          </button>
        )}
        {room && (
          <button
            className="cc-dock-btn"
            data-dock-add
            style={{ ...cell, ...BTN, background: 'transparent', border: '1px dashed var(--cc-line-2)', color: 'var(--cc-dim)' }}
            onClick={(e) => openAdd(e.currentTarget)}
            aria-label="Add a button"
          >
            <Icon glyph="plus" size={Math.round(iconPx(f) * 0.7)} />
            {f.h >= 64 && <span style={{ fontSize: 12 }}>Add</span>}
          </button>
        )}
      </div>
    </Pane>
  );
}

/** Opens the dock's options on Add, as holding the tile would. */
function openAdd(el: HTMLElement) {
  const tile = el.closest('.cc-tiles > *');
  if (!tile) return;
  startAt.page = 'add';
  tile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
}

/** Where the options open next, set by the + place. Read once by the sheet. */
export const startAt: { page: string | null } = { page: null };

const iconPx = (f: Fit) => Math.round(Math.max(22, Math.min(52, Math.min(f.w, f.h) * (f.h < 92 ? 0.32 : 0.36))));

const BTN: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  borderRadius: 16,
  border: '1px solid var(--cc-line)',
  background: 'var(--cc-pane)',
  color: 'var(--cc-text)',
  padding: '8px 4px',
  overflow: 'hidden',
  font: 'inherit',
  cursor: 'pointer',
  minWidth: 0,
};

function Mono({ name, px }: { name: string; px: number }) {
  return (
    <span
      style={{
        width: px,
        height: px,
        borderRadius: px * 0.22,
        background: 'var(--cc-pane-2)',
        border: '1px solid var(--cc-line-2)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: px * 0.38,
        color: 'var(--cc-muted)',
      }}
    >
      {initials(name)}
    </span>
  );
}

function Button({ b, look, said, style, f, onPress }: { b: DockButton; look: Look; said?: Said; style: CSSProperties; f: Fit; onPress: () => void }) {
  const [pressed, setPressed] = useState(false);
  // What fits under the icon: its name, then a line of what's going on. A
  // short button packs them closer: the Panel's dock at 125% has 76 px.
  const tight = f.h < 92;
  const showName = f.h >= 60;
  const showLine = f.h >= 72;
  // A narrow button says the same in fewer words.
  const narrow = f.w < 96;
  const full = said?.text ?? look.line;
  const line = full && narrow ? shorten(full) : full;
  const lineColor = said?.color ?? look.lineColor ?? 'var(--cc-muted)';
  const px = iconPx(f);

  const base: CSSProperties = {
    ...BTN,
    ...style,
    ...(tight ? { gap: 3, padding: '5px 4px' } : null),
    background: pressed ? 'var(--cc-line-2)' : look.lit ? 'var(--cc-pane-2)' : BTN.background,
    borderColor: look.alarm ? 'color-mix(in srgb, var(--cc-danger) 55%, transparent)' : look.lit ? 'var(--cc-line-2)' : 'var(--cc-line)',
  };

  const events = {
    onPointerDown: () => setPressed(true),
    onPointerUp: () => setPressed(false),
    onPointerLeave: () => setPressed(false),
    onPointerCancel: () => setPressed(false),
    onClick: onPress,
  };

  if (look.cover) {
    return (
      <button className="cc-dock-btn" data-dock-btn={b.id} aria-label={look.does} style={{ ...base, padding: 0, justifyContent: 'flex-end' }} {...events}>
        <img src={look.cover} alt="" data-art={b.target ? keyOf(b.target) : undefined} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: pressed ? 0.7 : 1 }} />
        {showName && (
          <div
            style={{
              position: 'relative',
              width: '100%',
              padding: '18px 8px 7px',
              background: 'linear-gradient(to top, rgb(0 0 0 / 0.82), rgb(0 0 0 / 0.55) 55%, transparent)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <span style={{ fontSize: 12, color: '#f5f5f5', maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
            {showLine && line && (
              <span className="cc-mini" style={{ color: said ? lineColor : look.lineColor ? '#f5f5f5' : '#c8c8c8', whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {line}
              </span>
            )}
          </div>
        )}
        {look.dot && <Dot />}
      </button>
    );
  }

  return (
    <button className="cc-dock-btn" data-dock-btn={b.id} aria-label={look.does} style={base} {...events}>
      <span style={{ position: 'relative', display: 'inline-flex', flex: 'none' }}>
        {look.icon}
        {look.badge && (
          <span
            style={{
              position: 'absolute',
              top: -7,
              right: -10,
              minWidth: 18,
              height: 18,
              padding: '0 5px',
              borderRadius: 9,
              fontSize: 11,
              lineHeight: '18px',
              textAlign: 'center',
              background: look.badge.accent ? 'var(--cc-accent)' : 'var(--cc-line-2)',
              color: look.badge.accent ? 'var(--cc-bg)' : 'var(--cc-text)',
              fontWeight: look.badge.accent ? 500 : 400,
              boxShadow: '0 0 0 2px var(--cc-bg)',
            }}
          >
            {look.badge.n}
          </span>
        )}
      </span>
      {showName && (
        <span style={{ fontSize: narrow ? 11 : px >= 40 ? 13 : 12, maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
      )}
      {showLine && (
        <span className="cc-mini" style={{ color: lineColor, maxWidth: '100%', minHeight: 13, lineHeight: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: tight ? -1 : -3 }}>
          {line ?? ''}
        </span>
      )}
      {look.dot && <Dot />}
    </button>
  );
}

/** The short form of what a button says, for one too narrow for the whole. */
export function shorten(text: string): string {
  const m = /^(\d+ of \d+)/.exec(text.replace(/^Running · /, ''));
  if (m) return m[1];
  if (/ waiting$/.test(text)) return 'Waiting';
  if (/^Live · /.test(text)) return 'Live';
  if (/^Paused · /.test(text)) return 'Paused';
  const SHORT: Record<string, string> = {
    'On the mic': 'On mic',
    'Nothing playing': 'Nothing',
    'Starting it': 'Starting',
    'Steam is starting it': 'Starting',
    'Couldn’t open it': 'Couldn’t',
    'Press it on the PC': 'On the PC',
    'No microphone': 'None',
  };
  return SHORT[text] ?? text;
}

function Dot() {
  return <span aria-hidden style={{ position: 'absolute', top: 9, left: 9, width: 6, height: 6, borderRadius: 3, background: 'var(--cc-ok)' }} />;
}
