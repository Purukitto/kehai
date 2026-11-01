/**
 * The part of a widget's description file that lets it read a game: where the
 * state comes from, and what the tile shows of it.
 *
 * A widget like this is data, never code. Its file names a source kind Kehai
 * has (so far, `valve-gsi`: a Valve game sending its state to Kehai on this
 * PC), and lists readings, each drawn by a display Kehai has: `teams`,
 * `meters`, `numbers`, `item`, `stats` or `line`. Each reading points at
 * values in the game's state by path:
 *
 *   player.state.health          keys, one after another
 *   player.weapons.*             any one key's value
 *   player.weapons.*[state=active].name
 *                                the one whose `state` is `active`
 *
 * The readings come in order of importance: a small tile keeps the first.
 *
 * A game widget may bring its game's own colours, as hex, and light its tile's
 * edge the way RGB lighting does for the same game: the team's colour in buy
 * time, red while the bomb is down. Its options can swap them for the theme's
 * colours, or turn the lighting off.
 */

import type { GameSourceSpec } from './payloads';

export class GameFormatError extends Error {}

export interface GameSource extends GameSourceSpec {
  /** What the game is called, as Settings and SET UP name it. */
  game: string;
  /** Its short name, for a small tile's header. */
  short: string;
  /**
   * A small one-colour drawing for the game: an SVG path on a 16 × 16 grid,
   * drawn in the panel's colours. Never a game's own logo unless its
   * publisher allows that.
   */
  icon: string | null;
  /** What SET UP says the file asks the game for, in plain words. */
  asks: string[];
  /** What it never asks for. */
  never: string[];
}

/**
 * Whether something applies, by a value in the game's state: one of `is`, or a
 * number below `below` and above `above`. Any of the three that are given must hold.
 */
export interface Condition {
  path: string;
  is?: string[];
  below?: number;
  above?: number;
}

/** A colour as `#rrggbb`. */
export type Hex = string;

/** Which of the theme's colours stands in for a game's, when the theme's are chosen. */
export type Tone = 'first' | 'second' | 'danger' | 'ok' | 'text' | 'muted';

/** The first step a value is above gives its colour. */
export interface Ramp {
  above: number;
  color: Hex;
}

/** One way the tile's edge lights up; the first that holds wins. */
export interface EdgeRule {
  when: Condition;
  /** A colour, or the player's side's (`you`), or the side that won the round (`winner`). */
  color: Hex | 'you' | 'winner';
  /** Breathes slowly rather than staying lit. */
  pulse: boolean;
  tone: Tone;
}

/** A wash over the tile, as strong as the value is out of `max`: a flash, smoke. */
export interface Overlay {
  path: string;
  max: number;
  color: Hex;
  tone: Tone;
}

interface ReadingBase {
  id: string;
  /** For the options: what it is. */
  name: string;
  about: string;
  /** Shown unless a tile turns it off. A reading that is `false` here waits to be turned on. */
  on: boolean;
  when?: Condition;
  unless?: Condition;
  /**
   * The player's own, even while they watch someone else: the last value seen
   * while it was them is kept.
   */
  own: boolean;
}

export interface Side {
  label: string;
  /** The value of `you` that means the player is on this side. */
  is: string;
  score: string;
  /** Which accent: the second for the first side, by convention. */
  color: 'first' | 'second';
  /** The game's own colour for the side. */
  hex?: Hex;
  /** How the game's round results for this side start, such as `ct_`. */
  wins: string;
}

export interface Labels {
  path: string;
  labels: Record<string, string>;
}

export interface TeamsReading extends ReadingBase {
  display: 'teams';
  you: string;
  sides: [Side, Side];
  round?: { path: string; add: number; of?: { path: string; values: Record<string, number> } };
  /** Round number → result, as the game sends them. */
  history?: string;
  /** The first that has a label for its value names the phase. */
  phase: Labels[];
  alert?: { path: string; is: string[]; text: string };
  /** Which side won the round just played, by its `is`. */
  winner?: string;
}

export interface MeterItem {
  label: string;
  value: string;
  max: number;
  /** Below this, the value turns red. */
  low?: number;
  tag?: { path: string; text: string };
  /** The game's colours for it, by how high it is. */
  ramp: Ramp[];
  color?: Hex;
}

export interface MetersReading extends ReadingBase {
  display: 'meters';
  items: MeterItem[];
}

