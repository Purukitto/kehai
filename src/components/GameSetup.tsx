import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { bus } from '../core/bus';
import { engineSource } from '../core/game';
import type { GameCommand, GameSetupPayload } from '../core/payloads';
import { useTopic } from '../core/useTopic';
import type { GameDescription } from '../widgets/Game';

/** A game widget's small drawing, in the colour around it. */
export function GameIcon({ path, size = 14, color = 'currentColor' }: { path: string | null; size?: number; color?: string }) {
  if (!path) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" style={{ flex: 'none' }}>
      <path d={path} />
    </svg>
  );
}

/** Other programs that write these files, so a name in the folder means something. */
const KNOWN: [string, string][] = [
  ['gamestate_integration_ow', 'Overwolf’s'],
  ['gamestate_integration_steelseries', 'SteelSeries’'],
  ['gamestate_integration_logitech', 'Logitech’s'],
  ['gamestate_integration_razer', 'Razer’s'],
];

const whose = (file: string) => KNOWN.find(([prefix]) => file.startsWith(prefix))?.[1] ?? 'Another program’s';

const send = (command: GameCommand) => bus.publish<GameCommand>('game:command', 'panel', command);

/**
 * SET UP for a game widget: where the game is, the one file Kehai writes
 * there, what it asks the game for and never asks for, and what other
 * programs have already put in that folder, which stays as it is.
 */
export function GameSetup({ widget, onClose }: { widget: GameDescription; onClose: () => void }) {
  const source = widget.game.source;
  const spec = engineSource(source);
  const setup = useTopic<GameSetupPayload>('game:setup');
  const opened = useRef(Date.now());
  const [writing, setWriting] = useState(false);
  const found = setup?.found?.widget === widget.id ? setup.found : null;
  const short = source.short;

  useEffect(() => {
    send({ action: 'find', widget: widget.id, source: spec });
    // Looked for once, when the sheet opens.
  }, [widget.id]);

  // Written: the game is set up from this moment, and the sheet's work is done.
  const written = setup?.games.some((g) => g.widget === widget.id && g.writtenMs >= opened.current);
  useEffect(() => {
    if (written) onClose();
  }, [written, onClose]);
  useEffect(() => {
    if (found?.reason) setWriting(false);
  }, [found?.reason]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ready = found?.folder && found.file && !found.reason;
  const row = (label: string, value: string, right?: ReactNode, color?: string) => (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--cc-line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28 }}>
        <span className="cc-label">{label}</span>
        <span style={{ flex: 1 }} />
        {right}
      </div>
      <div className="cc-code" style={{ marginTop: 4, color: color ?? 'var(--cc-text)', wordBreak: 'break-all', lineHeight: 1.5 }}>{value}</div>
    </div>
  );

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0, 0, 0, 0.62)' }} />
      <div
        role="dialog"
        aria-label={`Set up ${source.game}`}
        style={{
          position: 'fixed',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(720px, calc(100vw - 24px))',
          maxHeight: 'calc(100vh - 24px)',
          zIndex: 61,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 24,
          overflow: 'hidden',
        }}
        className="cc-glass"
      >
        <div style={{ height: 56, flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px 0 24px', borderBottom: '1px solid var(--cc-line)' }}>
          <GameIcon path={source.icon} color="var(--cc-muted)" />
          <span className="cc-display" style={{ fontSize: 22 }}>Set up {source.game}</span>
          <span style={{ flex: 1 }} />
          <button className="cc-chip cc-bare" style={{ color: 'var(--cc-muted)' }} onClick={onClose}>
            Cancel
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 24px 12px' }}>
          <div style={{ fontSize: 14, lineHeight: 1.6, maxWidth: '68ch' }}>
            {short} can tell programs on this PC what its HUD shows. Valve made this for lighting, overlays and panels like this
            one. Kehai writes one small file into {short}’s settings folder, then listens for {short} on this PC only.
          </div>
          <div style={{ marginTop: 12 }}>
            {row(
              found?.by === 'chosen' ? 'The folder you chose' : 'Found through Steam',
              !found ? 'Looking…' : (found.folder ?? found.reason ?? ''),
              <button className="cc-chip" onClick={() => send({ action: 'choose', widget: widget.id, source: spec })}>
                {found?.folder ? 'Choose another folder' : 'Choose the folder'}
              </button>,
              found && !found.folder ? 'var(--cc-danger)' : undefined
            )}
            {found?.folder && found.reason && (
              <div style={{ fontSize: 13, color: 'var(--cc-danger)', paddingBottom: 12, lineHeight: 1.5 }}>{found.reason}</div>
            )}
            {found?.file && row('The file Kehai writes', found.file)}
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 24, padding: '12px 0', borderTop: '1px solid var(--cc-line)' }}>
              <div>
                <div className="cc-label">It asks {short} for</div>
                {source.asks.map((a) => (
                  <div key={a} style={{ fontSize: 14, marginTop: 8 }}>
                    {a}
                  </div>
                ))}
              </div>
              <div>
                <div className="cc-label">Never</div>
                {source.never.map((a) => (
                  <div key={a} style={{ fontSize: 14, marginTop: 8, color: 'var(--cc-muted)' }}>
                    {a}
                  </div>
                ))}
              </div>
            </div>
            {found && found.others.length > 0 && (
              <div style={{ padding: '12px 0', borderTop: '1px solid var(--cc-line)' }}>
                <div className="cc-label">Already in that folder, left as they are</div>
                {found.others.map((f) => (
                  <div key={f} style={{ fontSize: 13, marginTop: 8, color: 'var(--cc-muted)', wordBreak: 'break-all' }}>
                    {f} · {whose(f)}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="cc-mini" style={{ lineHeight: 1.6, paddingTop: 4 }}>
            Kehai listens on <span className="cc-code">127.0.0.1{setup?.port ? `:${setup.port}` : ''}</span>, this PC only, and only for {short} sending
            the key in the file. Remove takes the file out again.
          </div>
        </div>

        <div style={{ minHeight: 64, flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px 8px 24px', borderTop: '1px solid var(--cc-line)' }}>
          <span className="cc-mini">Next: start {short}, or restart it if it’s open</span>
          <span style={{ flex: 1 }} />
          <button
            className={`cc-chip${ready && !writing ? ' cc-primary' : ''}`}
            style={{ padding: '8px 20px' }}
            disabled={!ready || writing}
            onClick={() => {
              if (!found?.folder) return;
              setWriting(true);
              send({ action: 'setup', widget: widget.id, name: source.game, source: spec, folder: found.folder });
            }}
          >
            {writing ? 'Writing…' : 'Write the file'}
          </button>
        </div>
      </div>
    </>,
    document.getElementById('root') ?? document.body
  );
}
