import { useEffect, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { bus } from '../core/bus';
import { humanDuration, mmss } from '../core/format';
import { ON_TABLET, SAID_MS, SURE_MS, useSaid, useSure } from '../core/front';
import type { Said } from '../core/front';
import { useTileSize } from '../core/TileSize';
import { useBreakpoint } from '../core/useBreakpoint';
import { useTopic } from '../core/useTopic';
import type { AgentCommand, AgentJumped, AgentSession, AgentsPayload, AgentVia, ClockPayload } from '../core/payloads';
import type { WidgetProps } from '../core/types';
import { Awaiting, Pane } from './chrome';

/** What a tap did, by what the session runs in. Bringing the window forward is all it does. */
const OPENED: Record<AgentVia, string> = {
  desktop: 'Opened the desktop app',
  vscode: 'Opened VS Code',
  terminal: 'Opened the terminal',
};

/**
 * Going to a session, and what the last tap on each led to, for a moment.
 * One per widget, shared by its rows.
 */
export function useJump() {
  const { said, say } = useSaid();
  const sure = useSure();

  useEffect(() => {
    const stop = bus.subscribe('agents:jumped', (e) => {
      // The bus hands back the last answer on subscribe. Only a fresh one is news.
      if (Date.now() - e.ts > SAID_MS) return;
      const r = e.data as AgentJumped;
      say(
        r.id,
        r.ok
          ? { text: r.via ? OPENED[r.via] : 'Opened', color: 'var(--cc-text)' }
          : { text: 'Couldn’t bring it forward', color: 'var(--cc-danger)' }
      );
    });
    return stop;
    // `say` only sets state and timers it owns, so the first one serves.
  }, []);

  const jump = (session: AgentSession) => {
    if (!session.via) return;
    if (ON_TABLET) {
      say(session.id, { text: 'Open it on the PC', color: 'var(--cc-muted)' });
      return;
    }
    if (!sure(session.id)) {
      say(session.id, { text: 'Tap again to go to it', color: 'var(--cc-accent)' }, SURE_MS);
      return;
    }
    bus.publish<AgentCommand>('agents:command', 'widget.agents', { action: 'jump', id: session.id });
  };

  return { said, jump };
}

/** Enter or Space on something drawn as a row rather than a button. */
const onKey = (go: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    go();
  }
};

/** Whose move it is, so the row says it can be gone to. */
const yours = (s: AgentSession) => s.state === 'waiting' || s.state === 'error';

/**
 * A tool call open this long is lit. It may be a permission prompt, which a
 * transcript cannot tell apart from a slow command, so it is never called one.
 */
const TOOL_LIT_MS = 30_000;
const ROW_H = 48;
/** Below this the tile is one line of counts instead of a list. */
const LINE_BELOW = 120;
/** The header and the footer, which the list fits between. */
const CHROME_H = 28 * 2;
/** Room between the tile's title and its first session. */
const LIST_TOP = 4;

/**
 * Now, re-read on the clock's tick. The engine only sends a change of state,
 * and the times since have to count up in between.
 */
export function useNow(): number {
  const tick = useTopic<ClockPayload>('os:clock');
  return tick ? Date.parse(tick.iso) : Date.now();
}

/** Sessions where the next move is yours. */
export function waitingOnYou(agents: AgentsPayload): number {
  return agents.sessions.filter((s) => s.state === 'waiting' || s.state === 'error').length;
}

export function sinceText(ms: number): string {
  return ms < 3_600_000 ? mmss(ms / 1000) : humanDuration(ms);
}

export function agentStatus(session: AgentSession, now: number): { label: string; color: string } {
  switch (session.state) {
    case 'error':
      return { label: 'Error', color: 'var(--cc-danger)' };
    case 'waiting':
      return { label: 'Your turn', color: 'var(--cc-accent)' };
    case 'tool':
      // Sub-agents are expected to take a while, so they stay unlit.
      if (session.subagents > 0) {
        return {
          label: session.subagents + (session.subagents === 1 ? ' sub-agent' : ' sub-agents'),
          color: 'var(--cc-muted)',
        };
      }
      return {
        label: 'Tool',
        color: now - session.sinceMs >= TOOL_LIT_MS ? 'var(--cc-accent-2)' : 'var(--cc-muted)',
      };
    case 'working':
      return { label: 'Working', color: 'var(--cc-muted)' };
  }
}

