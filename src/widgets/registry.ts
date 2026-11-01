import { createElement, useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import { bus } from '../core/bus';
import type { LocalWidgetsPayload } from '../core/payloads';
import type { OptionsProps, WidgetProps, WidgetSpec } from '../core/types';
import { WidgetError, parseWidget, topicsOf } from '../core/widget';
import type { WidgetDescription } from '../core/widget';
import { Agents } from './Agents';
import { Clock } from './Clock';
import { GameTile } from './Game';
import type { GameDescription } from './Game';
import { GameOptions } from './gameOptions';
import { NotificationSink } from './NotificationSink';
import { NowPlaying } from './NowPlaying';
import { Quota } from './Quota';
import { Sprint } from './Sprint';
import { Stage } from './Stage';
import { Telemetry } from './Telemetry';
import { Vitals } from './Vitals';
import { OPTIONS } from './options';
import agents from './agents.widget.json';
import clock from './clock.widget.json';
import cs2 from './cs2.widget.json';
import media from './media.widget.json';
import notify from './notify.widget.json';
import quota from './quota.widget.json';
import sprint from './sprint.widget.json';
import stage from './stage.widget.json';
import telemetry from './telemetry.widget.json';
import vitals from './vitals.widget.json';

/** The code that draws each widget Kehai ships with, by the id in its description file. */
const COMPONENTS: Record<string, ComponentType<WidgetProps>> = {
  agents: Agents,
  clock: Clock,
  media: NowPlaying,
  notify: NotificationSink,
  quota: Quota,
  sprint: Sprint,
  stage: Stage,
  telemetry: Telemetry,
  vitals: Vitals,
};

/** Bundled with Kehai and updated with it. */
const BUNDLED: WidgetDescription[] = [agents, clock, cs2, media, notify, quota, sprint, stage, telemetry, vitals].map((raw) =>
  parseWidget(raw)
);

/**
 * A game widget is drawn and set from its file alone, by the same component
 * as every other, so it needs no entry in the tables above.
 */
function spec(widget: WidgetDescription, local = false): WidgetSpec {
  const topics = topicsOf(widget);
  if (widget.game) {
    const game = widget as GameDescription;
    const component = ({ props }: WidgetProps) => createElement(GameTile, { widget: game, props });
    const options = (p: OptionsProps) => createElement(GameOptions, { ...p, widget: game });
    return { ...widget, topics, component, options, local };
  }
  const component = COMPONENTS[widget.id];
  if (!component) throw new Error(`${widget.id}.widget.json has no component in the registry`);
  const options = (OPTIONS as Record<string, WidgetSpec['options']>)[widget.id];
  return { ...widget, topics, component, options, local };
}

/**
 * The dynamic loader's table. A widget is only ever reached through this map,
 * so adding one never touches the grid, and a layout naming an unknown widget
 * renders a placeholder rather than crashing the panel. Widgets from the
 * widgets folder join it as their files arrive.
 */
export const registry: Record<string, WidgetSpec> = Object.fromEntries(BUNDLED.map((w) => [w.id, spec(w)]));

export const widgetNames: string[] = Object.keys(registry).sort();

/** A widget's minimum size in cells, [cols, rows]; one cell for one nobody knows. */
export const minSize = (widget: string): [number, number] => registry[widget]?.min ?? [1, 1];

// ------------------------------------------------------ the widgets folder

/** One file in the widgets folder, loaded or not, and why not. */
export interface LocalFile {
  name: string;
  id: string | null;
  error: string | null;
}

let folder = '';
let files: LocalFile[] = [];
let version = 0;
const listeners = new Set<() => void>();

/**
 * Checks each file the way the widgets Kehai ships are checked, and adds the
 * ones that pass. Only a widget that brings its own source can come from the
 * folder: anything else would need code, and the folder never brings code.
 */
function loadLocal(payload: LocalWidgetsPayload) {
  for (const id of Object.keys(registry)) if (registry[id].local) delete registry[id];
  folder = payload.folder;
  files = payload.files.map((f): LocalFile => {
    if (f.error !== null || f.text === null) return { name: f.name, id: null, error: f.error ?? 'Could not be read.' };
    try {
      const widget = parseWidget(JSON.parse(f.text));
      if (!widget.game) return { name: f.name, id: widget.id, error: 'Brings no source of its own, so it would need code. Only game widgets come from this folder.' };
      if (registry[widget.id]) {
        return { name: f.name, id: widget.id, error: registry[widget.id].local ? `Another file here is already ${widget.id}.` : `${widget.id} is the id of a widget Kehai comes with.` };
      }
      registry[widget.id] = spec(widget, true);
      return { name: f.name, id: widget.id, error: null };
    } catch (err) {
      const why = err instanceof SyntaxError ? `Not valid JSON: ${err.message}` : err instanceof WidgetError ? err.message : String(err);
      return { name: f.name, id: null, error: why };
    }
  });
  widgetNames.splice(0, widgetNames.length, ...Object.keys(registry).sort());
  version += 1;
  listeners.forEach((l) => l());
}

bus.subscribe('widgets:local', (e) => loadLocal(e.data as LocalWidgetsPayload));

/** The widgets folder and what is in it. */
export function localWidgets(): { folder: string; files: LocalFile[] } {
  return { folder, files };
}

/** Re-renders the caller when widgets join or leave the table. */
export function useRegistry(): number {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => version
  );
}
