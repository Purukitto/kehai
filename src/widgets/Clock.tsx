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

  return (
    <div
      style={{
        flex: 1,
        background: 'var(--cc-pane)',
        padding: hero ? 40 : 20,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          fontSize: hero
            ? `clamp(48px, ${Math.max(40, Math.round(size.h * 0.42))}px, 208px)`
            : `clamp(24px, ${Math.max(20, Math.round(size.h * 0.34))}px, 72px)`,
          fontWeight: hero ? 100 : 200,
          lineHeight: 0.92,
          letterSpacing: '-0.04em',
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