function name(session: AgentSession): string {
  return session.worktree ? `${session.project} (${session.worktree})` : session.project;
}

/** The one session that matters most, as a sentence. */
export function agentSentence(session: AgentSession, now: number): string {
  const t = sinceText(now - session.sinceMs);
  switch (session.state) {
    case 'error':
      return `${name(session)} stopped on an error ${t} ago.`;
    case 'waiting':
      return `${name(session)} has been waiting on you for ${t}.`;
    case 'tool':
      return session.subagents > 0
        ? `${name(session)} has ${session.subagents} sub-agents at work.`
        : `${name(session)} has had a tool call open for ${t}.`;
    case 'working':
      return `${name(session)} has been working for ${t}.`;
  }
}

const ELLIPSIS: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

export function AgentRow({
  session,
  now,
  divider = true,
  said,
  onJump,
}: {
  session: AgentSession;
  now: number;
  divider?: boolean;
  said?: Said;
  onJump?: (session: AgentSession) => void;
}) {
  const status = agentStatus(session, now);
  const [pressed, setPressed] = useState(false);
  const tappable = Boolean(onJump && session.via);
  // Only where the next move is yours, and never on a tablet, which can't go.
  const cue = tappable && yours(session) && !ON_TABLET;
  const go = () => onJump?.(session);
  return (
    <div
      role={tappable ? 'button' : undefined}
      tabIndex={tappable ? 0 : undefined}
      aria-label={tappable ? `Go to ${name(session)}` : undefined}
      onClick={tappable ? go : undefined}
      onKeyDown={tappable ? onKey(go) : undefined}
      onPointerDown={tappable ? () => setPressed(true) : undefined}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      data-agent-row={session.id}
      style={{
        flex: 'none',
        height: ROW_H,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 16px',
        borderTop: divider ? '1px solid var(--cc-line)' : '1px solid transparent',
        minWidth: 0,
        cursor: tappable ? 'pointer' : undefined,
        background: pressed ? 'var(--cc-pane-2)' : undefined,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: 'var(--cc-text)', ...ELLIPSIS }}>{session.project}</div>
        {session.worktree && (
          <div className="cc-mini" style={{ marginTop: 2, ...ELLIPSIS }}>
            {session.worktree}
          </div>
        )}
      </div>
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: status.color, whiteSpace: 'nowrap' }}>{status.label}</span>
        {said ? (
          <span className="cc-mini" style={{ color: said.color, whiteSpace: 'nowrap' }}>
            {said.text}
          </span>
        ) : (
          <span className="cc-mini" style={{ whiteSpace: 'nowrap' }}>
            {sinceText(now - session.sinceMs)}
            {cue && <span style={{ color: 'var(--cc-accent)' }}> · Go to ›</span>}
          </span>
        )}
      </div>
    </div>
  );
}

/** The whole list in two words. With none waiting, how many are busy says they are not stuck. */
export function agentSummary(agents: AgentsPayload): { text: string; color: string } {
  const waiting = waitingOnYou(agents);
  if (waiting > 0) return { text: waiting + ' waiting', color: 'var(--cc-accent)' };
  if (agents.sessions.length > 0) return { text: agents.sessions.length + ' at work', color: 'var(--cc-muted)' };
  return { text: 'Idle', color: 'var(--cc-dim)' };
}

