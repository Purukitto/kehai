import { clockParts } from '../core/format';
import { useTileSize } from '../core/TileSize';
import { useTopic } from '../core/useTopic';
import type { ClockPayload } from '../core/payloads';
import type { WidgetProps } from '../core/types';

export function Clock({ props }: WidgetProps) {
  const size = useTileSize();
  const tick = useTopic<ClockPayload>('os:clock');
  const seconds = props.seconds === true;
  const hero = props.size === 'hero';
  const { time, date } = clockParts(tick ? new Date(tick.iso) : new Date(), seconds);

  // Height sets the size; width caps it, so a narrow tile gets a smaller clock
  // rather than one cut off at the edge. Tabular digits advance 0.6em each.
  const pad = hero ? 40 : 20;
  // A hero clock grows with its tile however big that is; a small one stays a
  // line of the tile it shares.
  const [floor, byHeight, ceiling] = hero ? [48, size.h * 0.42, 480] : [24, size.h * 0.34, 72];
  const byWidth = size.w > 0 ? (size.w - pad * 2) / (time.length * 0.6) : Infinity;
  const inline = Math.max(12, Math.round(Math.min(Math.max(floor, byHeight), ceiling, byWidth)));

  // A hero tile taller than it is wide, as on a portrait display, fits much
  // bigger digits with the hours over the minutes. Only when that is clearly
  // bigger: a stacked clock reads slower, and is worth it for size alone. A
  // wide tile never stacks, however tall: two digits in a corner of it is not
  // a clock. The room left keeps the date and its gap in view.
  const room = size.h - pad * 2 - 64;
  const stacked = !seconds && size.w > 0 ? Math.round(Math.min(room / 1.84, (size.w - pad * 2) / 1.2, 420)) : 0;
  const stack = hero && size.h > size.w && stacked >= inline * 1.25;
  const fontSize = stack ? stacked : inline;
  const [hours, minutes] = time.split(':');

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
        className="cc-display"
        style={{
          fontSize,
          lineHeight: 0.92,
          whiteSpace: 'nowrap',
          display: 'block',
        }}
        aria-label={time}
      >
        {stack ? (
          <>
            {hours}
            <br />
            {minutes}
          </>
        ) : (
          time
        )}
      </span>
      <span
        style={{
          display: size.h > 110 ? 'block' : 'none',
          fontSize: hero ? 18 : 13,
          color: 'var(--cc-muted)',
          marginTop: hero ? 24 : 8,
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
