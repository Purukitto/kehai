import type { CSSProperties } from 'react';
import { humanDuration, mmss } from '../core/format';
import { useTileSize } from '../core/TileSize';
import { useBreakpoint } from '../core/useBreakpoint';
import { useTopic } from '../core/useTopic';
import type { AgentSession, AgentsPayload, ClockPayload } from '../core/payloads';
import type { WidgetProps, WidgetSpec } from '../core/types';
import { Awaiting, Pane } from './chrome';

/**
 * A tool call open this long is lit. It may be a permission prompt, which a
 * transcript cannot tell apart from a slow command, so it is never called one.
 */
const TOOL_LIT_MS = 30_000;
const ROW_H = 46;
/** Below this the tile is one line of counts instead of a list. */
const LINE_BELOW = 120;
/** The header and the footer, which the list fits between. */
const CHROME_H = 26 * 2;

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
      return { label: 'ERROR', color: 'var(--cc-danger)' };
    case 'waiting':
      return { label: 'YOUR TURN', color: 'var(--cc-accent)' };
    case 'tool':
      // Sub-agents are expected to take a while, so they stay unlit.
      if (session.subagents > 0) {
        return {
          label: session.subagents + (session.subagents === 1 ? ' SUB-AGENT' : ' SUB-AGENTS'),
          color: 'var(--cc-muted)',
        };
      }
      return {
        label: 'TOOL',
        color: now - session.sinceMs >= TOOL_LIT_MS ? 'var(--cc-accent-2)' : 'var(--cc-muted)',
      };
    case 'working':
      return { label: 'WORKING', color: 'var(--cc-muted)' };
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

export function AgentRow({ session, now }: { session: AgentSession; now: number }) {
  const status = agentStatus(session, now);
  return (
    <div
      style={{
        flex: 'none',
        height: ROW_H,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 12px',
        borderBottom: '1px solid var(--cc-line)',
        minWidth: 0,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--cc-text)', ...ELLIPSIS }}>{session.project}</div>
        {session.worktree && (
          <div className="cc-mini" style={{ marginTop: 3, ...ELLIPSIS }}>
            {session.worktree}
          </div>
        )}
      </div>
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <span
          style={{
            fontSize: 9,
            letterSpacing: '0.1em',
            padding: '1px 5px',
            border: '1px solid currentColor',
            color: status.color,
            whiteSpace: 'nowrap',
          }}
        >
          {status.label}
        </span>
        <span className="cc-mini">{sinceText(now - session.sinceMs)}</span>
      </div>
    </div>
  );
}

/** The whole list in two words. With none waiting, how many are busy says they are not stuck. */
export function agentSummary(agents: AgentsPayload): { text: string; color: string } {
  const waiting = waitingOnYou(agents);
  if (waiting > 0) return { text: waiting + ' WAITING', color: 'var(--cc-accent)' };
  if (agents.sessions.length > 0) return { text: agents.sessions.length + ' AT WORK', color: 'var(--cc-muted)' };
  return { text: 'IDLE', color: 'var(--cc-dim)' };
}

function Agents(_: WidgetProps) {
  const agents = useTopic<AgentsPayload>('dev:agents');
  const size = useTileSize();
  const now = useNow();
  const line = useBreakpoint(size.h, LINE_BELOW);

  if (!agents) {
    return (
      <Pane label="AGENTS" topic="dev:agents">
        <Awaiting label="AGENT SESSIONS" />
      </Pane>
    );
  }

  // Optional, as the quota widget's source is: out of the danger colour.
  if (!agents.available) {
    return (
      <Pane label="AGENTS" topic="dev:agents">
        <div style={{ margin: 'auto', textAlign: 'center', padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--cc-muted)' }}>NO AGENT TRANSCRIPTS</div>
          <div className="cc-mini" style={{ marginTop: 8, lineHeight: 1.6 }}>
            {agents.reason}
          </div>
          <div className="cc-mini" style={{ marginTop: 6 }}>
            THIS SOURCE IS OPTIONAL
          </div>
        </div>
      </Pane>
    );
  }

  const head = agentSummary(agents);

  if (line) {
    const top = agents.sessions[0];
    return (
      <div
        style={{
          flex: 1,
          background: 'var(--cc-pane)',
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <span className="cc-mini" style={{ letterSpacing: '0.22em', flex: 'none' }}>
          AGENTS
        </span>
        <span style={{ fontSize: 18, color: head.color, flex: 'none', whiteSpace: 'nowrap' }}>{head.text}</span>
        {top && (
          <span style={{ fontSize: 12, color: 'var(--cc-muted)', minWidth: 0, ...ELLIPSIS }}>
            {agentSentence(top, now)}
          </span>
        )}
      </div>
    );
  }

  const fit = Math.max(1, Math.floor((size.h - CHROME_H) / ROW_H));
  const shown = agents.sessions.slice(0, fit);
  const hidden = agents.sessions.length - shown.length;

  return (
    <Pane
      label="AGENTS"
      topic="dev:agents"
      padded={false}
      right={
        <span className="cc-mini" style={{ color: head.color }}>
          {head.text}
        </span>
      }
    >
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {shown.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center' }}>
            <span className="cc-mini" style={{ color: 'var(--cc-line-2)' }}>
              NO SESSIONS IN THE LAST HOUR
            </span>
          </div>
        ) : (
          shown.map((session) => <AgentRow key={session.id} session={session} now={now} />)
        )}
      </div>
      {hidden > 0 && (
        <div
          style={{
            flex: 'none',
            height: 26,
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            background: 'var(--cc-inset)',
            borderTop: '1px solid var(--cc-line)',
          }}
        >
          <span className="cc-mini">+{hidden} MORE</span>
        </div>
      )}
    </Pane>
  );
}

export const agentsSpec: WidgetSpec = {
  min: [3, 1],
  topics: ['dev:agents'],
  component: Agents,
};
