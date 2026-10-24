import { useEffect, useState, useSyncExternalStore } from 'react';
import { p2 } from './format';
import type { DimLevel, NightSettings } from './settings';

/** How bright each level leaves what Kehai draws. */
export const DIM: Record<DimLevel, number> = { little: 0.7, half: 0.5, lot: 0.3 };

export const DIM_NAME: Record<DimLevel, string> = { little: 'A LITTLE', half: 'HALF', lot: 'A LOT' };

/** 1320 → 22:00. */
export const hhmm = (min: number): string => p2(Math.floor(min / 60)) + ':' + p2(min % 60);

/** Whether this minute falls in the night, which may run over midnight. */
export function inNight(now: Date, fromMin: number, toMin: number): boolean {
  const m = now.getHours() * 60 + now.getMinutes();
  if (fromMin === toMin) return false;
  return fromMin < toMin ? m >= fromMin && m < toMin : m >= fromMin || m < toMin;
}

/**
 * Whether it is night now, by this panel's clock. Looked at twice a minute,
 * and only a change re-renders, so the panel turns down within seconds of the
 * hour without redrawing every second.
 */
export function useNight(night: NightSettings): boolean {
  const { on, fromMin, toMin } = night;
  const [is, setIs] = useState(() => on && inNight(new Date(), fromMin, toMin));

  useEffect(() => {
    const look = () => setIs(on && inNight(new Date(), fromMin, toMin));
    look();
    const id = window.setInterval(look, 30_000);
    return () => window.clearInterval(id);
  }, [on, fromMin, toMin]);

  return is;
}

// A level being chosen in Settings, shown for a few seconds so it can be set
// by day. Kept here rather than in settings: it is never stored.
let preview: DimLevel | null = null;
let clear: number | undefined;
const listeners = new Set<() => void>();

export function previewDim(level: DimLevel): void {
  preview = level;
  window.clearTimeout(clear);
  clear = window.setTimeout(() => {
    preview = null;
    listeners.forEach((l) => l());
  }, 5000);
  listeners.forEach((l) => l());
}

export function useDimPreview(): DimLevel | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => preview
  );
}