export interface NumberItem {
  label: string;
  value: string;
  prefix?: string;
  color?: Hex;
}

export interface NumbersReading extends ReadingBase {
  display: 'numbers';
  items: NumberItem[];
}

export interface ItemReading extends ReadingBase {
  display: 'item';
  label: string;
  /** What it is, as the game calls it. */
  item: string;
  /** Proper names for what the game calls things. */
  names: Record<string, string>;
  /** Taken off the start of a name not in `names`. */
  strip: string;
  count?: string;
  max?: string;
  rest?: string;
  /** When what is left of `max` is under this share, it takes this colour. */
  low?: { below: number; color: Hex };
}

export interface StatsReading extends ReadingBase {
  display: 'stats';
  label: string;
  items: { label: string; short: string; value: string }[];
}

export interface LineReading extends ReadingBase {
  display: 'line';
  label: string;
  /** Text with `{path}` for each value. */
  text: string;
}

export type Reading = TeamsReading | MetersReading | NumbersReading | ItemReading | StatsReading | LineReading;

export interface GameWidget {
  source: GameSource;
  /** When the game is in a match, what its header says, and when it is over. */
  match: { in: string; title: string; phase?: string; over: string[] };
  /** Who the state is about, when the game can show someone else's. */
  subject?: { self: string; who: string; name: string; tag: string };
  readings: Reading[];
  lighting: { edge: EdgeRule[]; overlays: Overlay[] };
}

/** The source kinds Kehai has. A file asking for another is listed, not loaded. */
export const SOURCE_KINDS = ['valve-gsi'];

// ------------------------------------------------------------------ paths

const SEGMENT = /^([A-Za-z0-9_]+|\*(\[[A-Za-z0-9_]+=[A-Za-z0-9_ .-]+\])?)$/;

export function isPath(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 120 && v.split('.').every((s) => SEGMENT.test(s));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The value at a path, or undefined. */
export function get(data: unknown, path: string): unknown {
  let at: unknown = data;
  for (const segment of path.split('.')) {
    if (!isRecord(at)) return undefined;
    if (segment.startsWith('*')) {
      const filter = /^\*\[([^=]+)=(.+)\]$/.exec(segment);
      const values = Object.values(at);
      at = filter ? values.find((v) => isRecord(v) && String(v[filter[1]]) === filter[2]) : values[0];
    } else {
      at = at[segment];
    }
  }
  return at;
}

export function text(data: unknown, path: string): string | undefined {
  const v = get(data, path);
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined;
}

export function num(data: unknown, path: string | undefined): number | undefined {
  if (!path) return undefined;
  const v = get(data, path);
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** `{path}` replaced by each value; undefined if one is missing. */
export function fill(template: string, data: unknown): string | undefined {
  let missing = false;
  const out = template.replace(/\{([^}]+)\}/g, (_, path: string) => {
    const v = text(data, path);
    if (v === undefined) missing = true;
    return (v ?? '').toUpperCase();
  });
  return missing ? undefined : out;
}

export function holds(data: unknown, c: Condition | undefined): boolean {
  if (!c) return false;
  if (c.is) {
    const v = text(data, c.path);
    if (v === undefined || !c.is.includes(v)) return false;
  }
  if (c.below !== undefined || c.above !== undefined) {
    const n = num(data, c.path);
    if (n === undefined) return false;
    if (c.below !== undefined && !(n < c.below)) return false;
    if (c.above !== undefined && !(n > c.above)) return false;
  }
  return true;
}

/** The colour a ramp gives a value. */
export function ramp(steps: Ramp[], value: number): Hex | undefined {
  return steps.find((r) => value > r.above)?.color;
}

/** Whether a reading applies to this state at all. */
export function applies(r: Reading, data: unknown): boolean {
  if (r.when && !holds(data, r.when)) return false;
  return !holds(data, r.unless);
}

// --------------------------------------------------------------- checking

function fail(id: string, what: string): never {
  throw new GameFormatError(`${id}: ${what}`);
}

const str = (v: unknown, id: string, what: string, max = 200): string => {
  if (typeof v !== 'string' || !v || v.length > max) fail(id, `${what} must be a short piece of text`);
  return v;
};

const path = (v: unknown, id: string, what: string): string => {
  if (!isPath(v)) fail(id, `${what} must be a path such as player.state.health`);
  return v;
};

const optPath = (v: unknown, id: string, what: string): string | undefined => (v === undefined ? undefined : path(v, id, what));

function strings(v: unknown, id: string, what: string, max = 24): string[] {
  if (!Array.isArray(v) || v.length > max || !v.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 200)) {
    fail(id, `${what} must be a list of text`);
  }
  return v as string[];
}

