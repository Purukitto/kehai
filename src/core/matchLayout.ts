import { useCallback, useEffect, useRef, useState } from 'react';
import { bus } from './bus';
import { get, text } from './game';
import type { GamePayload } from './payloads';
import { REMOTE_PANEL } from './remoteSource';
import { useSettings } from './settings';
import { registry } from '../widgets/registry';

/** Out of a match this long and it is over, whatever the game says. */
const MENU_GRACE_MS = 2 * 60_000;

/**
 * What a live match does to the panel, as each game's options say: nothing,
 * another layout on screen, or the game's tile full screen. Either goes back
 * when the match ends, or after two minutes in the menu. A layout picked, or
 * full screen left, by hand during the match stays as chosen, and that match
 * does not switch again.
 *
 * Also the game tile full screen by hand: a tap on it. That one stays until
 * it is tapped again.
 */
export function useMatchLayout(): { full: string | null; setFull: (widget: string | null) => void } {
  const { settings, setMatchLayout } = useSettings();
  const now = useRef(settings);
  now.current = settings;
  const set = useRef(setMatchLayout);
  set.current = setMatchLayout;
  const [full, setFullState] = useState<string | null>(null);
  const fullNow = useRef(full);
  fullNow.current = full;
  /** The game whose match put its tile full screen, as against a tap. */
  const auto = useRef<string | null>(null);
  // Matches already switched for, so one changed back by hand is left alone.
  const done = useRef(new Set<string>());
  const leftAt = useRef(new Map<string, number>());

  const setFull = useCallback((widget: string | null) => {
    auto.current = null;
    setFullState(widget);
  }, []);

  useEffect(() => {
    const check = (widget: string, payload: GamePayload) => {
      const g = registry[widget]?.game;
      if (!g) return;
      const s = now.current;
      const choice = s.games[widget];
      const to = choice?.onMatch === 'layout' ? (choice.switchTo ?? null) : null;
      const wantsFull = choice?.onMatch === 'full';
      const data = payload.live ? payload.data : null;
      const phase = g.match.phase ? text(data, g.match.phase) : undefined;
      const over = data !== null && phase !== undefined && g.match.over.includes(phase);
      const playing = data !== null && get(data, g.match.in) !== undefined && !over;
      // A match is told apart from the next by its map; good enough to stop a
      // second switch within the same one.
      const match = `${widget}:${text(data, 'map.name') ?? ''}`;

      // The options changed during the match: follow them.
      const active = s.matchLayout?.widget === widget && s.layoutId === s.matchLayout.to ? s.matchLayout : null;
      if (active && to !== active.to) {
        set.current(null);
        if (to && playing) set.current({ widget, to, from: active.from });
        return;
      }
      if (auto.current === widget && !wantsFull) {
        auto.current = null;
        setFullState(null);
      }

      const ours = s.matchLayout?.widget === widget || auto.current === widget;
      if (playing) {
        leftAt.current.delete(widget);
        if (done.current.has(match)) return;
        if (to && !s.matchLayout) {
          done.current.add(match);
          if (s.layoutId !== to) set.current({ widget, to, from: s.layoutId });
        } else if (wantsFull && fullNow.current === null) {
          done.current.add(match);
          auto.current = widget;
          setFullState(widget);
        }
        return;
      }
      if (!ours) {
        done.current.clear();
        return;
      }
      const back = () => {
        if (s.matchLayout?.widget === widget) set.current(null);
        if (auto.current === widget) {
          auto.current = null;
          setFullState(null);
        }
        done.current.clear();
        leftAt.current.delete(widget);
      };
      // Over, or the game closed: back at once. In the menu: after a grace, in
      // case it was a reconnect.
      if (over || !payload.live) {
        back();
        return;
      }
      const since = leftAt.current.get(widget) ?? Date.now();
      leftAt.current.set(widget, since);
      if (Date.now() - since >= MENU_GRACE_MS) back();
    };

    // A remote panel's options are its host's, so it only goes full screen by hand.
    if (REMOTE_PANEL) return;
    const stop = bus.subscribe('game:*', (e) => {
      if (e.topic === 'game:setup') return;
      check(e.topic.slice('game:'.length), e.data as GamePayload);
    });
    // The menu's grace runs out with nothing new to say.
    const id = window.setInterval(() => {
      const widget = now.current.matchLayout?.widget ?? auto.current;
      const last = widget ? bus.peek<GamePayload>(`game:${widget}`)?.data : undefined;
      if (widget && last) check(widget, last);
    }, 15_000);
    return () => {
      stop();
      window.clearInterval(id);
    };
  }, []);

  return { full, setFull };
}
