import { useRef } from 'react';

interface State {
  on: boolean;
  initialised: boolean;
}

/**
 * A boolean breakpoint with a dead zone.
 *
 * The first real measurement decides on the threshold alone — starting from a
 * default and refusing to move inside the dead zone strands a tile in the wrong
 * layout whenever it happens to open near the boundary.
 *
 * After that the value has to travel the full margin to flip again, so a size
 * sitting on the threshold cannot oscillate as sub-pixel rounding shifts it,
 * which is what a window moving between displays with different scaling does.
 */
export function useBreakpoint(value: number, threshold: number, margin = 16): boolean {
  const state = useRef<State>({ on: false, initialised: false });

  if (value <= 0) return state.current.on;

  if (!state.current.initialised) {
    state.current = { on: value < threshold, initialised: true };
    return state.current.on;
  }

  if (value < threshold - margin / 2) state.current.on = true;
  else if (value > threshold + margin / 2) state.current.on = false;

  return state.current.on;
}
