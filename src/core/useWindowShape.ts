import { useEffect, useState } from 'react';
import { shapeOf } from './layout';
import type { Shape } from './types';

export interface WindowShape {
  shape: Shape;
  width: number;
  height: number;
}

function measure(): WindowShape {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return { shape: shapeOf(width, height), width, height };
}

/**
 * Which shape of layout this window wants. Measured from the window rather
 * than the grid, so the header showing or hiding never flips the shape.
 */
export function useWindowShape(): WindowShape {
  const [state, setState] = useState<WindowShape>(measure);

  useEffect(() => {
    const onResize = () =>
      setState((prev) => {
        const next = measure();
        return prev.width === next.width && prev.height === next.height ? prev : next;
      });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return state;
}
