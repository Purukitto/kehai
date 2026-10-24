import type { CSSProperties } from 'react';
import { clockParts, mmss } from '../core/format';
import type { AgentsPayload, ClockPayload, NotifyPayload, SprintPayload } from '../core/payloads';
import type { QuietShow } from '../core/settings';
import { useTopic } from '../core/useTopic';
import { useWindowShape } from '../core/useWindowShape';
import { sinceText } from '../widgets/Agents';
import { sprintColor } from '../widgets/Sprint';

interface Line {
  color: string;
  text: string;
  sub?: string;
  /** A count, stated small: something there, nothing to read. */
  small?: boolean;
}

/**
 * What is worth seeing from across the room: an agent waiting on you, then a
 * timer counting down, since a break is when you are away, then how many
 * notifications came. Never what they say.
 */
function useLines(agentsOnly: boolean): Line[] {
  const tick = useTopic<ClockPayload>('os:clock');
  const agents = useTopic<AgentsPayload>('dev:agents');
  const sprint = useTopic<SprintPayload>('flow:pomodoro');
  const notify = useTopic<NotifyPayload>('sys:notify');
  const now = tick ? Date.parse(tick.iso) : Date.now();
  const lines: Line[] = [];

  const waiting = agents?.available ? agents.sessions.filter((s) => s.state === 'waiting' || s.state === 'error') : [];
  if (waiting.length > 0) {
    const first = waiting[0];
    lines.push({
      color: first.state === 'error' ? 'var(--cc-danger)' : 'var(--cc-accent)',
      text: `${waiting.length} agent${waiting.length === 1 ? '' : 's'} waiting on you`,
      sub: `${first.project} · ${sinceText(now - first.sinceMs)}`,
    });
  }
  if (agentsOnly) return lines;

  if (sprint?.state === 'running') {
    lines.push({
      // A focus block takes the accent everywhere else, but here the accent is
      // kept for an agent waiting: only that should be bright from across the room.
      color: sprint.mode === 'focus' ? 'var(--cc-muted)' : sprintColor(sprint),
      text: `${sprint.mode === 'focus' ? 'Focusing' : 'On break'} · ${mmss(sprint.remainingSec)} left`,
      sub: sprint.mode === 'focus' ? `${sprint.index} of ${sprint.total}` : `after ${sprint.index} of ${sprint.total}`,
    });
  }

  const count = notify?.available ? notify.items.length : 0;
  if (count > 0) {
    lines.push({ color: 'var(--cc-line-2)', text: `${count} notification${count === 1 ? '' : 's'}`, small: true });
  }
  return lines;
}

const clip: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 };

function Lines({ lines, size }: { lines: Line[]; size: number }) {
  if (lines.length === 0) return null;
  return (
    <div style={{ borderTop: '1px solid var(--cc-line)' }}>
      {lines.map((l) => (
        <div
          key={l.text}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            height: Math.round(size * (l.small ? 1.7 : 2.3)),
            borderBottom: '1px solid var(--cc-line)',
            minWidth: 0,
          }}
        >
          <span style={{ width: l.small ? 7 : 10, height: l.small ? 7 : 10, flex: 'none', background: l.color }} />
          <span style={{ ...clip, fontSize: Math.round(size * (l.small ? 0.5 : 1)), fontWeight: 300, color: l.small ? 'var(--cc-dim)' : l.color }}>
            {l.text}
          </span>
          <span style={{ flex: 1 }} />
          {l.sub && (
            <span style={{ ...clip, fontSize: Math.round(size * 0.52), color: 'var(--cc-muted)', flex: 'none', maxWidth: '45%' }}>
              {l.sub}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

const big: CSSProperties = { fontWeight: 200, lineHeight: 0.9, letterSpacing: '-0.04em', whiteSpace: 'nowrap', color: 'var(--cc-muted)' };

/**
 * The panel while nobody is at the desk, or while the system is locked. It
 * lies over everything, so the first tap lands here and only wakes the panel,
 * never a button that could not be seen.
 *
 * Panel leaves the whole panel showing, dimmed, and only catches that tap.
 * Blank is for a locked session, whose lock screen hides the panel anyway.
 */
export function Quiet({ show, onWake }: { show: QuietShow | 'blank'; onWake: () => void }) {
  const { shape, width, height } = useWindowShape();
  const tick = useTopic<ClockPayload>('os:clock');
  const lines = useLines(show === 'nothing');
  const { time, date } = clockParts(tick ? new Date(tick.iso) : new Date(), false);

  const cover: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    background: show === 'panel' ? 'transparent' : 'var(--cc-bg)',
    display: 'flex',
    flexDirection: 'column',
    // Nothing on a quiet panel scrolls or zooms; a swipe is a touch like any other.
    touchAction: 'none',
    cursor: 'default',
  };

  let body = null;
  if (show === 'nothing') {
    body = (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 8%' }}>
        <Lines lines={lines} size={Math.max(18, Math.min(30, height * 0.035))} />
      </div>
    );
  } else if (show === 'clock') {
    const dateLine = (size: number, gap: number) => (
      <div style={{ fontSize: size, letterSpacing: '0.28em', color: 'var(--cc-dim)', marginTop: gap }}>{date}</div>
    );
    const hint = (
      <div className="cc-mini" style={{ position: 'absolute', left: 0, right: 0, bottom: 26, textAlign: 'center', letterSpacing: '0.16em', opacity: 0.7 }}>
        TOUCH THE PANEL OR MOVE THE MOUSE TO WAKE IT
      </div>
    );
    if (shape === 'bar') {
      const size = Math.round(Math.min(height * 0.48, width * 0.13));
      body = (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4vw', padding: '0 4vw' }}>
          <div style={{ flex: 'none' }}>
            <div style={{ ...big, fontSize: size }}>{time}</div>
            {dateLine(16, 22)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Lines lines={lines} size={Math.max(16, Math.min(26, height * 0.055))} />
          </div>
          {hint}
        </div>
      );
    } else if (shape === 'portrait') {
      const [hours, minutes] = time.split(':');
      const size = Math.round(Math.min(width * 0.41, height * 0.26));
      body = (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 8%' }}>
          <div style={{ ...big, fontSize: size }}>{hours}</div>
          <div style={{ ...big, fontSize: size }}>{minutes}</div>
          {dateLine(18, 30)}
          {lines.length > 0 && (
            <div style={{ marginTop: '5vh' }}>
              <Lines lines={lines} size={Math.max(18, Math.min(26, width * 0.033))} />
            </div>
          )}
          {hint}
        </div>
      );
    } else {
      // Monospace digits advance 0.6em, so five characters need three ems.
      const size = Math.round(Math.min(height * 0.31, (width * 0.86) / 3));
      body = (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 7%' }}>
          <div style={{ ...big, fontSize: size }}>{time}</div>
          {dateLine(18, 28)}
          {lines.length > 0 && (
            <div style={{ marginTop: '7.5vh' }}>
              <Lines lines={lines} size={Math.max(18, Math.min(30, height * 0.035))} />
            </div>
          )}
          {hint}
        </div>
      );
    }
  }

  return (
    <div
      style={cover}
      onPointerDown={(e) => {
        e.preventDefault();
        onWake();
      }}
      aria-label="Kehai is quiet while you are away. Touch to wake it."
      role="button"
    >
      {body}
    </div>
  );
}
