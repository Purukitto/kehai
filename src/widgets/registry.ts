import type { ComponentType } from 'react';
import type { WidgetProps, WidgetSpec } from '../core/types';
import { parseWidget, topicsOf } from '../core/widget';
import type { WidgetDescription } from '../core/widget';
import { Agents } from './Agents';
import { Clock } from './Clock';
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
const BUNDLED: WidgetDescription[] = [agents, clock, media, notify, quota, sprint, stage, telemetry, vitals].map((raw) =>
  parseWidget(raw)
);

function spec(widget: WidgetDescription): WidgetSpec {
  const component = COMPONENTS[widget.id];
  if (!component) throw new Error(`${widget.id}.widget.json has no component in the registry`);
  const options = (OPTIONS as Record<string, WidgetSpec['options']>)[widget.id];
  return { ...widget, topics: topicsOf(widget), component, options };
}

/**
 * The dynamic loader's table. A widget is only ever reached through this map,
 * so adding one never touches the grid, and a layout naming an unknown widget
 * renders a placeholder rather than crashing the panel.
 */
export const registry: Record<string, WidgetSpec> = Object.fromEntries(BUNDLED.map((w) => [w.id, spec(w)]));

export const widgetNames = Object.keys(registry).sort();

/** A widget's minimum size in cells, [cols, rows]; one cell for one nobody knows. */
export const minSize = (widget: string): [number, number] => registry[widget]?.min ?? [1, 1];
