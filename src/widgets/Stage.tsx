import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { compact, humanDuration, mmss, sparkPath } from '../core/format';
import { useNav } from '../core/nav';
import { useSettings } from '../core/settings';
import { useTileSize } from '../core/TileSize';
import { useTopic } from '../core/useTopic';
import type { AgentsPayload, CpuPayload, MemPayload, QuotaPayload, SprintPayload } from '../core/payloads';
import type { WidgetProps } from '../core/types';
import { AgentRow, agentSentence, useNow, waitingOnYou } from './Agents';
import { Meter } from './chrome';
import { budgetPct, budgetStatus, totalTokens } from './Quota';
import { SprintControls, focusedToday, sprintColor, sprintLabel, sprintStatus } from './Sprint';

/** What each tab is called on screen. The ids are what layouts store. */
const TAB_NAMES: Record<string, string> = {
  quota: 'TOKENS',
  agents: 'AGENTS',
  machine: 'MACHINE',
  sprint: 'FOCUS',
};

interface Hero {
  label: string;
  value: string;
  /** Beside the value: a state in words, or a button where there is something to do. */
  status: ReactNode;
  sub: string;
  /**
   * The bar under the value, always with a label saying what it measures. A bar
   * on every tab that means something different on each, unlabelled, reads as
   * one measure that keeps changing.
   */
  meter: { pct: number; label: string; note?: string };
  color: string;
  series: number[];
  /** One bar per item, for things that are side by side rather than over time. */
  bars?: boolean;
  chartLabel?: string;
  axisA: string;
  axisB: string;
  /** Sits where the chart would, for a tab that has something to operate. */
  controls?: ReactNode;
}

