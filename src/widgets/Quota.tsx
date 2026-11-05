import type { CSSProperties } from 'react';
import { compact, humanDuration, sparkPath } from '../core/format';
import { useNav } from '../core/nav';
import { useSettings } from '../core/settings';
import { useTileSize } from '../core/TileSize';
import { useTopic } from '../core/useTopic';
import type { QuotaPayload } from '../core/payloads';
import type { WidgetProps } from '../core/types';
import { Awaiting, Meter, Pane } from './chrome';

/** Escalation against a budget the user set. Under it, the number is just a number. */
export function budgetStatus(pct: number | null): { label: string; color: string } {
  if (pct === null) return { label: 'No budget set', color: 'var(--cc-text)' };
  if (pct >= 92) return { label: 'Over budget', color: 'var(--cc-danger)' };
  if (pct >= 80) return { label: 'Near budget', color: 'var(--cc-danger)' };
  return { label: 'Within budget', color: 'var(--cc-text)' };
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
  gap: 16,
  minWidth: 0,
  overflow: 'hidden',
  flex: 1,
};

export function Quota({ props }: WidgetProps) {
  const quota = useTopic<QuotaPayload>('dev:llm_tokens');
  const size = useTileSize();
  const { settings } = useSettings();
  const { openSettings } = useNav();
  const line = props.density === 'line';

  if (!quota) {
    return (
      <Pane label="Token usage">
        <Awaiting label="This block" />
      </Pane>
    );
  }

  // Nothing to read is not a failure: the source is optional, so this stays
  // out of the danger colour a refused notification listener uses.
  if (!quota.available) {
    if (line) {
      return (
        <div style={LINE}>
          <span className="cc-label" style={{ flex: 'none' }}>
            Agent tokens
          </span>
          <span className="cc-mini">No transcripts to read</span>
        </div>
      );
    }
    return (
      <Pane label="Token usage">
        <div style={{ margin: 'auto', textAlign: 'center', padding: 16 }}>
          <div style={{ fontSize: 14, color: 'var(--cc-muted)' }}>No agent transcripts</div>
          <div className="cc-mini" style={{ marginTop: 8, lineHeight: 1.6 }}>
            {quota.reason}
          </div>
          <div className="cc-mini" style={{ marginTop: 4 }}>
            This source is optional.
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
    // One line in a tall tile reads larger: it grows with the tile, up to twice.
    const k = Math.max(1, Math.min(2, size.h / 110));
    return (
      <div style={LINE}>
        <span className="cc-label" style={{ flex: 'none', fontSize: Math.round(12 * Math.min(k, 1.4)) }}>
          {quota.windowHours}-hour block
        </span>
        <span className="cc-display" style={{ fontSize: Math.round(32 * k), color: status.color, flex: 'none' }}>{hero}</span>
        <span style={{ fontSize: Math.round(14 * Math.min(k, 1.5)), color: 'var(--cc-muted)', whiteSpace: 'nowrap' }}>
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
    <Pane label="Token usage" right={pct !== null ? <span style={{ color: status.color }}>{status.label}</span> : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span className="cc-label">{quota.windowHours}-hour block</span>
        {pct === null && (
          // No budget is a choice not yet made, not an alarm: a way to make it.
          <button className="cc-chip cc-bare" style={{ color: 'var(--cc-muted)' }} onClick={() => openSettings('SOURCES')}>
            Set a budget
          </button>
        )}
      </div>
      <div style={{ flex: 1 }} />
      <span
        className="cc-display"
        style={{
          fontSize: `clamp(28px, ${Math.max(22, Math.round(size.h * 0.28))}px, 84px)`,
          lineHeight: 0.95,
          color: status.color,
        }}
      >
        {hero}
      </span>
      {/* Sections go from the bottom as the tile shortens: this line below 170, the details below 240. */}
      {size.h > 170 && (
        <span style={{ fontSize: 14, color: 'var(--cc-muted)', marginTop: 12 }}>
          {quota.blockStartMs === null
            ? 'No block running'
            : pct === null
              ? 'Tokens this block'
              : compact(used) + ' tokens'}
        </span>
      )}
      {size.h > 240 && (
        <span className="cc-mini" style={{ marginTop: 4 }}>
          {compact(quota.burnPerMin)} a minute · {quota.requests} requests ·{' '}
          {quota.blockStartMs === null ? 'the next request starts one' : 'resets in about ' + humanDuration(quota.resetsInMs)}
        </span>
      )}
      <div style={{ flex: 1 }} />
      {size.h > 200 && path && (
        <svg width="100%" height="52" viewBox="0 0 400 52" preserveAspectRatio="none" style={{ display: 'block' }}>
          <path d={path + ' L400 52 L0 52 Z'} fill="var(--cc-muted)" opacity="0.1" />
          <path d={path} fill="none" stroke="var(--cc-muted)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
    </Pane>
  );
}
