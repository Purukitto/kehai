import { GameFormatError, parseGame } from './game';
import type { GameWidget } from './game';
import { SOURCES, isSourceId } from './sources';
import type { SourceId } from './sources';

/**
 * Validates a widget's description file into the typed shape.
 *
 * Every widget has one: `src/widgets/<id>.widget.json` for the ones Kehai
 * ships, and the same format for widgets that come from somewhere else. It
 * says what the widget is called, what it shows, the smallest tile it fits
 * and the sources it reads; the code that draws it is found by its id. JSON
 * imports widen tuples to arrays, so even the files that ship go through here.
 *
 * A widget that reads a game brings its own source instead, and readings drawn
 * by displays Kehai has, so it needs no code of its own: see `game.ts`.
 */

export class WidgetError extends Error {}

/** The `kehai` field of a description file, so a later format can tell this one apart. */
export const WIDGET_FORMAT = 1;

export interface WidgetDescription {
  id: string;
  /** What it is called anywhere a person reads it: Settings, the arranger. */
  name: string;
  /** One line on what it shows. */
  about: string;
  /** Minimum size in grid cells, [cols, rows]. */
  min: [number, number];
  /** The sources it reads, by id. None for a widget that brings its own. */
  sources: SourceId[];
  /** For a widget that reads a game: its source and readings. */
  game?: GameWidget;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseWidget(input: unknown): WidgetDescription {
  if (!isRecord(input)) throw new WidgetError('widget must be an object');
  const { kehai, id, name, about, min, sources } = input;
  if (kehai !== WIDGET_FORMAT) throw new WidgetError(`widget.kehai must be ${WIDGET_FORMAT}`);
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new WidgetError('widget.id must be lower-case letters, digits and hyphens');
  }
  if (typeof name !== 'string' || !name) throw new WidgetError(`${id}: name must be a non-empty string`);
  if (typeof about !== 'string' || !about) throw new WidgetError(`${id}: about must be a non-empty string`);
  if (!Array.isArray(min) || min.length !== 2 || !min.every((n) => Number.isInteger(n) && n >= 1 && n <= 16)) {
    throw new WidgetError(`${id}: min must be [cols, rows], each 1-16`);
  }
  const description = { id, name, about, min: [min[0], min[1]] as [number, number] };
  if (input.source !== undefined) {
    try {
      return { ...description, sources: [], game: parseGame(input, id) };
    } catch (err) {
      throw err instanceof GameFormatError ? new WidgetError(err.message) : err;
    }
  }
  if (!Array.isArray(sources) || !sources.length) throw new WidgetError(`${id}: sources must name at least one source`);
  const unknown = sources.find((s) => !isSourceId(s));
  if (unknown !== undefined) throw new WidgetError(`${id}: there is no source called ${String(unknown)}`);
  return { ...description, sources: [...new Set(sources as SourceId[])] };
}

/** Every topic a widget's sources publish on, in the order its sources are listed. */
export function topicsOf(widget: WidgetDescription): string[] {
  if (widget.game) return [`game:${widget.id}`];
  return [...new Set(widget.sources.flatMap((s) => SOURCES[s].topics))];
}
