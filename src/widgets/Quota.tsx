import type { CSSProperties } from 'react';
import { compact, humanDuration, sparkPath } from '../core/format';
import { useSettings } from '../core/settings';
import { useTileSize } from '../core/TileSize';
import { useTopic } from '../core/useTopic';
import type { QuotaPayload } from '../core/payloads';
import type { WidgetProps, WidgetSpec } from '../core/types';
import { Awaiting, Meter, Pane } from './chrome';

/** Escalation against a budget the user set. Amber stays the identity colour. */
export function budgetStatus(pct: number | null): { label: string; color: string } {
  if (pct === null) return { label: 'NO BUDGET SET', color: 'var(--cc-accent)' };
  if (pct >= 92) return { label: 'OVER BUDGET', color: 'var(--cc-danger)' };
  if (pct >= 80) return { label: 'NEAR BUDGET', color: 'var(--cc-danger)' };
  return { label: 'NOMINAL', color: 'var(--cc-accent)' };
}

/**
 * Everything the window actually put through the model.
 *
 * An agent that caches its context reports a handful of `tokensIn` per request
 * while the cache counters carry the real volume. Summing only in and out would
 * understate usage by orders of magnitude.
 */
export function totalTokens(quota: QuotaPayload): number {
  return quota.tokensIn + quota.cacheRead + quota.cacheWrite + quota.tokensOut;
}

export function budgetPct(quota: QuotaPayload, budget?: number | null): number | null {
  const limit = budget ?? quota.budgetTokens;
  if (!limit) return null;
  return Math.round((totalTokens(quota) / limit) * 100);
}

/**
 * When the limit window resets. Approximate, because the window is worked out
 * from transcripts rather than read from the provider, and said so.
 */
export function blockEnds(quota: QuotaPayload): string {
  return quota.blockStartMs === null
    ? 'The next request starts a block'
    : 'Resets in ~' + humanDuration(quota.resetsInMs);
}

/** The single-row layout the Ambient preset uses, with or without data. */
const LINE: CSSProperties = {
  background: 'var(--cc-pane)',
  padding: '0 40px',
  display: 'flex',
  alignItems: 'center',
  gap: 18,
  minWidth: 0,
  overflow: 'hidden',
  flex: 1,
};

function Quota({ props }: WidgetProps) {
  const quota = useTopic<QuotaPayload>('dev:llm_tokens');
  const size = useTileSize();
  const { settings } = useSettings();
  const line = props.density === 'line';

  if (!quota) {
    return (
      <Pane label="LLM QUOTA" topic="dev:llm_tokens">
        <Awaiting label="SESSION USAGE" />
      </Pane>
    );
  }

  // Nothing to read is not a failure: the source is optional, so this stays
  // out of the danger colour a refused notification listener uses.
  if (!quota.available) {
    if (line) {
      return (
        <div style={LINE}>
          <span className="cc-mini" style={{ letterSpacing: '0.22em', flex: 'none' }}>
            AGENT TOKENS
          </span>
          <span className="cc-mini" style={{ color: 'var(--cc-dim)' }}>
            NO SOURCE
          </span>
        </div>
      );
    }
    return (
      <Pane label="LLM QUOTA" topic="dev:llm_tokens">
        <div style={{ margin: 'auto', textAlign: 'center', padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--cc-muted)' }}>NO AGENT TRANSCRIPTS</div>
          <div className="cc-mini" style={{ marginTop: 8, lineHeight: 1.6 }}>
            {quota.reason}
          </div>
          <div className="cc-mini" style={{ marginTop: 6 }}>
            THIS SOURCE IS OPTIONAL
          </div>
        </div>
      </Pane>
    );
  }

  const pct = budgetPct(quota, settings.budgetTokens);
  const status = budgetStatus(pct);
  const used = totalTokens(quota);
  const hero = pct === null ? compact(used) : pct + '%';

  if (line) {
    return (
      <div style={LINE}>
        <span className="cc-mini" style={{ letterSpacing: '0.22em', flex: 'none' }}>
          {quota.windowHours}H USAGE
        </span>
        <span style={{ fontSize: 30, fontWeight: 300, color: status.color, flex: 'none' }}>{hero}</span>
        <span style={{ fontSize: 14, color: 'var(--cc-muted)', whiteSpace: 'nowrap' }}>
          {compact(quota.burnPerMin)}/min
        </span>
        {pct !== null && (
          <div style={{ flex: 1, maxWidth: 460 }}>
            <Meter pct={pct} color={status.color} height={4} />
          </div>
        )}
      </div>
    );
  }

  const path = sparkPath(quota.history, 400, 52);

  return (
    <Pane label="LLM QUOTA" topic="dev:llm_tokens">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span className="cc-label">{quota.windowHours}H BLOCK</span>
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
      </div>
      <div style={{ flex: 1 }} />
      <span
        style={{
          fontSize: `clamp(28px, ${Math.max(22, Math.round(size.h * 0.28))}px, 84px)`,
          fontWeight: 200,
          lineHeight: 0.95,
          letterSpacing: '-0.035em',
          color: status.color,
        }}
      >
        {hero}
      </span>
      <span style={{ fontSize: 14, color: 'var(--cc-muted)', marginTop: 12 }}>
        {quota.blockStartMs === null
          ? 'NO ACTIVE BLOCK'
          : pct === null
            ? 'TOKENS THIS BLOCK'
            : compact(used) + ' TOKENS'}
      </span>
      {size.h > 240 && (
        <span className="cc-mini" style={{ marginTop: 6 }}>
          {compact(quota.burnPerMin)}/MIN · {quota.requests} REQUESTS ·{' '}
          {quota.blockStartMs === null ? 'NEXT REQUEST STARTS A BLOCK' : 'RESETS IN ~' + humanDuration(quota.resetsInMs)}
        </span>
      )}
      <div style={{ flex: 1 }} />
      {size.h > 200 && path && (
        <svg width="100%" height="52" viewBox="0 0 400 52" preserveAspectRatio="none" style={{ display: 'block' }}>
          <path d={path + ' L400 52 L0 52 Z'} fill={status.color} opacity="0.12" />
          <path d={path} fill="none" stroke={status.color} strokeWidth="1.4" />
        </svg>
      )}
    </Pane>
  );
}

export const quotaSpec: WidgetSpec = {
  min: [3, 2],
  topics: ['dev:llm_tokens'],
  component: Quota,
};