function record<T>(v: unknown, id: string, what: string, check: (x: unknown) => x is T): Record<string, T> {
  if (v === undefined) return {};
  if (!isRecord(v) || !Object.values(v).every(check)) fail(id, `${what} must map names to values`);
  return v as Record<string, T>;
}

const isString = (x: unknown): x is string => typeof x === 'string';
const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function condition(v: unknown, id: string, what: string): Condition | undefined {
  if (v === undefined) return undefined;
  if (!isRecord(v)) fail(id, `${what} must be { "path", "is" } or { "path", "below", "above" }`);
  const c: Condition = {
    path: path(v.path, id, `${what}.path`),
    is: v.is === undefined ? undefined : strings(v.is, id, `${what}.is`),
    below: v.below === undefined ? undefined : isNumber(v.below) ? v.below : fail(id, `${what}.below must be a number`),
    above: v.above === undefined ? undefined : isNumber(v.above) ? v.above : fail(id, `${what}.above must be a number`),
  };
  if (!c.is && c.below === undefined && c.above === undefined) fail(id, `${what} needs "is", "below" or "above"`);
  return c;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const TONES: Tone[] = ['first', 'second', 'danger', 'ok', 'text', 'muted'];

function hex(v: unknown, id: string, what: string): Hex {
  if (typeof v !== 'string' || !HEX.test(v)) fail(id, `${what} must be a colour such as #e8a43c`);
  return v;
}

const optHex = (v: unknown, id: string, what: string): Hex | undefined => (v === undefined ? undefined : hex(v, id, what));

function tone(v: unknown, id: string, what: string, fallback: Tone): Tone {
  if (v === undefined) return fallback;
  if (typeof v !== 'string' || !TONES.includes(v as Tone)) fail(id, `${what} must be one of ${TONES.join(', ')}`);
  return v as Tone;
}

function ramps(v: unknown, id: string, what: string): Ramp[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 8) fail(id, `${what} must list up to 8 steps`);
  return v.map((r, i) =>
    isRecord(r) && isNumber(r.above)
      ? { above: r.above, color: hex(r.color, id, `${what}[${i}].color`) }
      : fail(id, `${what}[${i}] must be { "above", "color" }`)
  );
}

function lighting(v: unknown, id: string): GameWidget['lighting'] {
  if (v === undefined) return { edge: [], overlays: [] };
  if (!isRecord(v)) fail(id, 'lighting must be { "edge", "overlays" }');
  const list = (x: unknown, what: string) => {
    if (x === undefined) return [];
    if (!Array.isArray(x) || x.length > 12) fail(id, `lighting.${what} must list up to 12`);
    return x.map((r, i) => (isRecord(r) ? r : fail(id, `lighting.${what}[${i}] must be an object`)));
  };
  return {
    edge: list(v.edge, 'edge').map((r, i) => {
      const where = `lighting.edge[${i}]`;
      const color = r.color === 'you' || r.color === 'winner' ? r.color : hex(r.color, id, `${where}.color`);
      return {
        when: condition(r.when, id, `${where}.when`) ?? fail(id, `${where}.when is needed`),
        color,
        pulse: r.pulse === true,
        tone: tone(r.tone, id, `${where}.tone`, 'second'),
      };
    }),
    overlays: list(v.overlays, 'overlays').map((r, i) => {
      const where = `lighting.overlays[${i}]`;
      return {
        path: path(r.path, id, `${where}.path`),
        max: isNumber(r.max) && r.max > 0 ? r.max : fail(id, `${where}.max must be a number above 0`),
        color: hex(r.color, id, `${where}.color`),
        tone: tone(r.tone, id, `${where}.tone`, 'text'),
      };
    }),
  };
}

