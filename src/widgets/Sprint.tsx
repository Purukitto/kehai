import { bus } from '../core/bus';
import { mmss } from '../core/format';
import { useTileSize } from '../core/TileSize';
import { useTopic } from '../core/useTopic';
import type { FlowCommand, SprintPayload } from '../core/payloads';
import type { WidgetProps } from '../core/types';
import { Awaiting, Pane } from './chrome';

function command(c: FlowCommand) {
  bus.publish<FlowCommand>('flow:command', 'widget.sprint', c);
}

/**
 * A break keeps its own colour, so the mode reads without the label. Focus is
 * plain: the accent is kept for something waiting on you.
 */
export function sprintColor(sprint: SprintPayload): string {
  return sprint.mode === 'focus' ? 'var(--cc-text)' : 'var(--cc-accent-2)';
}

export function sprintStatus(sprint: SprintPayload): string {
  if (sprint.state === 'paused') return 'Paused';
  if (sprint.state === 'idle') return 'Ready';
  return sprint.mode === 'focus' ? 'Focusing' : 'On break';
}

export function sprintLabel(sprint: SprintPayload): string {
  return sprint.mode === 'focus'
    ? `Sprint ${sprint.index} of ${sprint.total}`
    : `Break after ${sprint.index} of ${sprint.total}`;
}

export function focusedToday(sprint: SprintPayload): string {
  const hours = Math.floor(sprint.focusedTodaySec / 3600);
  const mins = Math.floor((sprint.focusedTodaySec % 3600) / 60);
  return `${hours}h ${mins}m`;
}

/**
 * Start or pause, skip, and reset. The timer lives in the engine, so these only
 * say what should happen; the countdown changes when the engine says it has.
 */
export function SprintControls({
  sprint,
  height = 28,
  compact = false,
}: {
  sprint: SprintPayload;
  height?: number;
  compact?: boolean;
}) {
  const running = sprint.state === 'running';
  // Nothing to go back to from the first block, untouched.
  const pristine = sprint.state === 'idle' && sprint.mode === 'focus' && sprint.index === 1;
  const chip = { height, padding: '0 14px' };

  return (
    <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
      <button className="cc-chip" style={chip} onClick={() => command({ action: running ? 'pause' : 'start' })}>
        {running ? 'Pause' : sprint.state === 'paused' ? 'Resume' : 'Start'}
      </button>
      {!compact && (
        <button
          className="cc-chip"
          style={chip}
          onClick={() => command({ action: 'skip' })}
          title={sprint.mode === 'focus' ? 'End this block and take the break' : 'End the break'}
        >
          Skip
        </button>
      )}
      {!compact && !pristine && (
        <button
          className="cc-chip"
          style={chip}
          onClick={() => command({ action: 'reset' })}
          title="Back to the first sprint. Today's total stays."
        >
          Reset
        </button>
      )}
    </div>
  );
}

export function Sprint(_: WidgetProps) {
  const size = useTileSize();
  const sprint = useTopic<SprintPayload>('flow:pomodoro');

  if (!sprint) {
    return (
      <Pane label="Focus timer">
        <Awaiting label="Focus sprint" />
      </Pane>
    );
  }

  // The numeral and the button that starts it are the widget. Everything
  // around them goes before they shrink.
  const showToday = size.h > 210;
  const showTrack = size.h > 160;
  const running = sprint.state === 'running';
  // Focus blocks the break follows are done; the one being focused on is not.
  const done = sprint.mode === 'break' ? sprint.index : sprint.index - 1;

  return (
    <Pane
      label="Focus timer"
      right={<span style={{ color: running && sprint.mode === 'break' ? sprintColor(sprint) : undefined }}>{sprintStatus(sprint)}</span>}
    >
      <span className="cc-label">{sprintLabel(sprint)}</span>
      <div style={{ flex: 1 }} />
      <span
        className="cc-display"
        style={{
          fontSize: `clamp(30px, ${Math.max(24, Math.round(size.h * 0.3))}px, 92px)`,
          lineHeight: 0.95,
          // A countdown that is not counting should not look like one that is.
          color: running ? sprintColor(sprint) : 'var(--cc-muted)',
        }}
      >
        {mmss(sprint.remainingSec)}
      </span>
      {showToday && (
        <span style={{ fontSize: 14, color: 'var(--cc-muted)', marginTop: 12 }}>
          {focusedToday(sprint)} focused today
        </span>
      )}
      <div style={{ marginTop: 16 }}>
        <SprintControls sprint={sprint} compact={size.w < 230} />
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', gap: 3, flex: 'none', visibility: showTrack ? 'visible' : 'hidden' }}>
        {Array.from({ length: sprint.total }, (_v, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: i < done ? 'var(--cc-muted)' : i === done && sprint.mode === 'focus' ? 'var(--cc-text)' : 'var(--cc-line)',
            }}
          />
        ))}
      </div>
    </Pane>
  );
}
