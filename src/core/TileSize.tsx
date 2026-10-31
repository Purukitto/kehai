import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface Size {
  w: number;
  h: number;
}

const TileSizeContext = createContext<Size>({ w: 0, h: 0 });

export function useTileSize(): Size {
  return useContext(TileSizeContext);
}

/**
 * Measures the grid cell and hands the size down.
 *
 * The measured element is a grid item on `minmax(0, 1fr)` tracks, so its size
 * comes from the track and never from its own content. Measuring the widget's
 * own root instead sets up a feedback loop: the widget picks a compact layout,
 * the content shrinks, the element shrinks, and it flips back — which on a
 * display where a row lands near a breakpoint reads as flicker.
 *
 * First measurement is taken in a layout effect, before paint, so no frame is
 * spent rendering a layout the tile is too small for.
 */
export function TileSizeProvider({
  children,
  style,
  handlers,
}: {
  children: ReactNode;
  style: React.CSSProperties;
  /** Anything else the tile listens for, such as a long press. */
  handlers?: React.HTMLAttributes<HTMLDivElement>;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const apply = (w: number, h: number) => {
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };

    const rect = el.getBoundingClientRect();
    apply(Math.round(rect.width), Math.round(rect.height));

    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) apply(Math.round(box.width), Math.round(box.height));
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={style} {...handlers}>
      <TileSizeContext.Provider value={size}>{children}</TileSizeContext.Provider>
    </div>
  );
}