function source(v: unknown, id: string): GameSource {
  if (!isRecord(v)) fail(id, 'source must be an object');
  const kind = v.kind;
  if (typeof kind !== 'string' || !SOURCE_KINDS.includes(kind)) {
    fail(id, `asks for a ${String(kind).toUpperCase()} source, which this Kehai doesn’t have`);
  }
  const app = v.steamApp;
  if (!Number.isInteger(app) || (app as number) <= 0) fail(id, 'source.steamApp must be the game’s Steam app id');
  const cfgDir = str(v.cfgDir, id, 'source.cfgDir', 120);
  if (cfgDir.split(/[\\/]/).some((p) => p === '' || p === '.' || p === '..') || /^[A-Za-z]:/.test(cfgDir)) {
    fail(id, 'source.cfgDir must be a folder inside the game’s');
  }
  const data = strings(v.data, id, 'source.data');
  if (!data.length || !data.every((d) => /^[a-z_]{1,32}$/.test(d))) fail(id, 'source.data must name the blocks to ask for');
  const game = str(v.game, id, 'source.game', 60);
  return {
    kind: 'valve-gsi',
    steamApp: app as number,
    cfgDir,
    data,
    game,
    short: v.short === undefined ? game : str(v.short, id, 'source.short', 12),
    icon: v.icon === undefined ? null : icon(v.icon, id),
    asks: v.asks === undefined ? [] : strings(v.asks, id, 'source.asks', 8),
    never: v.never === undefined ? [] : strings(v.never, id, 'source.never', 8),
  };
}

/** Path commands and numbers only: nothing in it can reach outside the drawing. */
function icon(v: unknown, id: string): string {
  if (typeof v !== 'string' || !v || v.length > 600 || !/^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/.test(v)) {
    fail(id, 'source.icon must be an SVG path on a 16 × 16 grid');
  }
  return v;
}

function labels(v: unknown, id: string, what: string): Labels {
  if (!isRecord(v)) fail(id, `${what} must be { "path", "labels" }`);
  return { path: path(v.path, id, `${what}.path`), labels: record(v.labels, id, `${what}.labels`, isString) };
}

