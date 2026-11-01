/**
 * Said once, the first time the panel is closed: close used to quit, and now
 * Kehai carries on in the tray. Quit is offered here too, for whoever meant it.
 */
export function HideSheet({ onHide, onQuit, onCancel }: { onHide: () => void; onQuit: () => void; onCancel: () => void }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'rgba(0, 0, 0, 0.62)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-labelledby="cc-hide-title"
        style={{
          width: 'min(600px, 100%)',
          background: 'var(--cc-pane-2)',
          boxShadow: '0 0 0 1px var(--cc-line-2)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            height: 52,
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            padding: '0 20px',
            borderBottom: '1px solid var(--cc-line)',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--cc-accent)" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M8 1.4 14.6 8 8 14.6 1.4 8Z" />
          </svg>
          <span id="cc-hide-title" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.2em' }}>
            HIDING THE PANEL
          </span>
          <span style={{ flex: 1 }} />
          <span className="cc-mini">SAID ONCE</span>
        </div>
        <div style={{ padding: '20px 22px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--cc-text)' }}>
            Kehai keeps running in the tray: its readings, the agents it watches, and any tablet showing its panel.
          </span>
          <span style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--cc-muted)' }}>
            Click its icon there to bring the panel back. Quit is in the icon’s menu.
          </span>
          <span
            className="cc-mini"
            style={{
              lineHeight: 1.6,
              padding: '12px 14px',
              background: 'var(--cc-inset)',
              boxShadow: 'inset 0 0 0 1px var(--cc-line)',
            }}
          >
            WINDOWS MAY TUCK THE ICON UNDER ^ AT FIRST. DRAG IT ONTO THE TASKBAR TO KEEP IT IN SIGHT.
          </span>
        </div>
        <div
          style={{
            height: 58,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 20px',
            borderTop: '1px solid var(--cc-line)',
            background: 'var(--cc-inset)',
          }}
        >
          <button className="cc-chip" style={{ height: 36, minWidth: 120 }} onClick={onQuit}>
            QUIT INSTEAD
          </button>
          <span style={{ flex: 1 }} />
          <button className="cc-chip cc-chip-on" style={{ height: 36, minWidth: 120 }} onClick={onHide} autoFocus>
            HIDE
          </button>
        </div>
      </div>
    </div>
  );
}
