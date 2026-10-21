import { useState } from 'react';
import type { ReactNode } from 'react';
import { compact, mmss, sparkPath } from '../core/format';
import { useSettings } from '../core/settings';
import { useTopic } from '../core/useTopic';
import type { AgentsPayload, CpuPayload, MemPayload, QuotaPayload, SprintPayload } from '../core/payloads';
import type { WidgetProps, WidgetSpec } from '../core/types';
import { AgentRow, agentSentence, useNow, waitingOnYou } from './Agents';
import { Meter } from './chrome';
import { blockEnds, budgetPct, budgetStatus, totalTokens } from './Quota';
import { SprintControls, focusedToday, sprintColor, sprintLabel, sprintStatus } from './Sprint';

interface Hero {
  label: string;
  value: string;
  status: string;
  sub: string;
  meter: number;
  color: string;
  series: number[];
  axisA: string;
  axisB: string;
  /** Sits where the sparkline would, for a tab that has something to operate. */
  controls?: ReactNode;
}

function Stage({ props }: WidgetProps) {
  const tabs = ((props.tabs as string[] | undefined) ?? ['quota', 'agents', 'machine', 'sprint']).filter(Boolean);
  const [picked, setPicked] = useState(tabs[0] ?? 'quota');
  const { settings } = useSettings();

  const quota = useTopic<QuotaPayload>('dev:llm_tokens');
  const agents = useTopic<AgentsPayload>('dev:agents');
  const cpu = useTopic<CpuPayload>('telemetry:cpu');
  const mem = useTopic<MemPayload>('telemetry:mem');
  const sprint = useTopic<SprintPayload>('flow:pomodoro');
  const now = useNow();

  // A tab whose source has said it cannot report is dropped rather than left
  // as a dead end in the hero tile. Only an explicit refusal counts: a topic
  // that has not published yet is still on its way, and hiding it would empty
  // the strip for the first seconds after launch. Derived rather than synced
  // into state, so the tab comes back by itself if its source turns up.
  const noSource = (t: string) =>
    (t === 'quota' && quota?.available === false) || (t === 'agents' && agents?.available === false);
  const visible = tabs.filter((t) => !noSource(t));
  const shown = visible.length > 0 ? visible : tabs;
  const tab = shown.includes(picked) ? picked : (shown[0] ?? 'quota');

  let hero: Hero | null = null;

  if (tab === 'quota' && quota?.available) {
    const pct = budgetPct(quota, settings.budgetTokens);
    const status = budgetStatus(pct);
    hero = {
      label: quota.provider.toUpperCase() + ' / ' + quota.windowHours + 'H BLOCK',
      value: pct === null ? compact(totalTokens(quota)) : pct + '%',
      status: status.label,
      sub:
        compact(quota.cacheRead) +
        ' read from cache, ' +
        compact(quota.cacheWrite) +
        ' written, ' +
        compact(quota.tokensOut) +
        ' out across ' +
        quota.requests +
        ' requests. ' +
        blockEnds(quota) +
        '.',
      meter: pct ?? Math.min(100, quota.burnPerMin / 500),
      color: status.color,
      series: quota.history,
      axisA: '-' + quota.windowHours + 'H',
      axisB: 'NOW',
    };
  } else if (tab === 'agents' && agents?.available) {
    const waiting = waitingOnYou(agents);
    const total = agents.sessions.length;
    const top = agents.sessions[0];
    hero = {
      label: 'AGENTS / ' + total + (total === 1 ? ' SESSION' : ' SESSIONS') + ' IN THE LAST HOUR',
      value: String(waiting),
      status: waiting > 0 ? 'WAITING ON YOU' : total > 0 ? 'ALL AT WORK' : 'IDLE',
      sub: top ? agentSentence(top, now) : 'No session has written anything in the last hour.',
      meter: total > 0 ? (waiting / total) * 100 : 0,
      // An error outranks a finished reply: both are yours, one is bad news.
      color: top?.state === 'error' ? 'var(--cc-danger)' : waiting > 0 ? 'var(--cc-accent)' : 'var(--cc-muted)',
      series: [],
      axisA: '',
      axisB: '',
      controls: (
        <div style={{ borderTop: '1px solid var(--cc-line)' }}>
          {agents.sessions.slice(0, 3).map((session) => (
            <AgentRow key={session.id} session={session} now={now} />
          ))}
        </div>
      ),
    };
  } else if (tab === 'machine' && cpu) {
    hero = {
      label: 'CPU / ' + cpu.threads.length + ' THREADS',
      value: cpu.pct + '%',
      status: cpu.tempC === null ? 'NO SENSOR' : cpu.tempC.toFixed(0) + '\u00b0C',
      sub: mem
        ? mem.usedGib.toFixed(1) + ' of ' + mem.totalGib.toFixed(1) + ' GiB used at ' + cpu.clockGhz.toFixed(2) + ' GHz.'
        : 'Memory poller has not reported yet.',
      meter: cpu.pct,
      color: 'var(--cc-accent)',
      series: cpu.threads,
      axisA: 'PER THREAD',
      axisB: 'T' + (cpu.threads.length - 1),
    };
  } else if (tab === 'sprint' && sprint) {
    hero = {
      label: (sprint.mode === 'focus' ? 'FOCUS ' : '') + sprintLabel(sprint),
      value: mmss(sprint.remainingSec),
      status: sprintStatus(sprint),
      sub: focusedToday(sprint) + ' focused today.',
      meter: sprint.lengthSec > 0 ? 100 - (sprint.remainingSec / sprint.lengthSec) * 100 : 0,
      // As on the Sprint tile: a countdown that is not counting is not lit.
      color: sprint.state === 'running' ? sprintColor(sprint) : 'var(--cc-muted)',
      series: [],
      axisA: '',
      axisB: '',
      controls: <SprintControls sprint={sprint} height={36} />,
    };
  }

  const path = hero && hero.series.length > 1 ? sparkPath(hero.series, 1000, 132) : '';

  return (
    <div
      style={{
        // Fill the tile, as Pane does. Without this the hero is only as tall as
        // its tab's content and the cell shows through beneath it.
        flex: 1,
        background: 'var(--cc-pane)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', flex: 'none', background: 'var(--cc-inset)' }}>
        {shown.map((t) => (
          <button
            key={t}
            onClick={() => setPicked(t)}
            style={{
              height: 33,
              padding: '0 20px',
              fontSize: 10,
              letterSpacing: '0.16em',
              border: 0,
              borderBottom: '1px solid ' + (tab === t ? 'transparent' : 'var(--cc-line)'),
              background: tab === t ? 'var(--cc-pane)' : 'transparent',
              color: tab === t ? 'var(--cc-text)' : 'var(--cc-dim)',
              boxShadow: tab === t ? 'inset 0 2px 0 var(--cc-accent)' : 'none',
            }}
          >
            {t.toUpperCase()}
          </button>
        ))}
        <div style={{ flex: 1, borderBottom: '1px solid var(--cc-line)' }} />
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: '32px 40px 24px', display: 'flex', flexDirection: 'column' }}>
        {!hero ? (
          <div style={{ margin: 'auto', textAlign: 'center' }}>
            <div className="cc-label">{tab.toUpperCase()}</div>
            <div style={{ fontSize: 30, fontWeight: 200, color: 'var(--cc-line-2)', marginTop: 10 }}>--</div>
            <div className="cc-mini" style={{ marginTop: 8 }}>
              {noSource(tab) ? 'NO SOURCE' : 'AWAITING FIRST EVENT'}
            </div>
          </div>
        ) : (
          <>
            <span className="cc-label" style={{ fontSize: 11 }}>{hero.label}</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 26, marginTop: 10 }}>
              <span
                style={{
                  fontSize: 'clamp(56px, 13vw, 168px)',
                  fontWeight: 200,
                  lineHeight: 0.9,
                  letterSpacing: '-0.045em',
                  color: hero.color,
                }}
              >
                {hero.value}
              </span>
              <span style={{ fontSize: 17, letterSpacing: '0.16em', color: hero.color }}>{hero.status}</span>
            </div>
            <span style={{ fontSize: 17, color: 'var(--cc-muted)', marginTop: 20 }}>{hero.sub}</span>
            <div style={{ marginTop: 24 }}>
              <Meter pct={hero.meter} color={hero.color} height={14} />
            </div>
            <div style={{ flex: 1 }} />
            {path && (
              <>
                <svg
                  width="100%"
                  height="132"
                  viewBox="0 0 1000 132"
                  preserveAspectRatio="none"
                  style={{ display: 'block' }}
                >
                  <path d={path + ' L1000 132 L0 132 Z'} fill={hero.color} opacity="0.1" />
                  <path d={path} fill="none" stroke={hero.color} strokeWidth="1.6" />
                </svg>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 9 }}>
                  <span className="cc-mini">{hero.axisA}</span>
                  <span className="cc-mini">{hero.axisB}</span>
                </div>
              </>
            )}
            {hero.controls}
          </>
        )}
      </div>
    </div>
  );
}

export const stageSpec: WidgetSpec = {
  min: [6, 4],
  topics: ['dev:llm_tokens', 'dev:agents', 'telemetry:cpu', 'telemetry:mem', 'flow:pomodoro'],
  component: Stage,
};
