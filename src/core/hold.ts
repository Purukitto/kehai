import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

/** Long enough not to be a tap, short enough not to feel like waiting. */
export const HOLD_MS = 500;
/** The ring shows once a press has lasted this long, so a tap never flashes one. */
export const RING_AFTER_MS = 120;
/** A finger drifts. Further than this is a drag or a scroll, not a hold. */
const SLOP_PX = 10;
/** Long enough for the platform's own long-press menu to arrive after ours. */
const SETTLE_MS = 1000;

/** Where the ring is drawn, in viewport pixels. */
export interface Ring {
  x: number;
  y: number;
}

/**
 * Inside an element marked `data-hold="off"`, a press is never a hold: the seek
 * bar and the volume are drags of their own.
 */
const exempt = (target: EventTarget | null) => target instanceof Element && target.closest('[data-hold="off"]') !== null;

/**
 * The click that ends a hold would otherwise land on whatever the finger was
 * on, and holding a notification would dismiss it too.
 */
function swallowNextClick() {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    done();
  };
  const done = () => {
    window.removeEventListener('click', stop, true);
    window.clearTimeout(timer);
  };
  window.addEventListener('click', stop, true);
  const timer = window.setTimeout(done, 600);
}

/**
 * A long press on an element, by finger, pen or mouse, or a right-click.
 * Returns the handlers to spread on it and where to draw the ring that fills
 * while the press lasts.
 */
export function useHold(onHold: (el: HTMLElement) => void) {
  const press = useRef<{ x: number; y: number; id: number } | null>(null);
  const timers = useRef<number[]>([]);
  const firedAt = useRef(0);
  const [ring, setRing] = useState<Ring | null>(null);

  const cancel = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    press.current = null;
    setRing(null);
  };

  useEffect(() => cancel, []);

  const fire = (el: HTMLElement) => {
    cancel();
    firedAt.current = Date.now();
    onHold(el);
  };

  const handlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      // The right button is the context menu's.
      if (e.button !== 0 || exempt(e.target)) return;
      cancel();
      const el = e.currentTarget;
      const at = { x: e.clientX, y: e.clientY };
      press.current = { ...at, id: e.pointerId };
      timers.current = [
        window.setTimeout(() => setRing(at), RING_AFTER_MS),
        window.setTimeout(() => {
          swallowNextClick();
          fire(el);
        }, HOLD_MS),
      ];
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const p = press.current;
      if (p && p.id === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
      e.preventDefault();
      // A finger held still brings the platform's long-press menu as well,
      // just after ours.
      if (exempt(e.target) || Date.now() - firedAt.current < SETTLE_MS) return;
      fire(e.currentTarget);
    },
  };

  return { ring, handlers };
}
