import type { ComponentType } from 'react';
import type { WidgetDescription } from './widget';

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

/**
 * The display shapes a layout is drawn for: anything from square to 2.4 : 1,
 * anything wider, and anything taller than it is wide. Kehai picks one from
 * the shape of its window.
 */
export type Shape = 'landscape' | 'bar' | 'portrait';

export interface GridSize {
  cols: number;
  rows: number;
  gap: number;
}

/** Where the tiles sit on one shape of display. */
export interface Arrangement {
  grid: GridSize;
  tiles: Tile[];
}

/**
 * One arrangement per shape, so the same layout reads well on a 16:10 panel,
 * a bar display and a tablet on its side instead of being stretched to fit.
 * The theme is not part of a layout: changing layout never changes colours.
 */
export interface Layout {
  id: string;
  name: string;
  shapes: Record<Shape, Arrangement>;
}

export interface WidgetProps {
  props: Record<string, unknown>;
}

/**
 * What a widget's options are drawn with. `tile` is the tile they were opened
 * from, by its place in the arrangement on screen: an option kept with one
 * tile needs it. Null when they were opened from Settings and the widget is
 * not on screen.
 */
export interface OptionsProps {
  tile: number | null;
}

/** A widget as the grid reaches it: its description file, and the code that draws it. */
export interface WidgetSpec extends WidgetDescription {
  /** Every topic its sources publish on. Declared so the engine need not poll for nothing. */
  topics: string[];
  component: ComponentType<WidgetProps>;
  /** Its options, for the ones that have any. */
  options?: ComponentType<OptionsProps>;
}
