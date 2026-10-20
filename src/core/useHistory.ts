import { useRef } from 'react';

/**
 * Keeps the last `length` values of a live reading.
 *
 * The engine publishes point-in-time samples, not series — a widget that wants
 * a sparkline accumulates its own. Keeping it here rather than in the bus means
 * history costs nothing for the widgets that do not draw one.
 */
export function useHistory(value: number | undefined, length = 56): number[] {
  const buffer = useRef<number[]>([]);
  const last = useRef<number | undefined>(undefined);

  if (value !== undefined && value !== last.current) {
    last.current = value;
    buffer.current = [...buffer.current, value].slice(-length);
  }

  return buffer.current;
}
