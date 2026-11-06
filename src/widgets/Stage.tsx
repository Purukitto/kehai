import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { compact, humanDuration, mmss, sparkPath } from '../core/format';
import { useNav } from '../core/nav';
import { useSettings } from '../core/settings';
import { useTileSize } from '../core/TileSize';
import { useTopic } from '../core/useTopic';
import type { AgentsPayload, CpuPayload, MemPayload, QuotaPayload, SprintPayload } from '../core/payloads';
import type { WidgetProps } from '../core/types';
import { AgentRow, agentSentence, useJump, useNow, waitingOnYou } from './Agents';
import { Meter } from './chrome';
import { budgetPct, budgetStatus, totalTokens } from './Quota';
import { SprintControls, focusedToday, sprintColor, sprintLabel, sprintStatus } from './Sprint';

/** What each tab is called on screen. The ids are what layouts store. */
const TAB_NAMES: Record<string, string> = {
  quota: 'Tokens',
  agents: 'Agents',
  machine: 'Machine',
  sprint: 'Focus',
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
  const { said, jump } = useJump();

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

  // Sized from the tile, not the window: the same hero is wide and short on a
  // bar display and narrow and tall in portrait.
  const valueSize = Math.round(Math.max(48, Math.min(168, size.w ? size.w * 0.14 : 168, size.h ? size.h * 0.32 : 168)));
  // What is left under the tabs, the value, its sentence and its meter, in
  // agent rows: as many as fit, up to three.
  const rowsFit = Math.max(0, Math.min(3, Math.floor((size.h - 229 - valueSize * 0.9) / 48)));

  let hero: Hero | null = null;

  if (tab === 'quota' && quota?.available) {
    const pct = budgetPct(quota, settings.budgetTokens);
    const status = budgetStatus(pct);
    const blockMs = quota.windowHours * 3_600_000;
    const elapsed = quota.blockStartMs === null ? 0 : Math.min(blockMs, Math.max(0, now - quota.blockStartMs));
    const resets = 'resets in about ' + humanDuration(quota.resetsInMs);
    const budget = settings.budgetTokens ?? quota.budgetTokens;
    hero = {
      label: 'Token usage · ' + quota.windowHours + '-hour block',
      value: pct === null ? compact(totalTokens(quota)) : pct + '%',
      // A missing budget is not an alarm. Say where to set one, quietly.
      status:
        pct === null ? (
          <button
            className="cc-chip"
            style={{ alignSelf: 'center', color: 'var(--cc-muted)' }}
            onClick={() => openSettings('SOURCES')}
            title="Settings → Sources → Token budget"
          >
            Set a budget
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
          ? { pct, label: 'Budget · ' + compact(totalTokens(quota)) + ' of ' + compact(budget), note: resets }
          : quota.blockStartMs === null
            ? { pct: 0, label: 'No block running', note: 'the next request starts one' }
            : {
                pct: (elapsed / blockMs) * 100,
                label: 'Block so far · ' + humanDuration(elapsed) + ' of ' + quota.windowHours + 'h',
                note: resets,
              },
      color: status.color,
      series: quota.history,
      chartLabel: 'Tokens over the last ' + quota.windowHours + ' hours',
      axisA: quota.windowHours + 'h ago',
      axisB: 'Now',
    };
  } else if (tab === 'agents' && agents?.available) {
    const total = agents.sessions.length;
    const top = agents.sessions[0];
    hero = {
      label: 'Agents · ' + total + (total === 1 ? ' session' : ' sessions') + ' in the last hour',
      value: String(waiting),
      status: waiting > 0 ? 'waiting on you' : total > 0 ? 'all at work' : 'idle',
      sub: top ? agentSentence(top, now) : 'No session has written anything in the last hour.',
      meter: { pct: total > 0 ? (waiting / total) * 100 : 0, label: 'Waiting on you · ' + waiting + ' of ' + total },
      // An error outranks a finished reply: both are yours, one is bad news.
      color: top?.state === 'error' ? 'var(--cc-danger)' : waiting > 0 ? 'var(--cc-accent)' : 'var(--cc-muted)',
      series: [],
      axisA: '',
      axisB: '',
      controls: (
        <div style={{ borderBottom: '1px solid var(--cc-line)', margin: '0 -16px' }}>
          {agents.sessions.slice(0, rowsFit).map((session) => (
            <AgentRow key={session.id} session={session} now={now} said={said[session.id]} onJump={jump} />
          ))}
        </div>
      ),
    };
  } else if (tab === 'machine' && cpu) {
    hero = {
      label: 'Processor · ' + cpu.threads.length + ' threads',
      value: cpu.pct + '%',
      status: cpu.tempC === null ? 'no temperature sensor' : cpu.tempC.toFixed(0) + '°C',
      sub:
        cpu.threads.length +
        ' threads at ' +
        cpu.clockGhz.toFixed(2) +
        ' GHz.' +
        (mem ? ' Memory: ' + mem.usedGib.toFixed(1) + ' of ' + mem.totalGib.toFixed(1) + ' GiB in use.' : ''),
      meter: {
        pct: cpu.pct,
        label: 'Processor load',
        note: mem && mem.totalGib > 0 ? 'memory ' + Math.round((mem.usedGib / mem.totalGib) * 100) + '%' : undefined,
      },
      color: 'var(--cc-text)',
      series: cpu.threads,
      bars: true,
      chartLabel: 'Load per thread',
      axisA: 'Thread 0',
      axisB: 'Thread ' + (cpu.threads.length - 1),
    };
  } else if (tab === 'sprint' && sprint) {
    const elapsedSec = Math.max(0, sprint.lengthSec - sprint.remainingSec);
    hero = {
      label: (sprint.mode === 'focus' ? 'Focus · ' : '') + sprintLabel(sprint),
      value: mmss(sprint.remainingSec),
      status: sprintStatus(sprint).toLowerCase(),
      sub: focusedToday(sprint) + ' focused today.',
      meter: {
        pct: sprint.lengthSec > 0 ? (elapsedSec / sprint.lengthSec) * 100 : 0,
        label: sprint.mode === 'focus' ? 'This focus block' : 'This break',
        note: mmss(elapsedSec) + ' of ' + mmss(sprint.lengthSec),
      },
      // As on the Sprint tile: a countdown that is not counting is not lit.
      color: sprint.state === 'running' ? sprintColor(sprint) : 'var(--cc-muted)',
      series: [],
      axisA: '',
      axisB: '',
      controls: <SprintControls sprint={sprint} height={36} />,
    };
  }

  // The chart takes what is left under the value, sentence and meter, and stays
  // out when that is too little to read.
  const chartH = Math.min(132, Math.round(size.h - (36 + 56 + 24 + valueSize * 0.9 + 37 + 60 + 66)));
  // A bar or a line in the text colour would outshout the value above it.
  const quiet = hero && hero.color !== 'var(--cc-text)' ? hero.color : 'var(--cc-accent)';
  const charted = chartH >= 44;
  const path = hero && charted && !hero.bars && hero.series.length > 1 ? sparkPath(hero.series, 1000, chartH) : '';
  const peak = hero?.bars ? Math.max(100, ...hero.series) : 0;

  return (
    <div
      // An agent waiting lights the tile from inside, and nothing else does.
      className={tab === 'agents' && waiting > 0 ? 'cc-glow' : undefined}
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
      <div style={{ display: 'flex', flex: 'none', alignItems: 'center', gap: 4, padding: '16px 24px 0' }}>
        {shown.map((t) => (
          <button
            key={t}
            onClick={() => pick(t)}
            className={tab === t ? 'cc-chip cc-chip-on' : 'cc-chip cc-bare'}
            style={{
              height: 34,
              padding: '0 16px',
              gap: 8,
              fontSize: 14,
              color: tab === t ? 'var(--cc-text)' : 'var(--cc-muted)',
            }}
          >
            {TAB_NAMES[t] ?? t}
            {t === 'agents' && waiting > 0 && (
              <span style={{ color: 'var(--cc-accent)', fontWeight: 600 }} aria-label={waiting + ' waiting'}>
                {waiting}
              </span>
            )}
          </button>
        ))}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 }}>
          {following && picked !== 'agents' && (
            <span className="cc-mini" style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>
              Moved here while an agent waits
            </span>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: '32px 40px 24px', display: 'flex', flexDirection: 'column' }}>
        {!hero ? (
          <div style={{ margin: 'auto', textAlign: 'center' }}>
            <div className="cc-label">{TAB_NAMES[tab] ?? tab}</div>
            <div style={{ fontSize: 30, fontWeight: 300, color: 'var(--cc-line-2)', marginTop: 8 }}>--</div>
            <div className="cc-mini" style={{ marginTop: 8 }}>
              {noSource(tab) ? 'Nothing to read on this PC' : 'Nothing heard yet'}
            </div>
          </div>
        ) : (
          <>
            <span className="cc-label" style={{ fontSize: 14 }}>{hero.label}</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 24, marginTop: 8, flexWrap: 'wrap' }}>
              <span
                className="cc-display"
                style={{
                  fontSize: valueSize,
                  lineHeight: 0.9,
                  color: hero.color === 'var(--cc-text)' ? 'var(--cc-text)' : hero.color,
                }}
              >
                {hero.value}
              </span>
              {typeof hero.status === 'string' ? (
                <span style={{ fontSize: 20, color: hero.color === 'var(--cc-text)' ? 'var(--cc-muted)' : hero.color }}>{hero.status}</span>
              ) : (
                hero.status
              )}
            </div>
            <span style={{ fontSize: 16, color: 'var(--cc-muted)', marginTop: 16, maxWidth: '68ch' }}>{hero.sub}</span>
            <div style={{ marginTop: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <span className="cc-label">{hero.meter.label}</span>
                {hero.meter.note && (
                  <span className="cc-mini" style={{ whiteSpace: 'nowrap' }}>
                    {hero.meter.note}
                  </span>
                )}
              </div>
              <Meter pct={hero.meter.pct} color={quiet ?? 'var(--cc-muted)'} height={6} />
            </div>
            <div style={{ flex: 1 }} />
            {(path || (hero.bars && charted)) && (
              <>
                {hero.chartLabel && (
                  <span className="cc-label" style={{ marginTop: 24, marginBottom: 8 }}>
                    {hero.chartLabel}
                  </span>
                )}
                {hero.bars ? (
                  <div style={{ height: chartH, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
                    {hero.series.map((v, i) => (
                      <div
                        key={i}
                        style={{ flex: 1, height: `${Math.max(2, (v / peak) * 100)}%`, background: v > 82 ? 'var(--cc-danger)' : 'var(--cc-line-2)', borderRadius: 1 }}
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
                    <defs>
                      <linearGradient id="cc-stage-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor={quiet ?? 'var(--cc-accent)'} stopOpacity="0.16" />
                        <stop offset="1" stopColor={quiet ?? 'var(--cc-accent)'} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d={path + ` L1000 ${chartH} L0 ${chartH} Z`} fill="url(#cc-stage-fill)" />
                    <path d={path} fill="none" stroke={quiet ?? 'var(--cc-accent)'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                  </svg>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
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
