import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { bus } from './bus';
import { fill } from './game';
import type { GameWidget } from './game';
import { phaseOf, resultOf, statValues, statsOf, teamsOf, teamsState } from './gameState';
import type { Result } from './gameState';
import type { GamePayload } from './payloads';
import { GAME_DEFAULTS, useSettings } from './settings';
import { registry } from '../widgets/registry';

/**
 * What a game forgets between matches and the panel keeps: each match played,
 * how it ended and how the player did. And whether the player is in play
 * right now, which is when the panel should be still.
 *
 * Kept on this panel only, in its own storage, like the settings. Nothing in
 * it is more than the game sent while it was being played.
 */

export interface Played {
  /** When Kehai first heard the match, and last heard it. */
  at: number;
  end: number;
  title: string;
  /** `left` is a match given up on, or not heard to its end. */
  result: Result | 'left';
  /** The two sides' scores at the end, in the widget's order, and which was the player's. */
  score?: [number, number];
  you?: number;
  /** The player's own figures, by the label of each in the widget's stats reading. */
  stats: Record<string, number>;
}

const KEY = 'kehai.games.v1';
/** As many matches as a long weekend; older ones go first. */
const KEEP = 60;
/** Out of a match this long, with the game still open, and it is over unfinished. */
const MENU_GRACE_MS = 2 * 60_000;
/** A match left this soon was a wrong queue or a reconnect, not a match. */
const SHORTEST_MS = 3 * 60_000;
/** A gap this long between two matches starts another night. */
const NIGHT_GAP_MS = 3 * 60 * 60_000;
/**
 * How long out of play before the panel opens: a death in a mode where you
 * come straight back is not a gap.
 */
const RELEASE_MS = 4000;

function load(): Record<string, Played[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, Played[]> = {};
    for (const [id, list] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      out[id] = list.filter(
        (p): p is Played => !!p && typeof p === 'object' && typeof (p as Played).at === 'number' && typeof (p as Played).end === 'number'
      );
    }
    return out;
  } catch {
    return {};
  }
}

let played = load();
const NONE: Played[] = [];
const listeners = new Set<() => void>();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(played));
  } catch {
    // A panel that cannot store still shows tonight until it closes.
  }
  for (const l of listeners) l();
}

/** Reads the kept matches again, for the mock after it writes its sample night. */
export function reloadMatches() {
  played = load();
  for (const l of listeners) l();
}

/** Forgets every match kept for a game. */
export function forgetMatches(widget: string) {
  played = { ...played, [widget]: [] };
  save();
}

interface Current {
  at: number;
  end: number;
  title: string;
  data: unknown;
  /** The player's own state, from before they started watching someone. */
  own: unknown;
  leftAt?: number;
}

const current = new Map<string, Current>();

function finish(widget: string, g: GameWidget, cur: Current, left: boolean) {
  current.delete(widget);
  if (left && cur.end - cur.at < SHORTEST_MS) return;
  const teams = teamsOf(g, cur.data);
  const t = teams ? teamsState(teams, cur.data) : null;
  const a = t?.sides[0]?.n;
  const b = t?.sides[1]?.n;
  const stats = statsOf(g);
  const p: Played = {
    at: cur.at,
    end: cur.end,
    title: cur.title,
    result: left ? 'left' : resultOf(t),
    score: a !== undefined && b !== undefined ? [a, b] : undefined,
    you: t ? t.sides.findIndex((s) => s.you) : undefined,
    stats: Object.fromEntries(
      (stats ? statValues(stats, cur.own) : []).flatMap((i) => (i.v === undefined ? [] : [[i.label, i.v]]))
    ),
  };
  played = { ...played, [widget]: [...(played[widget] ?? []), p].slice(-KEEP) };
  save();
}

/** Follows one game's state: a match starts, goes on, and ends or is left. */
function record(widget: string, g: GameWidget, payload: GamePayload) {
  const data = payload.live ? payload.data : null;
  const ph = phaseOf(g, data);
  const now = payload.heardMs ?? Date.now();
  let cur = current.get(widget);
  if (ph.inMatch && !ph.over) {
    const title = fill(g.match.title, data) ?? '';
    if (cur && cur.title !== title) {
      finish(widget, g, cur, true);
      cur = undefined;
    }
    if (!cur) {
      cur = { at: now, end: now, title, data, own: data };
      current.set(widget, cur);
    }
    cur.end = now;
    cur.data = data;
    if (!ph.watching) cur.own = data;
    cur.leftAt = undefined;
    return;
  }
  if (!cur) return;
  if (ph.over) {
    cur.end = now;
    cur.data = data;
    if (!ph.watching) cur.own = data;
    finish(widget, g, cur, false);
    return;
  }
  // In the menu: maybe a reconnect, so only after a grace. The game closed: at once.
  cur.leftAt ??= now;
  if (!payload.live || now - cur.leftAt >= MENU_GRACE_MS) finish(widget, g, cur, true);
}

export interface Night {
  /** Most recent first. */
  matches: Played[];
  /** Time in matches, not counting the menu between them. */
  playedMs: number;
}

/**
 * Tonight's matches: the last run of them with no gap of three hours or more,
 * if the last ended within the past twelve.
 */
export function nightOf(list: Played[], now: number): Night {
  const out: Played[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    const next = out[out.length - 1];
    if (next ? next.at - p.end >= NIGHT_GAP_MS : now - p.end >= 12 * 60 * 60_000) break;
    out.push(p);
  }
  return { matches: out, playedMs: out.reduce((s, p) => s + Math.max(0, p.end - p.at), 0) };
}

export function useMatches(widget: string): Played[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => played[widget] ?? NONE
  );
}

export interface InPlay {
  widget: string;
  data: unknown;
  /**
   * When this stretch of play began: a tap that opens the panel lasts until the
   * next. A new round is a new stretch, as is coming back after dying.
   */
  since: number;
  round?: number;
}

/**
 * Records every game's matches, and says which game, if any, has the player
 * in play, for each game whose options leave the panel still while it does.
 * Coming out of play waits a few seconds; going in is at once.
 */
export function useGames(): InPlay | null {
  const { settings } = useSettings();
  const games = useRef(settings.games);
  games.current = settings.games;
  const [inPlay, setInPlay] = useState<InPlay | null>(null);
  const now = useRef(inPlay);
  now.current = inPlay;

  useEffect(() => {
    let release: number | undefined;
    const stop = bus.subscribe('game:*', (e) => {
      if (e.topic === 'game:setup') return;
      const widget = e.topic.slice('game:'.length);
      const g = registry[widget]?.game;
      if (!g) return;
      const payload = e.data as GamePayload;
      record(widget, g, payload);

      const still = (games.current[widget] ?? GAME_DEFAULTS).onMatch === 'still';
      const playing = still && payload.live && phaseOf(g, payload.data).playing;
      const was = now.current;
      if (playing) {
        window.clearTimeout(release);
        release = undefined;
        const teams = teamsOf(g, payload.data);
        const round = teams ? teamsState(teams, payload.data).round : undefined;
        const same = was?.widget === widget && was.round === round;
        setInPlay(same ? { ...was, data: payload.data } : { widget, data: payload.data, since: Date.now(), round });
      } else if (was?.widget === widget && release === undefined) {
        release = window.setTimeout(() => {
          release = undefined;
          setInPlay(null);
        }, RELEASE_MS);
      }
    });
    return () => {
      stop();
      window.clearTimeout(release);
    };
  }, []);

  return inPlay;
}
