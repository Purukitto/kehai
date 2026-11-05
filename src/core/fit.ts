import { shapeOf } from './layout';
import type { Shape } from './types';

/** What each shape of layout is drawn for: the panel, a bar, a tablet on its end. */
const MADE_FOR: Record<Shape, [number, number]> = {
  landscape: [1280, 800],
  bar: [1920, 480],
  portrait: [800, 1280],
};

/**
 * How far to zoom a window of this size, in CSS pixels at 100%, so it shows
 * what the display it is made for would, only larger: a main monitor gets the
 * panel, not a panel's worth of text lost in tiles four times its size. It
 * follows the window's size on any display, in steps of 5%, and the tiles go
 * on fitting themselves to whatever space that leaves. Never below 1: a
 * smaller window already lays itself out to fit, and text would only shrink.
 */
export function fitZoom(width: number, height: number): number {
  const [w, h] = MADE_FOR[shapeOf(width, height)];
  const z = Math.min(width / w, height / h);
  return z <= 1 ? 1 : Math.min(3, Math.floor(z * 20) / 20);
}

/**
 * Keeps the desktop window's page zoomed to fit, as it changes size or moves
 * to another display. It is the webview's own zoom, the one Ctrl and + use, so
 * everything the page measures agrees with what it draws. The size comes from
 * the window itself, which zooming does not change.
 */
export async function startFit(): Promise<() => void> {
  const [{ getCurrentWebview }, { getCurrentWindow }] = await Promise.all([
    import('@tauri-apps/api/webview'),
    import('@tauri-apps/api/window'),
  ]);
  const view = getCurrentWebview();
  const win = getCurrentWindow();
  let zoom = 1;
  let running = false;
  let again = false;

  const fit = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const [size, scale] = await Promise.all([win.innerSize(), win.scaleFactor()]);
        const want = fitZoom(size.width / scale, size.height / scale);
        if (want !== zoom) {
          await view.setZoom(want);
          zoom = want;
        }
      } while (again);
    } catch {
      // Refused or gone: the page stays at 100%, as it always was.
    } finally {
      running = false;
    }
  };

  window.addEventListener('resize', fit);
  await fit();
  return () => window.removeEventListener('resize', fit);
}
