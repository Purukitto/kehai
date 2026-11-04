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
        className="cc-glass"
        style={{
          width: 'min(600px, 100%)',
          borderRadius: 24,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 12,
            padding: '24px 24px 0',
          }}
        >
          <span id="cc-hide-title" className="cc-display" style={{ fontSize: 26 }}>
            Hiding the panel
          </span>
          <span style={{ flex: 1 }} />
          <span className="cc-mini">Said once</span>
        </div>
        <div style={{ padding: '16px 24px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--cc-text)' }}>
            Kehai keeps running in the tray: its readings, the agents it watches, and any tablet showing its panel.
          </span>
          <span style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--cc-muted)' }}>
            Click its icon there to bring the panel back. Quit is in the icon’s menu.
          </span>
          <span className="cc-mini" style={{ lineHeight: 1.6 }}>
            Windows may tuck the icon under ^ at first. Drag it onto the taskbar to keep it in sight.
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 24px 24px',
          }}
        >
          <button className="cc-chip cc-bare" style={{ height: 36, color: 'var(--cc-muted)' }} onClick={onQuit}>
            Quit instead
          </button>
          <span style={{ flex: 1 }} />
          <button className="cc-chip cc-primary" style={{ height: 36, minWidth: 120 }} onClick={onHide} autoFocus>
            Hide
          </button>
        </div>
      </div>
    </div>
  );
}
