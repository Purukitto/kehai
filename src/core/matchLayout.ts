import { useEffect, useRef } from 'react';
import { bus } from './bus';
import { get, text } from './game';
import type { GamePayload } from './payloads';
import { REMOTE_PANEL } from './remoteSource';
import { useSettings } from './settings';
import { registry } from '../widgets/registry';

/** Out of a match this long and it is over, whatever the game says. */
const MENU_GRACE_MS = 2 * 60_000;

/**
 * Another layout on screen for a live match, for a game whose options ask for
 * one. It goes back when the match ends, or after two minutes in the menu. A
 * layout picked by hand during the match stays as chosen, and that match does
 * not switch again. Going still while the player is in play is `useGames`.
 */
export function useMatchLayout(): void {
  const { settings, setMatchLayout } = useSettings();
  const now = useRef(settings);
  now.current = settings;
  const set = useRef(setMatchLayout);
  set.current = setMatchLayout;
  // Matches already switched for, so one changed back by hand is left alone.
  const done = useRef(new Set<string>());
  const leftAt = useRef(new Map<string, number>());

  useEffect(() => {
    const check = (widget: string, payload: GamePayload) => {
      const g = registry[widget]?.game;
      if (!g) return;
      const s = now.current;
      const choice = s.games[widget];
      const to = choice?.onMatch === 'layout' ? (choice.switchTo ?? null) : null;
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
      const ours = s.matchLayout?.widget === widget;
      if (playing) {
        leftAt.current.delete(widget);
        if (done.current.has(match)) return;
        if (to && !s.matchLayout) {
          done.current.add(match);
          if (s.layoutId !== to) set.current({ widget, to, from: s.layoutId });
        }
        return;
      }
      if (!ours) {
        done.current.clear();
        return;
      }
      const back = () => {
        if (s.matchLayout?.widget === widget) set.current(null);
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

    // A remote panel's layouts are its own, and its host's options are not.
    if (REMOTE_PANEL) return;
    const stop = bus.subscribe('game:*', (e) => {
      if (e.topic === 'game:setup') return;
      check(e.topic.slice('game:'.length), e.data as GamePayload);
    });
    // The menu's grace runs out with nothing new to say.
    const id = window.setInterval(() => {
      const widget = now.current.matchLayout?.widget;
      const last = widget ? bus.peek<GamePayload>(`game:${widget}`)?.data : undefined;
      if (widget && last) check(widget, last);
    }, 15_000);
    return () => {
      stop();
      window.clearInterval(id);
    };
  }, []);
}
