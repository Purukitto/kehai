import { useEffect, useState } from 'react';

type Action = 'minimize' | 'toggle' | 'close';

interface Light {
  action: Action;
  label: string;
  color: string;
  glyph: string;
}

/**
 * Traffic-light controls, top right.
 *
 * The window is undecorated, so the panel draws its own. Colour carries the
 * meaning and the glyphs only appear on hover, which keeps three controls from
 * competing with the readouts they sit above — the whole point of the panel is
 * that nothing on it is noise.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(true);

  useEffect(() => {
    let cancelled = false;
    import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        const is = await getCurrentWindow().isMaximized();
        if (!cancelled) setMaximized(is);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (action: Action) => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (action === 'minimize') await win.minimize();
    if (action === 'close') await win.close();
    if (action === 'toggle') {
      await win.toggleMaximize();
      setMaximized(await win.isMaximized());
    }
  };

  const lights: Light[] = [
    { action: 'minimize', label: 'Minimise', color: 'var(--cc-accent)', glyph: 'M2 6h8' },
    {
      action: 'toggle',
      label: maximized ? 'Restore' : 'Maximise',
      color: 'var(--cc-ok)',
      glyph: maximized ? 'M2.5 6h7M6 2.5v7' : 'M2.5 2.5h7v7h-7z',
    },
    { action: 'close', label: 'Close', color: 'var(--cc-danger)', glyph: 'M3 3l6 6M9 3l-6 6' },
  ];

  return (
    <div className="cc-traffic">
      {lights.map((light) => (
        <button
          key={light.action}
          className="cc-light"
          onClick={() => void run(light.action)}
          aria-label={light.label}
          title={light.label}
        >
          <span className="cc-light-dot" style={{ background: light.color }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="var(--cc-bg)" strokeWidth="1.6" strokeLinecap="round">
              <path d={light.glyph} />
            </svg>
          </span>
        </button>
      ))}
    </div>
  );
}