function reading(v: unknown, at: number, id: string): Reading {
  if (!isRecord(v)) fail(id, `readings[${at}] must be an object`);
  const rid = typeof v.id === 'string' && /^[a-z][a-z0-9-]*$/.test(v.id) ? v.id : fail(id, `readings[${at}].id must be lower-case letters`);
  const where = `${id}.${rid}`;
  const base: ReadingBase = {
    id: rid,
    name: str(v.name, where, 'name', 60),
    about: str(v.about, where, 'about'),
    on: v.on !== false,
    when: condition(v.when, where, 'when'),
    unless: condition(v.unless, where, 'unless'),
    own: v.own === true,
  };
  const items = <T>(each: (x: Record<string, unknown>, i: number) => T): T[] => {
    if (!Array.isArray(v.items) || !v.items.length || v.items.length > 8) fail(where, 'items must list 1 to 8');
    return v.items.map((x, i) => (isRecord(x) ? each(x, i) : fail(where, `items[${i}] must be an object`)));
  };
  switch (v.display) {
    case 'teams': {
      if (!Array.isArray(v.sides) || v.sides.length !== 2) fail(where, 'sides must list two');
      const sides = v.sides.map((s, i) => {
        if (!isRecord(s)) fail(where, `sides[${i}] must be an object`);
        return {
          label: str(s.label, where, 'side label', 12),
          is: str(s.is, where, 'side is', 40),
          score: path(s.score, where, 'side score'),
          color: s.color === 'first' ? 'first' : 'second',
          hex: optHex(s.hex, where, 'side hex'),
          wins: typeof s.wins === 'string' ? s.wins : '',
        } satisfies Side;
      }) as [Side, Side];
      const round = v.round;
      let r: TeamsReading['round'];
      if (round !== undefined) {
        if (!isRecord(round)) fail(where, 'round must be an object');
        const of = round.of;
        r = {
          path: path(round.path, where, 'round.path'),
          add: isNumber(round.add) ? round.add : 0,
          of:
            of === undefined
              ? undefined
              : isRecord(of)
                ? { path: path(of.path, where, 'round.of.path'), values: record(of.values, where, 'round.of.values', isNumber) }
                : fail(where, 'round.of must be { "path", "values" }'),
        };
      }
      const alert = v.alert;
      return {
        ...base,
        display: 'teams',
        you: path(v.you, where, 'you'),
        sides,
        round: r,
        history: optPath(v.history, where, 'history'),
        phase: Array.isArray(v.phase) ? v.phase.map((p, i) => labels(p, where, `phase[${i}]`)) : [],
        alert:
          alert === undefined
            ? undefined
            : isRecord(alert)
              ? { path: path(alert.path, where, 'alert.path'), is: strings(alert.is, where, 'alert.is'), text: str(alert.text, where, 'alert.text', 30) }
              : fail(where, 'alert must be { "path", "is", "text" }'),
        winner: optPath(v.winner, where, 'winner'),
      };
    }
    case 'meters':
      return {
        ...base,
        display: 'meters',
        items: items((x) => ({
          label: str(x.label, where, 'label', 30),
          value: path(x.value, where, 'value'),
          max: isNumber(x.max) && x.max > 0 ? x.max : fail(where, 'max must be a number above 0'),
          low: isNumber(x.low) ? x.low : undefined,
          tag: isRecord(x.tag) ? { path: path(x.tag.path, where, 'tag.path'), text: str(x.tag.text, where, 'tag.text', 20) } : undefined,
          ramp: ramps(x.ramp, where, 'ramp'),
          color: optHex(x.color, where, 'color'),
        })),
      };
    case 'numbers':
      return {
        ...base,
        display: 'numbers',
        items: items((x) => ({
          label: str(x.label, where, 'label', 30),
          value: path(x.value, where, 'value'),
          prefix: typeof x.prefix === 'string' ? x.prefix.slice(0, 4) : undefined,
          color: optHex(x.color, where, 'color'),
        })),
      };
    case 'item':
      return {
        ...base,
        display: 'item',
        label: str(v.label, where, 'label', 30),
        item: path(v.item, where, 'item'),
        names: record(v.names, where, 'names', isString),
        strip: typeof v.strip === 'string' ? v.strip : '',
        count: optPath(v.count, where, 'count'),
        max: optPath(v.max, where, 'max'),
        rest: optPath(v.rest, where, 'rest'),
        low: isRecord(v.low)
          ? {
              below: isNumber(v.low.below) ? v.low.below : fail(where, 'low.below must be a share such as 0.25'),
              color: hex(v.low.color, where, 'low.color'),
            }
          : undefined,
      };
    case 'stats':
      return {
        ...base,
        display: 'stats',
        label: str(v.label, where, 'label', 30),
        items: items((x) => ({
          label: str(x.label, where, 'label', 20),
          short: typeof x.short === 'string' ? x.short.slice(0, 4) : String(x.label).slice(0, 1),
          value: path(x.value, where, 'value'),
        })),
      };
    case 'line':
      return { ...base, display: 'line', label: str(v.label, where, 'label', 30), text: str(v.text, where, 'text') };
    default:
      return fail(where, `there is no display called ${String(v.display)}`);
  }
}

/** Checks a widget file's game part. Throws a GameFormatError saying what is wrong. */
export function parseGame(input: Record<string, unknown>, id: string): GameWidget {
  const src = source(input.source, id);
  const m = input.match;
  if (!isRecord(m)) fail(id, 'match must say when the game is in a match');
  const s = input.subject;
  if (!Array.isArray(input.readings) || !input.readings.length || input.readings.length > 12) {
    fail(id, 'readings must list 1 to 12');
  }
  const readings = input.readings.map((r, i) => reading(r, i, id));
  const ids = readings.map((r) => r.id);
  if (new Set(ids).size !== ids.length) fail(id, 'each reading needs its own id');
  return {
    source: src,
    match: {
      in: path(m.in, id, 'match.in'),
      title: str(m.title, id, 'match.title', 80),
      phase: optPath(m.phase, id, 'match.phase'),
      over: m.over === undefined ? [] : strings(m.over, id, 'match.over'),
    },
    subject:
      s === undefined
        ? undefined
        : isRecord(s)
          ? {
              self: path(s.self, id, 'subject.self'),
              who: path(s.who, id, 'subject.who'),
              name: path(s.name, id, 'subject.name'),
              tag: str(s.tag, id, 'subject.tag', 16),
            }
          : fail(id, 'subject must be { "self", "who", "name", "tag" }'),
    readings,
    lighting: lighting(input.lighting, id),
  };
}

/** Only what the engine needs, so nothing else in a file reaches it. */
export function engineSource(s: GameSource): GameSourceSpec {
  return { kind: s.kind, steamApp: s.steamApp, cfgDir: s.cfgDir, data: s.data };
}
