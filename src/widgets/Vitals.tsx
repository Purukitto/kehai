import { useTileSize } from '../core/TileSize';
import { useBreakpoint } from '../core/useBreakpoint';
import { useTopic } from '../core/useTopic';
import { rate } from '../core/format';
import type { AgentsPayload, CpuPayload, MemPayload, NetPayload, NotifyPayload } from '../core/payloads';
import type { WidgetProps, WidgetSpec } from '../core/types';
import { agentSummary, waitingOnYou } from './Agents';

/** Below this the rows lay out along one line instead of stacking. */
const ROW_BELOW = 110;

function Vitals({ props }: WidgetProps) {
  const size = useTileSize();
  const cpu = useTopic<CpuPayload>('telemetry:cpu');
  const mem = useTopic<MemPayload>('telemetry:mem');
  const net = useTopic<NetPayload>('telemetry:net');
  const notify = useTopic<NotifyPayload>('sys:notify');
  const agents = useTopic<AgentsPayload>('dev:agents');
  const show = (props.show as string[] | undefined) ?? ['cpu', 'mem', 'unread'];

  const inline = useBreakpoint(size.h, ROW_BELOW);

  // Toasts in the tray. A refused listener is stated rather than shown as
  // zero: an empty tray and an unreadable one are different facts.
  const counting = notify?.available === true;
  const unread = !notify ? '--' : counting ? String(notify.items.length) : 'N/A';

  const values: Record<string, string> = {
    cpu: cpu ? cpu.pct + '%' : '--',
    mem: mem ? mem.usedGib.toFixed(1) + 'G' : '--',
    net: net ? rate(net.rxBytesPerSec) : '--',
    unread,
    agents: !agents ? '--' : agents.available ? agentSummary(agents).text : 'N/A',
  };

  const lit: Record<string, boolean> = {
    unread: counting,
    agents: agents?.available === true && waitingOnYou(agents) > 0,
  };

  return (
    <div
      style={{
        flex: 1,
        background: 'var(--cc-pane)',
        padding: inline ? '0 20px' : 20,
        display: 'flex',
        flexDirection: inline ? 'row' : 'column',
        alignItems: 'center',
        justifyContent: inline ? 'flex-start' : 'center',
        gap: inline ? 26 : 10,
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {show.map((key) => (
        <div
          key={key}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: inline ? 'flex-start' : 'space-between',
            gap: inline ? 8 : 12,
            width: inline ? 'auto' : '100%',
            flex: 'none',
            minWidth: 0,
          }}
        >
          <span className="cc-mini" style={{ letterSpacing: '0.16em' }}>
            {key.toUpperCase()}
          </span>
          <span
            style={{
              fontSize: inline ? 15 : 18,
              whiteSpace: 'nowrap',
              color: !lit[key]
                ? 'var(--cc-muted)'
                : key === 'agents'
                  ? 'var(--cc-accent)'
                  : 'var(--cc-accent-2)',
            }}
          >
            {values[key] ?? '--'}
          </span>
        </div>
      ))}
    </div>
  );
}

export const vitalsSpec: WidgetSpec = {
  title: 'Status strip',
  about: 'A line of small readings: processor, memory, network, unread, agents.',
  min: [2, 1],
  topics: ['telemetry:cpu', 'telemetry:mem', 'telemetry:net', 'sys:notify', 'dev:agents'],
  component: Vitals,
};
