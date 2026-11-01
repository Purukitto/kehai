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
    <div style={{ padding: '11px 0', borderTop: '1px solid var(--cc-line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 28 }}>
        <span className="cc-label">{label}</span>
        <span style={{ flex: 1 }} />
        {right}
      </div>
      <div style={{ fontSize: 12, marginTop: 6, color: color ?? 'var(--cc-text)', wordBreak: 'break-all', lineHeight: 1.5 }}>{value}</div>
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
          background: 'var(--cc-pane-2)',
          border: '1px solid var(--cc-line-2)',
        }}
      >
        <div style={{ height: 52, flex: 'none', display: 'flex', alignItems: 'center', gap: 11, padding: '0 20px', borderBottom: '1px solid var(--cc-line)' }}>
          <GameIcon path={source.icon} color="var(--cc-accent)" />
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.2em' }}>{source.game.toUpperCase()}</span>
          <span className="cc-label">SET UP</span>
          <span style={{ flex: 1 }} />
          <button className="cc-chip" style={{ padding: '7px 16px' }} onClick={onClose}>
            CANCEL
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 22px 10px' }}>
          <div style={{ fontSize: 13, lineHeight: 1.65 }}>
            {short} can tell programs on this PC what its HUD shows. Valve made this for lighting, overlays and panels like this
            one. Kehai writes one small file into {short}’s settings folder, then listens for {short} on this PC only.
          </div>
          <div style={{ marginTop: 12 }}>
            {row(
              found?.by === 'chosen' ? 'THE FOLDER YOU CHOSE' : 'FOUND THROUGH STEAM',
              !found ? 'Looking…' : (found.folder ?? found.reason ?? ''),
              <button className="cc-chip" style={{ padding: '6px 12px' }} onClick={() => send({ action: 'choose', widget: widget.id, source: spec })}>
                {found?.folder ? 'CHOOSE ANOTHER FOLDER' : 'CHOOSE THE FOLDER'}
              </button>,
              found && !found.folder ? 'var(--cc-danger)' : undefined
            )}
            {found?.folder && found.reason && (
              <div style={{ fontSize: 12, color: 'var(--cc-danger)', paddingBottom: 10, lineHeight: 1.5 }}>{found.reason}</div>
            )}
            {found?.file && row('THE FILE KEHAI WRITES', found.file)}
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 20, padding: '11px 0', borderTop: '1px solid var(--cc-line)' }}>
              <div>
                <div className="cc-label">IT ASKS {short} FOR</div>
                {source.asks.map((a) => (
                  <div key={a} style={{ fontSize: 12, marginTop: 7 }}>
                    {a}
                  </div>
                ))}
              </div>
              <div>
                <div className="cc-label">NEVER</div>
                {source.never.map((a) => (
                  <div key={a} style={{ fontSize: 12, marginTop: 7, color: 'var(--cc-muted)' }}>
                    {a}
                  </div>
                ))}
              </div>
            </div>
            {found && found.others.length > 0 && (
              <div style={{ padding: '11px 0', borderTop: '1px solid var(--cc-line)' }}>
                <div className="cc-label">ALREADY IN THAT FOLDER · LEFT AS THEY ARE</div>
                {found.others.map((f) => (
                  <div key={f} style={{ fontSize: 12, marginTop: 7, color: 'var(--cc-muted)', wordBreak: 'break-all' }}>
                    {f} · {whose(f)}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="cc-mini" style={{ lineHeight: 1.7, paddingTop: 4 }}>
            KEHAI LISTENS ON 127.0.0.1{setup?.port ? `:${setup.port}` : ''}, THIS PC ONLY, AND ONLY FOR {short} SENDING THE KEY IN THE FILE.
            REMOVE TAKES THE FILE OUT AGAIN.
          </div>
        </div>

        <div style={{ minHeight: 58, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 20px', borderTop: '1px solid var(--cc-line)', background: 'var(--cc-inset)' }}>
          <span className="cc-mini">NEXT: START {short}, OR RESTART IT IF IT’S OPEN</span>
          <span style={{ flex: 1 }} />
          <button
            className={`cc-chip${ready && !writing ? ' cc-chip-on' : ''}`}
            style={{ padding: '10px 22px', opacity: ready ? 1 : 0.5 }}
            disabled={!ready || writing}
            onClick={() => {
              if (!found?.folder) return;
              setWriting(true);
              send({ action: 'setup', widget: widget.id, name: source.game, source: spec, folder: found.folder });
            }}
          >
            {writing ? 'WRITING…' : 'WRITE THE FILE'}
          </button>
        </div>
      </div>
    </>,
    document.getElementById('root') ?? document.body
  );
}
