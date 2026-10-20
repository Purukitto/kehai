import { mmss } from '../core/format';
import { useTileSize } from '../core/TileSize';
import { useTopic } from '../core/useTopic';
import type { SprintPayload } from '../core/payloads';
import type { WidgetProps, WidgetSpec } from '../core/types';
import { Awaiting, Pane } from './chrome';

function Sprint(_: WidgetProps) {
  const size = useTileSize();
  const sprint = useTopic<SprintPayload>('flow:pomodoro');

  if (!sprint) {
    return (
      <Pane label="SPRINT" topic="flow:pomodoro">
        <Awaiting label="FOCUS SPRINT" />
      </Pane>
    );
  }

  const hours = Math.floor(sprint.focusedTodaySec / 3600);
  const mins = Math.floor((sprint.focusedTodaySec % 3600) / 60);

  // The numeral is the widget. Everything around it goes before it shrinks.
  const showToday = size.h > 210;
  const showTrack = size.h > 160;

  return (
    <Pane label="SPRINT" topic="flow:pomodoro">
      <span className="cc-label">
        SPRINT {sprint.index} OF {sprint.total}
      </span>
      <div style={{ flex: 1 }} />
      <span
        style={{
          fontSize: `clamp(30px, ${Math.max(24, Math.round(size.h * 0.34))}px, 92px)`,
          fontWeight: 200,
          lineHeight: 0.95,
          letterSpacing: '-0.035em',
          color: sprint.mode === 'focus' ? 'var(--cc-accent)' : 'var(--cc-accent-2)',
        }}
      >
        {mmss(sprint.remainingSec)}
      </span>
      {showToday && (
        <span style={{ fontSize: 14, color: 'var(--cc-muted)', marginTop: 12 }}>
          {hours}h {mins}m FOCUSED TODAY
        </span>
      )}
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', gap: 3, flex: 'none', visibility: showTrack ? 'visible' : 'hidden' }}>
        {Array.from({ length: sprint.total }, (_v, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 6,
              background:
                i < sprint.index - 1
                  ? 'var(--cc-accent)'
                  : i === sprint.index - 1
                    ? 'var(--cc-accent-2)'
                    : 'var(--cc-line)',
            }}
          />
        ))}
      </div>
    </Pane>
  );
}

export const sprintSpec: WidgetSpec = {
  min: [2, 2],
  topics: ['flow:pomodoro'],
  component: Sprint,
};
