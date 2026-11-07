import { useEffect, useRef, useState } from 'react';
import { REMOTE_PANEL } from './remoteSource';
import { isTauri } from './tauriSource';
import { useTopic } from './useTopic';
import type { PresencePayload } from './payloads';

/**
 * Taps that bring something to the front on the PC: an agent's window, a
 * notification's app.
 *
 * A tablet can't: Windows lets only the program you last touched take the
 * front. `?tablet` draws it in the mock.
 */
export const ON_TABLET = REMOTE_PANEL || (!isTauri() && new URLSearchParams(location.search).has('tablet'));

/** How long a row says what its tap did, before it goes back to its time. */
export const SAID_MS = 1_500;

/** How long a first tap waits for the second while something is full screen. */
export const SURE_MS = 3_000;

export interface Said {
  text: string;
  color: string;
}

/** True while a game or a video fills a display, by Windows' own account. */
export function useFullScreen(): boolean {
  return Boolean(useTopic<PresencePayload>('os:presence')?.fullscreen);
}

/**
 * What the last tap on each row led to, for a moment. One per widget, shared
 * by its rows.
 */
export function useSaid() {
  const [said, setSaid] = useState<Record<string, Said>>({});
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const live = timers.current;
    return () => live.forEach((t) => window.clearTimeout(t));
  }, []);

  const say = (key: string, s: Said, ms = SAID_MS) => {
    setSaid((prev) => ({ ...prev, [key]: s }));
    window.clearTimeout(timers.current.get(key));
    timers.current.set(
      key,
      window.setTimeout(() => {
        timers.current.delete(key);
        setSaid(({ [key]: _, ...rest }) => rest);
      }, ms)
    );
  };

  return { said, say };
}

/**
 * While something is full screen, a stray tap on the panel must not pull it
 * out of the front: the first tap on a row only arms it, and a second on the
 * same row within `SURE_MS` goes. Returns whether this tap may go.
 */
export function useSure() {
  const full = useFullScreen();
  const armed = useRef<{ key: string; until: number } | null>(null);
  return (key: string): boolean => {
    if (!full) return true;
    const now = Date.now();
    if (armed.current?.key === key && now < armed.current.until) {
      armed.current = null;
      return true;
    }
    armed.current = { key, until: now + SURE_MS };
    return false;
  };
}
