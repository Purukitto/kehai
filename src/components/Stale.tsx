import { useEffect, useState } from 'react';
import { p2 } from '../core/format';
import { remoteHostName } from '../core/remoteSource';

/** The time of day at `ms`, as the header and this card say it. */
export function hhmmAt(ms: number): string {
  const d = new Date(ms);
  return p2(d.getHours()) + ':' + p2(d.getMinutes());
}

/**
 * Over a remote panel whose host has stopped answering. The tiles behind it
 * are dimmed by the caller, so a reading from an hour ago never passes for a
 * live one; this says how old they are and when the panel tries again.
 */
export function Stale({ heard, retryAt }: { heard: number; retryAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const wait = retryAt === null ? 0 : Math.ceil((retryAt - now) / 1000);

  return (
    <div
      className="cc-glass"
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        maxWidth: 'calc(100% - 32px)',
        borderRadius: 24,
        padding: '16px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        textAlign: 'center',
      }}
    >
      <span className="cc-label">Not a live reading</span>
      <span style={{ fontSize: 15 }}>
        Last heard from {remoteHostName()} at {hhmmAt(heard)}
      </span>
      <span className="cc-mini">{wait > 0 ? `Trying again in ${wait} s` : 'Trying now'}</span>
    </div>
  );
}
