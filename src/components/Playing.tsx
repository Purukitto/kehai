import type { CSSProperties } from 'react';
import { fill } from '../core/game';
import type { InPlay } from '../core/gameSession';
import { teamsOf, teamsState } from '../core/gameState';
import { swallowNextClick } from '../core/hold';
import { useWindowShape } from '../core/useWindowShape';
import { registry } from '../widgets/registry';
import { Lines, useLines } from './Quiet';

/**
 * The panel while the player is in play. Nobody should look at a second
 * screen in the middle of a round, so it shows nothing that moves or changes
 * colour: the score as it stood, dimly, and how many things are being held.
 * They are all still there underneath, and the panel opens by itself when the
 * player is out of the round, at half time, and after the match.
 *
 * It lies over everything, like the quiet panel, so a tap only opens it.
 */
export function Playing({ inPlay, onOpen }: { inPlay: InPlay; onOpen: () => void }) {
  const { shape, width, height } = useWindowShape();
  const lines = useLines(false, true);
  const g = registry[inPlay.widget]?.game;
  const teams = g ? teamsOf(g, inPlay.data) : undefined;
  const t = teams ? teamsState(teams, inPlay.data) : null;
  const title = g ? fill(g.match.title, inPlay.data) : undefined;
  const size = Math.round(shape === 'bar' ? height * 0.3 : Math.min(height * 0.13, width * 0.09));
  const dim: CSSProperties = {
        color: 'var(--cc-dim)',
    fontWeight: 200,
    letterSpacing: '-0.04em',
    lineHeight: 1,
    whiteSpace: 'nowrap',
  };

  const score = t && (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: size * 0.25 }}>
      {t.sides.map((s, i) => (
        <span key={s.label} style={{ display: 'inline-flex', alignItems: 'baseline', gap: size * 0.18, flexDirection: i === 0 ? 'row' : 'row-reverse' }}>
          <span style={{ fontSize: Math.max(13, size * 0.22), fontWeight: 500, color: s.you ? 'var(--cc-muted)' : 'var(--cc-dim)' }}>{s.label}</span>
          <span style={{ ...dim, fontSize: size }}>{s.n ?? '–'}</span>
          {i === 0 && <span style={{ ...dim, fontSize: size * 0.6, marginLeft: size * 0.1 }}>–</span>}
        </span>
      ))}
    </div>
  );

  return (
    <div
      className="cc-fade-in"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 900,
        background: 'var(--cc-bg)',
        display: 'flex',
        flexDirection: shape === 'bar' ? 'row' : 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: shape === 'bar' ? undefined : 'center',
        gap: shape === 'bar' ? '5vw' : 32,
        padding: shape === 'bar' ? '0 4vw' : '0 8%',
        touchAction: 'none',
        cursor: 'default',
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        // This view is gone before the finger lifts, and the click would
        // otherwise press whatever it was covering.
        swallowNextClick();
        onOpen();
      }}
      role="button"
      aria-label="Kehai is still while you play. Touch to open the panel."
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: shape === 'bar' ? 'flex-start' : 'center', gap: 16, flex: 'none' }}>
        <span className="cc-mini">{[g?.source.game, title].filter(Boolean).join(' · ')}</span>
        {score}
        {t?.round !== undefined && (
          <span className="cc-mini" style={{ fontSize: 14 }}>
            Round {t.round}
            {t.of && t.round <= t.of ? ` of ${t.of}` : ''}
          </span>
        )}
      </div>
      {lines.length > 0 && (
        <div style={{ flex: shape === 'bar' ? 1 : 'none', width: shape === 'bar' ? undefined : 'min(560px, 100%)', minWidth: 0, maxWidth: 720, textAlign: 'left' }}>
          <Lines lines={lines} size={Math.max(16, Math.min(22, height * 0.028))} />
        </div>
      )}
      <div className="cc-mini" style={{ position: 'absolute', left: 0, right: 0, bottom: 24, textAlign: 'center', opacity: 0.8 }}>
        Still while you play. Everything is kept for when you’re out of the round. Touch to open it now.
      </div>
    </div>
  );
}
