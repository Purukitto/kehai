import { useState } from 'react';
import { pairRemote } from '../core/remoteSource';

/**
 * Over a remote panel the host will not talk to. The link from the host's
 * Settings pairs by itself when opened; this is for typing or pasting it on a
 * device where opening it is awkward.
 */
export function PairPrompt({ reason }: { reason: string }) {
  const [draft, setDraft] = useState('');
  const [wrong, setWrong] = useState(false);

  const pair = () => {
    if (pairRemote(draft)) {
      setDraft('');
      setWrong(false);
    } else {
      setWrong(true);
    }
  };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div
        style={{
          width: 'min(520px, 100%)',
          background: 'var(--cc-pane)',
          boxShadow: '0 0 0 1px var(--cc-line-2)',
          padding: '22px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <span className="cc-label">NOT PAIRED</span>
        <span style={{ fontSize: 12, color: 'var(--cc-muted)', lineHeight: 1.6 }}>{reason}</span>
        <span className="cc-mini" style={{ lineHeight: 1.6 }}>
          On the machine running Kehai, open Settings → Remote and open its link here, or paste the link or its key.
        </span>
        <div style={{ display: 'flex', marginTop: 4 }}>
          <input
            className="cc-field"
            style={{ flex: 1, minWidth: 0 }}
            value={draft}
            placeholder="http://…/#key=… or the key"
            spellCheck={false}
            aria-label="Link or key"
            onChange={(e) => {
              setDraft(e.target.value);
              setWrong(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') pair();
            }}
          />
          <button className="cc-chip cc-chip-on" style={{ padding: '7px 16px', marginLeft: -1 }} onClick={pair}>
            PAIR
          </button>
        </div>
        {wrong && (
          <span className="cc-mini" style={{ color: 'var(--cc-danger)' }}>
            THAT HOLDS NO KEY. A KEY IS 32 CHARACTERS OF 0–9 AND A–F.
          </span>
        )}
      </div>
    </div>
  );
}
