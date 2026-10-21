import { clockParts } from '../core/format';
import { useTileSize } from '../core/TileSize';
import { useTopic } from '../core/useTopic';
import type { ClockPayload } from '../core/payloads';
import type { WidgetProps, WidgetSpec } from '../core/types';

function Clock({ props }: WidgetProps) {
  const size = useTileSize();
  const tick = useTopic<ClockPayload>('os:clock');
  const seconds = props.seconds === true;
  const hero = props.size === 'hero';
  const { time, date } = clockParts(tick ? new Date(tick.iso) : new Date(), seconds);

  // Height sets the size; width caps it, so a narrow tile gets a smaller clock
  // rather than one cut off at the edge. Mono digits advance 0.6em each.
  const pad = hero ? 40 : 20;
  const [floor, byHeight, ceiling] = hero ? [48, size.h * 0.42, 208] : [24, size.h * 0.34, 72];
  const byWidth = size.w > 0 ? (size.w - pad * 2) / (time.length * 0.6) : Infinity;
  const fontSize = Math.max(12, Math.round(Math.min(Math.max(floor, byHeight), ceiling, byWidth)));

  return (
    <div
      style={{
        flex: 1,
        background: 'var(--cc-pane)',
        padding: pad,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          fontSize,
          fontWeight: hero ? 100 : 200,
          lineHeight: 0.92,
          letterSpacing: '-0.04em',
          whiteSpace: 'nowrap',
        }}
      >
        {time}
      </span>
      <span
        style={{
          display: size.h > 110 ? 'block' : 'none',
          fontSize: hero ? 18 : 12,
          letterSpacing: '0.2em',
          color: 'var(--cc-muted)',
          marginTop: hero ? 24 : 10,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {date}
      </span>
    </div>
  );
}

export const clockSpec: WidgetSpec = {
  min: [2, 2],
  topics: ['os:clock'],
  component: Clock,
};