export function Agents({ props }: WidgetProps) {
  const agents = useTopic<AgentsPayload>('dev:agents');
  const size = useTileSize();
  const now = useNow();
  const { said, jump } = useJump();
  // Ambient asks for the line whatever the height: one fact, stated large.
  const short = useBreakpoint(size.h, LINE_BELOW);
  const line = props.density === 'line' || short;

  if (!agents) {
    return (
      <Pane label="Agents">
        <Awaiting label="Agent sessions" />
      </Pane>
    );
  }

  // Optional, as the quota widget's source is: out of the danger colour.
  if (!agents.available) {
    return (
      <Pane label="Agents">
        <div style={{ margin: 'auto', textAlign: 'center', padding: 16 }}>
          <div style={{ fontSize: 14, color: 'var(--cc-muted)' }}>No agent transcripts</div>
          <div className="cc-mini" style={{ marginTop: 8, lineHeight: 1.6 }}>
            {agents.reason}
          </div>
          <div className="cc-mini" style={{ marginTop: 4 }}>
            This source is optional.
          </div>
        </div>
      </Pane>
    );
  }

  const head = agentSummary(agents);

  if (line) {
    const top = agents.sessions[0];
    // One line in a tall tile reads larger: it grows with the tile, up to twice.
    const k = Math.max(1, Math.min(2, size.h / 110));
    // The line goes to the session it names.
    const tappable = Boolean(top?.via);
    const topSaid = top ? said[top.id] : undefined;
    // Beside the cue the line only needs the name: the count already says it waits.
    const cue = Boolean(top && tappable && yours(top) && !topSaid && !ON_TABLET);
    const go = () => top && jump(top);
    return (
      <div
        role={tappable ? 'button' : undefined}
        tabIndex={tappable ? 0 : undefined}
        aria-label={tappable && top ? `Go to ${name(top)}` : undefined}
        onClick={tappable ? go : undefined}
        onKeyDown={tappable ? onKey(go) : undefined}
        data-agent-row={top?.id}
        style={{
          cursor: tappable ? 'pointer' : undefined,
          flex: 1,
          background: 'var(--cc-pane)',
          padding: props.density === 'line' ? '0 40px' : '0 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <span className="cc-label" style={{ flex: 'none', fontSize: Math.round(12 * Math.min(k, 1.4)) }}>
          Agents
        </span>
        <span className="cc-display" style={{ fontSize: Math.round(20 * k), color: head.color, flex: 'none', whiteSpace: 'nowrap' }}>{head.text}</span>
        {top && (
          <span
            style={{
              fontSize: Math.round(13 * Math.min(k, 1.5)),
              color: topSaid ? topSaid.color : 'var(--cc-muted)',
              minWidth: 0,
              ...ELLIPSIS,
            }}
          >
            {topSaid ? topSaid.text : cue ? name(top) : agentSentence(top, now)}
          </span>
        )}
        {cue && (
          <span
            style={{ flex: 'none', fontSize: Math.round(13 * Math.min(k, 1.5)), color: 'var(--cc-accent)', whiteSpace: 'nowrap' }}
          >
            Go to ›
          </span>
        )}
      </div>
    );
  }

  const fit = Math.max(1, Math.floor((size.h - CHROME_H - LIST_TOP) / ROW_H));
  const shown = agents.sessions.slice(0, fit);
  const hidden = agents.sessions.length - shown.length;

  return (
    <Pane
      label="Agents"
      padded={false}
      right={<span style={{ color: head.color }}>{head.text}</span>}
    >
      {/* Lines only between sessions: the title is not one of them. */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', paddingTop: LIST_TOP }}>
        {shown.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center' }}>
            <span className="cc-mini">No sessions in the last hour</span>
          </div>
        ) : (
          shown.map((session, i) => (
            <AgentRow key={session.id} session={session} now={now} divider={i > 0} said={said[session.id]} onJump={jump} />
          ))
        )}
      </div>
      {hidden > 0 && (
        <div
          style={{
            flex: 'none',
            height: 28,
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            borderTop: '1px solid var(--cc-line)',
          }}
        >
          <span className="cc-mini">{hidden} more</span>
        </div>
      )}
    </Pane>
  );
}
