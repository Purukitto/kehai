import type { WidgetSpec } from '../core/types';
import { clockSpec } from './Clock';
import { notifySpec } from './NotificationSink';
import { mediaSpec } from './NowPlaying';
import { quotaSpec } from './Quota';
import { sprintSpec } from './Sprint';
import { stageSpec } from './Stage';
import { telemetrySpec } from './Telemetry';
import { vitalsSpec } from './Vitals';

/**
 * The dynamic loader's table. A widget is only ever reached through this map,
 * so adding one never touches the grid, and a layout naming an unknown widget
 * renders a placeholder rather than crashing the panel.
 */
export const registry: Record<string, WidgetSpec> = {
  clock: clockSpec,
  media: mediaSpec,
  notify: notifySpec,
  quota: quotaSpec,
  sprint: sprintSpec,
  stage: stageSpec,
  telemetry: telemetrySpec,
  vitals: vitalsSpec,
};

export const widgetNames = Object.keys(registry).sort();
