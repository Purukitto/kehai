import { useEffect, useRef } from 'react';
import { bus } from './bus';
import type { BacklightCommand, BacklightPayload } from './payloads';
import { REMOTE_PANEL } from './remoteSource';
import type { DimLevel, QuietShow } from './settings';
import { useTopic } from './useTopic';

/**
 * What each night level does on a display Kehai can turn down: a share of
 * your level for the backlight, and how bright what Kehai draws stays. A
 * backlight at its lowest is still lit, so the last level darkens the drawing
 * as well; the others leave it at full contrast.
 */
export const NIGHT_BACKLIGHT: Record<DimLevel, { share: number; filter: number }> = {
  little: { share: 0.75, filter: 1 },
  half: { share: 0.45, filter: 1 },
  lot: { share: 0, filter: 0.6 },
};

/** The night level as a brightness, never above yours. */
export const nightLevel = (yours: number, level: DimLevel): number => Math.round(yours * NIGHT_BACKLIGHT[level].share);

/**
 * Where the display should be now, or null for yours. Night, a quiet panel and
 * a level being previewed each ask for a level, and the lowest wins. Locked is
 * left alone: the system's lock screen and its own display sleep have it.
 */
export function wantedLevel(
  yours: number,
  nightLevelSetting: DimLevel,
  night: boolean,
  quiet: QuietShow | 'blank' | null,
  preview: DimLevel | null
): number | null {
  const asks: number[] = [];
  if (preview) asks.push(nightLevel(yours, preview));
  if (night) asks.push(nightLevel(yours, nightLevelSetting));
  if (quiet === 'nothing') asks.push(0);
  if (quiet === 'clock' || quiet === 'panel') asks.push(nightLevel(yours, nightLevelSetting));
  return asks.length ? Math.min(...asks) : null;
}

/** The display Kehai is for, when it can turn it down. Never on a remote panel. */
export function useBacklight(): BacklightPayload | null {
  const heard = useTopic<BacklightPayload>('app:backlight');
  return REMOTE_PANEL || !heard?.available ? null : heard;
}

export function sendBacklight(command: BacklightCommand): void {
  bus.publish<BacklightCommand>('backlight:command', 'renderer', command);
}

/** Tells the engine where to hold the display, only when that changes. */
export function useHoldBacklight(level: number | null, on: boolean): void {
  const sent = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (!on) {
      sent.current = undefined;
      return;
    }
    if (sent.current === level) return;
    sent.current = level;
    sendBacklight({ action: 'hold', level });
  }, [level, on]);
}
