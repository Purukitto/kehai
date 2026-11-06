import { get, holds, num, text } from './game';
import type { GameWidget, Side, StatsReading, TeamsReading } from './game';

/**
 * What a game's state says, read through its widget file: the score, whose
 * state it is, whether the player is in play. Shared by the tile, the still
 * panel and the record of tonight's matches, so all three agree.
 */

export type ScoredSide = Side & { n?: number; you: boolean };

export interface TeamsState {
  sides: ScoredSide[];
  round?: number;
  of?: number;
  alert: string | null;
  phase: string | null;
  /** Each round played, by the index of the side that won it, or -1. */
  results: number[];
}

export function teamsState(r: TeamsReading, data: unknown): TeamsState {
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

export function statValues(r: StatsReading, data: unknown) {
  return r.items.map((i) => ({ ...i, v: num(data, i.value) }));
}

export const teamsOf = (g: GameWidget, data: unknown): TeamsReading | undefined =>
  g.readings.find((r): r is TeamsReading => r.display === 'teams' && !holds(data, r.unless) && (!r.when || holds(data, r.when)));

export const statsOf = (g: GameWidget): StatsReading | undefined => g.readings.find((r): r is StatsReading => r.display === 'stats');

export interface Phase {
  /** In a match at all. */
  inMatch: boolean;
  over: boolean;
  /** Someone else's state, by name, while the player watches them. */
  watching: string | null;
  /** In play: the panel has no business being looked at. */
  playing: boolean;
}

export function phaseOf(g: GameWidget, data: unknown): Phase {
  const inMatch = data !== null && data !== undefined && get(data, g.match.in) !== undefined;
  const over = g.match.phase !== undefined && g.match.over.includes(text(data, g.match.phase) ?? '');
  const self = g.subject ? text(data, g.subject.self) : undefined;
  const who = g.subject ? text(data, g.subject.who) : undefined;
  const watching = g.subject && self !== undefined && who !== undefined && self !== who ? (text(data, g.subject.name) ?? '?') : null;
  const playing = inMatch && !over && watching === null && (g.match.still ? holds(data, g.match.still) : true);
  return { inMatch, over, watching, playing };
}

export type Result = 'won' | 'lost' | 'tied' | 'played';

/** How a match ended for the player, by the score of their side against the other. */
export function resultOf(t: TeamsState | null): Result {
  const mine = t?.sides.find((s) => s.you);
  const theirs = t?.sides.find((s) => !s.you);
  if (!mine || mine.n === undefined || theirs?.n === undefined) return 'played';
  return mine.n > theirs.n ? 'won' : mine.n < theirs.n ? 'lost' : 'tied';
}
