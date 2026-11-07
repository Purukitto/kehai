import { useEffect, useRef } from 'react';
import { bus } from './bus';
import { ON_TABLET, SURE_MS, useSaid, useSure } from './front';
import type { Said } from './front';
import type { BacklightCommand, DockCommand, DockOpened, DockTarget, FlowCommand, MediaCommand, MicCommand } from './payloads';

/**
 * The dock: buttons you choose, kept once and sorted into groups. A Dock tile
 * shows one group. A button opens an app, a Steam game, or a link or file;
 * flips one thing on the PC; or runs a scene, a few of those in order plus
 * Kehai's own settings.
 */

export type ButtonKind = 'app' | 'game' | 'link' | 'toggle' | 'scene';

/** The things a toggle flips, each with a state of its own to show. */
export type Toggle = 'mic' | 'sound' | 'focus' | 'media';

/** A scene's steps, run in order. Each says what it changes; none closes anything. */
export type Step =
  | { do: 'open'; target: DockTarget; name: string }
  | { do: 'layout'; layout: string }
  | { do: 'focus'; on: boolean }
  | { do: 'sound'; level: number | null; muted: boolean }
  | { do: 'mic'; muted: boolean }
  | { do: 'media'; playing: boolean }
  | { do: 'brightness'; level: number };

/** What a button may show of what Kehai knows. All are on until turned off. */
export type Live = 'waiting' | 'notes' | 'playing' | 'mic' | 'open' | 'match';

export interface DockButton {
  id: string;
  kind: ButtonKind;
  name: string;
  /** What an app, game or link button opens. */
  target?: DockTarget;
  toggle?: Toggle;
  steps?: Step[];
  /** A scene's or a link's own mark, from `GLYPHS`. Apps and games bring their own icon. */
  glyph?: Glyph;
  /** Live states turned off for this button. */
  off?: Live[];
}

export interface DockGroup {
  id: string;
  name: string;
  /** Button ids, in order. */
  buttons: string[];
}

export interface DockSettings {
  buttons: Record<string, DockButton>;
  groups: DockGroup[];
}

/** A fresh dock: the four toggles, so the tile does something before anything is added. */
export const DOCK_DEFAULTS: DockSettings = {
  buttons: {
    mic: { id: 'mic', kind: 'toggle', name: 'Mic', toggle: 'mic' },
    sound: { id: 'sound', kind: 'toggle', name: 'Sound', toggle: 'sound' },
    focus: { id: 'focus', kind: 'toggle', name: 'Focus', toggle: 'focus' },
    media: { id: 'media', kind: 'toggle', name: 'Music', toggle: 'media' },
  },
  groups: [{ id: 'dock', name: 'Dock', buttons: ['mic', 'sound', 'focus', 'media'] }],
};

export const TOGGLE_NAME: Record<Toggle, string> = { mic: 'Mic', sound: 'Sound', focus: 'Focus', media: 'Music' };
export const TOGGLE_DESC: Record<Toggle, string> = {
  mic: 'Mutes this PC’s microphone for every app, and shows which app is listening.',
  sound: 'Mutes this PC’s sound, as the mute key does, and shows the level.',
  focus: 'Starts and pauses the focus timer, and shows its countdown.',
  media: 'Plays and pauses whatever is playing, and shows whether it is.',
};

export const LIVE_NAME: Record<Live, string> = {
  waiting: 'Agents waiting',
  notes: 'Notifications',
  playing: 'Music playing',
  mic: 'Using the mic',
  open: 'Open now',
  match: 'A live match',
};
export const LIVE_DESC: Record<Live, string> = {
  waiting: 'A count in the accent while an agent session in it waits on you.',
  notes: 'How many of its notifications are in the Windows list.',
  playing: 'When it is the player Now playing shows.',
  mic: 'While it has the microphone open.',
  open: 'A dot under the icon while it has a window.',
  match: 'The score while a game Kehai reads is in a match.',
};
/** Which live states each kind of button can show. */
export const LIVE_OF: Record<'app' | 'game', Live[]> = {
  app: ['waiting', 'notes', 'playing', 'mic', 'open'],
  game: ['match', 'open'],
};

export const KIND_NAME: Record<ButtonKind, string> = { app: 'App', game: 'Game', link: 'Link or file', toggle: 'Toggle', scene: 'Scene' };