export function Stage({ props }: WidgetProps) {
  const tabs = ((props.tabs as string[] | undefined) ?? ['quota', 'agents', 'machine', 'sprint']).filter(Boolean);
  const { settings, setStageTab } = useSettings();
  const { openSettings } = useNav();

  const quota = useTopic<QuotaPayload>('dev:llm_tokens');
  const agents = useTopic<AgentsPayload>('dev:agents');
  const cpu = useTopic<CpuPayload>('telemetry:cpu');
  const mem = useTopic<MemPayload>('telemetry:mem');
  const sprint = useTopic<SprintPayload>('flow:pomodoro');
  const now = useNow();
  const size = useTileSize();

  // A tab whose source has said it cannot report is dropped rather than left
  // as a dead end in the hero tile. Only an explicit refusal counts: a topic
  // that has not published yet is still on its way, and hiding it would empty
  // the strip for the first seconds after launch. Derived rather than synced
  // into state, so the tab comes back by itself if its source turns up.
  const noSource = (t: string) =>
    (t === 'quota' && quota?.available === false) || (t === 'agents' && agents?.available === false);
  const visible = tabs.filter((t) => !noSource(t));
  const shown = visible.length > 0 ? visible : tabs;
  const picked = settings.stageTab && shown.includes(settings.stageTab) ? settings.stageTab : (shown[0] ?? 'quota');

  // Following attention: while an agent waits on you the hero shows Agents,
  // unless you have picked a tab since it started waiting. Another agent
  // starting to wait takes the hero back; none waiting returns it to yours.
  const waiting = agents?.available ? waitingOnYou(agents) : 0;
  const [heldOff, setHeldOff] = useState(false);
  const lastWaiting = useRef(waiting);
  useEffect(() => {
    if (waiting === 0 || waiting > lastWaiting.current) setHeldOff(false);
    lastWaiting.current = waiting;
  }, [waiting]);
  const following = settings.followAttention && waiting > 0 && !heldOff && shown.includes('agents');
  const tab = following ? 'agents' : picked;

  const pick = (t: string) => {
    setStageTab(t);
    if (waiting > 0) setHeldOff(true);
  };

  let hero: Hero | null = null;

  if (tab === 'quota' && quota?.available) {
    const pct = budgetPct(quota, settings.budgetTokens);
    const status = budgetStatus(pct);
    const blockMs = quota.windowHours * 3_600_000;
    const elapsed = quota.blockStartMs === null ? 0 : Math.min(blockMs, Math.max(0, now - quota.blockStartMs));
    const resets = 'RESETS IN ~' + humanDuration(quota.resetsInMs).toUpperCase();
    const budget = settings.budgetTokens ?? quota.budgetTokens;
    hero = {
      label: 'TOKEN USAGE · ' + quota.windowHours + 'H BLOCK',
      value: pct === null ? compact(totalTokens(quota)) : pct + '%',
      // A missing budget is not an alarm. Say where to set one, quietly.
      status:
        pct === null ? (
          <button
            className="cc-chip"
            style={{ padding: '6px 12px', alignSelf: 'center', color: 'var(--cc-muted)' }}
            onClick={() => openSettings('SOURCES')}
            title="Settings → Sources → Token budget"
          >
            SET A BUDGET
          </button>
        ) : (
          status.label
        ),
      sub:
        quota.requests +
        ' requests: ' +
        compact(quota.tokensOut) +
        ' out, ' +
        compact(quota.cacheRead) +
        ' read from cache, ' +
        compact(quota.cacheWrite) +
        ' written.',
      // Block time is real whether or not a budget is set; a budget only adds
      // a second thing worth measuring against.
      meter:
        pct !== null && budget
          ? { pct, label: 'BUDGET · ' + compact(totalTokens(quota)) + ' OF ' + compact(budget), note: resets }
          : quota.blockStartMs === null
            ? { pct: 0, label: 'NO BLOCK RUNNING', note: 'THE NEXT REQUEST STARTS ONE' }
            : {
                pct: (elapsed / blockMs) * 100,
                label: 'BLOCK ELAPSED · ' + humanDuration(elapsed).toUpperCase() + ' OF ' + quota.windowHours + 'H',
                note: resets,
              },
      color: status.color,
      series: quota.history,
      chartLabel: 'TOKENS · LAST ' + quota.windowHours + 'H',
      axisA: '-' + quota.windowHours + 'H',
      axisB: 'NOW',
    };
  } else if (tab === 'agents' && agents?.available) {
    const total = agents.sessions.length;
    const top = agents.sessions[0];
    hero = {
      label: 'AGENTS · ' + total + (total === 1 ? ' SESSION' : ' SESSIONS') + ' IN THE LAST HOUR',
      value: String(waiting),
      status: waiting > 0 ? 'WAITING ON YOU' : total > 0 ? 'ALL AT WORK' : 'IDLE',
      sub: top ? agentSentence(top, now) : 'No session has written anything in the last hour.',
      meter: { pct: total > 0 ? (waiting / total) * 100 : 0, label: 'WAITING ON YOU · ' + waiting + ' OF ' + total },
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
      label: 'PROCESSOR · ' + cpu.threads.length + ' THREADS',
      value: cpu.pct + '%',
      status: cpu.tempC === null ? 'NO SENSOR' : cpu.tempC.toFixed(0) + '°C',
      sub:
        cpu.threads.length +
        ' threads at ' +
        cpu.clockGhz.toFixed(2) +
        ' GHz.' +
        (mem ? ' Memory: ' + mem.usedGib.toFixed(1) + ' of ' + mem.totalGib.toFixed(1) + ' GiB in use.' : ''),
      meter: {
        pct: cpu.pct,
        label: 'PROCESSOR LOAD',
        note: mem && mem.totalGib > 0 ? 'MEMORY ' + Math.round((mem.usedGib / mem.totalGib) * 100) + '%' : undefined,
      },
      color: 'var(--cc-accent)',
      series: cpu.threads,
      bars: true,
      chartLabel: 'LOAD PER THREAD',
      axisA: 'T0',
      axisB: 'T' + (cpu.threads.length - 1),
    };
  } else if (tab === 'sprint' && sprint) {
    const elapsedSec = Math.max(0, sprint.lengthSec - sprint.remainingSec);
    hero = {
      label: (sprint.mode === 'focus' ? 'FOCUS ' : '') + sprintLabel(sprint),
      value: mmss(sprint.remainingSec),
      status: sprintStatus(sprint),
      sub: focusedToday(sprint) + ' focused today.',
      meter: {
        pct: sprint.lengthSec > 0 ? (elapsedSec / sprint.lengthSec) * 100 : 0,
        label: sprint.mode === 'focus' ? 'THIS FOCUS BLOCK' : 'THIS BREAK',
        note: mmss(elapsedSec) + ' OF ' + mmss(sprint.lengthSec),
      },
      // As on the Sprint tile: a countdown that is not counting is not lit.
      color: sprint.state === 'running' ? sprintColor(sprint) : 'var(--cc-muted)',
      series: [],
      axisA: '',
      axisB: '',
      controls: <SprintControls sprint={sprint} height={36} />,
    };
  }

  // Sized from the tile, not the window: the same hero is wide and short on a
  // bar display and narrow and tall in portrait. The chart takes what is left
  // under the value, sentence and meter, and stays out when that is too little
  // to read.
  const valueSize = Math.round(Math.max(48, Math.min(168, size.w ? size.w * 0.14 : 168, size.h ? size.h * 0.32 : 168)));
  const chartH = Math.min(132, Math.round(size.h - (33 + 56 + 24 + valueSize * 0.9 + 37 + 60 + 42)));
  const charted = chartH >= 44;
  const path = hero && charted && !hero.bars && hero.series.length > 1 ? sparkPath(hero.series, 1000, chartH) : '';
  const peak = hero?.bars ? Math.max(100, ...hero.series) : 0;

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
            onClick={() => pick(t)}
            style={{
              height: 33,
              padding: '0 20px',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 10,
              letterSpacing: '0.16em',
              border: 0,
              borderBottom: '1px solid ' + (tab === t ? 'transparent' : 'var(--cc-line)'),
              background: tab === t ? 'var(--cc-pane)' : 'transparent',
              color: tab === t ? 'var(--cc-text)' : 'var(--cc-dim)',
              boxShadow: tab === t ? 'inset 0 2px 0 var(--cc-accent)' : 'none',
            }}
          >
            {TAB_NAMES[t] ?? t.toUpperCase()}
            {t === 'agents' && waiting > 0 && (
              <span style={{ color: 'var(--cc-accent)', fontWeight: 600 }} aria-label={waiting + ' waiting'}>
                ●{waiting}
              </span>
            )}
          </button>
        ))}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            padding: '0 16px',
            borderBottom: '1px solid var(--cc-line)',
            minWidth: 0,
          }}
        >
          {following && picked !== 'agents' && (
            <span className="cc-mini" style={{ color: 'var(--cc-accent)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              MOVED HERE · AN AGENT IS WAITING
            </span>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: '32px 40px 24px', display: 'flex', flexDirection: 'column' }}>
        {!hero ? (
          <div style={{ margin: 'auto', textAlign: 'center' }}>
            <div className="cc-label">{TAB_NAMES[tab] ?? tab.toUpperCase()}</div>
            <div style={{ fontSize: 30, fontWeight: 200, color: 'var(--cc-line-2)', marginTop: 10 }}>--</div>
            <div className="cc-mini" style={{ marginTop: 8 }}>
              {noSource(tab) ? 'NO SOURCE' : 'AWAITING FIRST EVENT'}
            </div>
          </div>
        ) : (
          <>
            <span className="cc-label" style={{ fontSize: 11 }}>{hero.label}</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 26, marginTop: 10, flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: valueSize,
                  fontWeight: 200,
                  lineHeight: 0.9,
                  letterSpacing: '-0.045em',
                  color: hero.color,
                }}
              >
                {hero.value}
              </span>
              {typeof hero.status === 'string' ? (
                <span style={{ fontSize: 17, letterSpacing: '0.16em', color: hero.color }}>{hero.status}</span>
              ) : (
                hero.status
              )}
            </div>
            <span style={{ fontSize: 17, color: 'var(--cc-muted)', marginTop: 20 }}>{hero.sub}</span>
            <div style={{ marginTop: 22 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <span className="cc-label">{hero.meter.label}</span>
                {hero.meter.note && (
                  <span className="cc-mini" style={{ color: 'var(--cc-muted)', whiteSpace: 'nowrap' }}>
                    {hero.meter.note}
                  </span>
                )}
              </div>
              <Meter pct={hero.meter.pct} color={hero.color} height={14} />
            </div>
            <div style={{ flex: 1 }} />
            {(path || (hero.bars && charted)) && (
              <>
                {hero.chartLabel && (
                  <span className="cc-label" style={{ marginBottom: 8 }}>
                    {hero.chartLabel}
                  </span>
                )}
                {hero.bars ? (
                  <div style={{ height: chartH, display: 'flex', alignItems: 'flex-end', gap: 3 }}>
                    {hero.series.map((v, i) => (
                      <div
                        key={i}
                        style={{ flex: 1, height: `${Math.max(2, (v / peak) * 100)}%`, background: hero.color, opacity: 0.75 }}
                      />
                    ))}
                  </div>
                ) : (
                  <svg
                    width="100%"
                    height={chartH}
                    viewBox={`0 0 1000 ${chartH}`}
                    preserveAspectRatio="none"
                    style={{ display: 'block' }}
                  >
                    <path d={path + ` L1000 ${chartH} L0 ${chartH} Z`} fill={hero.color} opacity="0.1" />
                    <path d={path} fill="none" stroke={hero.color} strokeWidth="1.6" />
                  </svg>
                )}
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
