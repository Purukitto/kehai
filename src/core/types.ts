import type { ComponentType } from 'react';

/** Everything on the bus is one of these, whatever the source. */
export interface Envelope<T = unknown> {
  topic: string;
  ts: number;
  src: string;
  data: T;
}

/** Grid area as [rowStart, colStart, rowEnd, colEnd], 1-indexed, end-exclusive. */
export type Area = [number, number, number, number];

export interface Tile {
  widget: string;
  area: Area;
  props?: Record<string, unknown>;
}

export type ThemeId = 'amber' | 'phosphor' | 'ice';

export interface Layout {
  id: string;
  name: string;
  theme: ThemeId;
  grid: { cols: number; rows: number; gap: number };
  tiles: Tile[];
}

export interface WidgetProps {
  props: Record<string, unknown>;
}

/** What a widget module declares about itself. */
export interface WidgetSpec {
  /** Minimum size in grid cells, [cols, rows]. */
  min: [number, number];
  /** Topics it reads. Declared so the engine need not poll for nothing. */
  topics: string[];
  component: ComponentType<WidgetProps>;
}