export const keyOf = (t: DockTarget): string =>
  t.kind === 'link' ? `link:${t.url}` : t.kind === 'path' ? `path:${t.path}` : `${t.kind}:${t.id}`;

// ------------------------------------------------------------------ glyphs

/**
 * One-colour marks for scenes and links, on a 24 px box, drawn with the
 * text's own colour. Apps and games bring their own icons.
 */
export const GLYPHS = {
  play: 'M8 5.5v13l11-6.5z',
  work: 'M4 8h16v11H4zM9 8V5.5h6V8',
  call: 'M5 4.5h4l1.5 4-2.5 1.5a11 11 0 0 0 6 6l1.5-2.5 4 1.5v4c0 1-1 1.5-2 1.5C11 20.5 3.5 13 3.5 6.5c0-1 .5-2 1.5-2z',
  game: 'M7 9h10a4 4 0 0 1 4 4v1.5a2.5 2.5 0 0 1-4.5 1.5L15 14H9l-1.5 2A2.5 2.5 0 0 1 3 14.5V13a4 4 0 0 1 4-4zM8 11.5v3M6.5 13h3M15.5 12.5h.01M17.5 14h.01',
  moon: 'M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z',
  link: 'M10 14a4 4 0 0 0 5.5.5l3-3a4 4 0 0 0-5.5-5.5l-1.5 1.5M14 10a4 4 0 0 0-5.5-.5l-3 3a4 4 0 0 0 5.5 5.5l1.5-1.5',
  folder: 'M3.5 7.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z',
  file: 'M6.5 3.5h7l4 4v13h-11zM13.5 3.5v4h4',
  star: 'M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z',
  bolt: 'M13 3.5L5.5 13.5H12l-1 7 7.5-10H12z',
  mic: 'M12 4a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-5 0v-5A2.5 2.5 0 0 1 12 4zM6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V20',
  micOff: 'M12 4a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-5 0v-5A2.5 2.5 0 0 1 12 4zM6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V20M4.5 4.5l15 15',
  sound: 'M4.5 9.5h3.5l4.5-4v13l-4.5-4H4.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  soundOff: 'M4.5 9.5h3.5l4.5-4v13l-4.5-4H4.5zM16 9.5l5 5M21 9.5l-5 5',
  focus: 'M12 20a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM12 8.5v4l2.5 1.5M10 3h4',
  media: 'M8 5.5v13l11-6.5z',
  pause: 'M8 5.5v13M16 5.5v13',
  plus: 'M12 5.5v13M5.5 12h13',
} as const;

export type Glyph = keyof typeof GLYPHS;

/** The marks a scene or a link can take, in the order the editor offers them. */
export const SCENE_GLYPHS: Glyph[] = ['play', 'work', 'call', 'game', 'moon', 'star', 'bolt', 'link', 'folder', 'file'];

// ------------------------------------------------------------------ settings

function target(raw: unknown): DockTarget | undefined {
  const t = (raw ?? {}) as Record<string, unknown>;
  if ((t.kind === 'app' || t.kind === 'game') && typeof t.id === 'string') return { kind: t.kind, id: t.id };
  if (t.kind === 'link' && typeof t.url === 'string' && /^https:\/\//.test(t.url)) return { kind: 'link', url: t.url };
  if (t.kind === 'path' && typeof t.path === 'string') return { kind: 'path', path: t.path, folder: t.folder === true };
  return undefined;
}

function step(raw: unknown): Step | undefined {
  const s = (raw ?? {}) as Record<string, unknown>;
  const level = (v: unknown) => (typeof v === 'number' && v >= 0 && v <= 100 ? Math.round(v) : null);
  switch (s.do) {
    case 'open': {
      const t = target(s.target);
      return t && typeof s.name === 'string' ? { do: 'open', target: t, name: s.name } : undefined;
    }
    case 'layout':
      return typeof s.layout === 'string' ? { do: 'layout', layout: s.layout } : undefined;
    case 'focus':
      return { do: 'focus', on: s.on !== false };
    case 'sound':
      return { do: 'sound', level: level(s.level), muted: s.muted === true };
    case 'mic':
      return { do: 'mic', muted: s.muted !== false };
    case 'media':
      return { do: 'media', playing: s.playing !== false };
    case 'brightness': {
      const l = level(s.level);
      return l === null ? undefined : { do: 'brightness', level: l };
    }
  }
  return undefined;
}

/** Each button and group on its own, so one bad entry costs only itself. */
export function parseDock(raw: unknown): DockSettings {
  if (raw === undefined) return DOCK_DEFAULTS;
  const r = (raw ?? {}) as Record<string, unknown>;
  const buttons: Record<string, DockButton> = {};
  for (const [id, value] of Object.entries((r.buttons ?? {}) as Record<string, unknown>)) {
    const b = (value ?? {}) as Record<string, unknown>;
    if (typeof b.name !== 'string' || typeof b.kind !== 'string' || !(b.kind in KIND_NAME)) continue;
    const kind = b.kind as ButtonKind;
    const t = target(b.target);
    if ((kind === 'app' || kind === 'game' || kind === 'link') && !t) continue;
    if (kind === 'toggle' && !(typeof b.toggle === 'string' && b.toggle in TOGGLE_NAME)) continue;
    buttons[id] = {
      id,
      kind,
      name: b.name,
      target: t,
      toggle: kind === 'toggle' ? (b.toggle as Toggle) : undefined,
      steps: kind === 'scene' && Array.isArray(b.steps) ? b.steps.map(step).filter((s): s is Step => s !== undefined) : undefined,
      glyph: typeof b.glyph === 'string' && b.glyph in GLYPHS ? (b.glyph as Glyph) : undefined,
      off: Array.isArray(b.off) ? (b.off.filter((l) => typeof l === 'string' && l in LIVE_NAME) as Live[]) : undefined,
    };
  }
  const groups: DockGroup[] = [];
  for (const value of Array.isArray(r.groups) ? r.groups : []) {
    const g = (value ?? {}) as Record<string, unknown>;
    if (typeof g.id !== 'string' || typeof g.name !== 'string' || groups.some((x) => x.id === g.id)) continue;
    const ids = Array.isArray(g.buttons) ? g.buttons.filter((id): id is string => typeof id === 'string' && id in buttons) : [];
    groups.push({ id: g.id, name: g.name, buttons: [...new Set(ids)] });
  }
  return { buttons, groups: groups.length ? groups : [{ id: 'dock', name: 'Dock', buttons: [] }] };
}

/** The group a tile shows: the one it names, else the first. */
/**
 * Everything the buttons and scenes open, once each. The engine opens these and
 * nothing else, and says what it knows of them.
 */
export function pinsOf(dock: DockSettings): DockTarget[] {
  const all = new Map<string, DockTarget>();
  for (const b of Object.values(dock.buttons)) {
    if (b.target) all.set(keyOf(b.target), b.target);
    for (const s of b.steps ?? []) if (s.do === 'open') all.set(keyOf(s.target), s.target);
  }
  return [...all.values()];
}

export function groupOf(dock: DockSettings, id: unknown): DockGroup {
  return dock.groups.find((g) => g.id === id) ?? dock.groups[0];
}

// ------------------------------------------------------------------ what a scene's steps say

export function stepText(s: Step, layoutName: (id: string) => string): string {
  switch (s.do) {
    case 'open':
      return s.name;
    case 'layout':
      return `Layout ${layoutName(s.layout)}`;
    case 'focus':
      return s.on ? 'Start focus' : 'Pause focus';
    case 'sound':
      return s.muted ? 'Sound muted' : s.level === null ? 'Sound on' : `Sound ${s.level}%`;
    case 'mic':
      return s.muted ? 'Mic muted' : 'Mic on';
    case 'media':
      return s.playing ? 'Play' : 'Pause music';
    case 'brightness':
      return `Brightness ${s.level}%`;
  }
}

/** A scene's steps in a few words, for under its name. */
export function sceneLine(steps: Step[], layoutName: (id: string) => string): string {
  if (steps.length === 0) return 'No steps yet';
  return steps.map((s) => stepText(s, layoutName)).join(' · ');
}

// ------------------------------------------------------------------ pressing

const OPENED: Record<NonNullable<DockOpened['how']>, string> = {
  front: 'Opened',
  started: 'Starting it',
  launched: 'Steam is starting it',
  link: 'Opened',
};

/**
 * What a press on each button does, and what it said, for a moment. Opening
 * goes to the engine, which only brings forward or starts what a button
 * names; toggles and Kehai's own steps are the commands the other tiles
 * already send.
 */
export function usePress(useLayout: (id: string) => void) {
  const { said, say } = useSaid();
  const sure = useSure();
  const scenes = useRef(new Map<string, { of: number; done: number; failed: string | null }>());
  const pending = useRef(new Map<string, { button: string; scene: string | null; name: string }>());
  const count = useRef(0);

  useEffect(() => {
    const stop = bus.subscribe('dock:opened', (e) => {
      if (Date.now() - e.ts > 1_500) return;
      const r = e.data as DockOpened;
      const p = pending.current.get(r.press);
      if (!p) return;
      pending.current.delete(r.press);
      if (p.scene) {
        const s = scenes.current.get(p.scene);
        if (!s) return;
        s.done += r.ok ? 1 : 0;
        if (!r.ok) s.failed ??= p.name;
        say(p.scene, { text: `Running · ${s.done} of ${s.of}`, color: 'var(--cc-muted)' }, 4_000);
        return;
      }
      say(p.button, r.ok && r.how ? { text: OPENED[r.how], color: 'var(--cc-text)' } : { text: 'Couldn’t open it', color: 'var(--cc-danger)' });
    });
    return stop;
  }, []);

  const open = (button: string, target: DockTarget, name: string, scene: string | null = null) => {
    count.current += 1;
    const press = `${button}:${Date.now()}:${count.current}`;
    pending.current.set(press, { button, scene, name });
    bus.publish<DockCommand>('dock:command', 'widget.dock', { action: 'open', press, target, at: Date.now() });
  };

  const run = (b: DockButton, steps: Step[]) => {
    const s = { of: steps.length, done: 0, failed: null as string | null };
    scenes.current.set(b.id, s);
    say(b.id, { text: `Running · 0 of ${s.of}`, color: 'var(--cc-muted)' }, 4_000);
    steps.forEach((step, i) => {
      window.setTimeout(() => {
        switch (step.do) {
          case 'open':
            open(`${b.id}#${i}`, step.target, step.name, b.id);
            return;
          case 'layout':
            useLayout(step.layout);
            break;
          case 'focus':
            bus.publish<FlowCommand>('flow:command', 'widget.dock', { action: step.on ? 'start' : 'pause' });
            break;
          case 'sound':
            bus.publish<MediaCommand>('media:command', 'widget.dock', step.muted ? { action: 'mute', muted: true } : step.level === null ? { action: 'mute', muted: false } : { action: 'volume', level: step.level });
            break;
          case 'mic':
            bus.publish<MicCommand>('mic:command', 'widget.dock', { action: 'mute', muted: step.muted });
            break;
          case 'media':
            bus.publish<MediaCommand>('media:command', 'widget.dock', { action: 'playpause' });
            break;
          case 'brightness':
            bus.publish<BacklightCommand>('backlight:command', 'widget.dock', { action: 'set', level: step.level });
            break;
        }
        s.done += 1;
        say(b.id, { text: `Running · ${s.done} of ${s.of}`, color: 'var(--cc-muted)' }, 4_000);
      }, i * 150);
    });
    window.setTimeout(() => {
      const ok = s.done === s.of && !s.failed;
      say(
        b.id,
        ok ? { text: 'Done', color: 'var(--cc-text)' } : { text: `${s.done} of ${s.of} · ${s.failed ?? 'a step'} didn’t open`, color: 'var(--cc-danger)' },
        ok ? 1_500 : 4_000
      );
    }, steps.length * 150 + 600);
  };

  const press = (b: DockButton, flip: () => void) => {
    if (ON_TABLET) {
      say(b.id, { text: 'Press it on the PC', color: 'var(--cc-muted)' });
      return;
    }
    if (b.kind === 'toggle') {
      flip();
      return;
    }
    // Opening something takes the front, which a stray tap mid-game must not.
    if (!sure(b.id)) {
      say(b.id, { text: 'Tap again', color: 'var(--cc-accent)' }, SURE_MS);
      return;
    }
    if (b.kind === 'scene') run(b, b.steps ?? []);
    else if (b.target) open(b.id, b.target, b.name);
  };

  const saidOf = (id: string): Said | undefined => said[id];
  return { press, saidOf };
}
