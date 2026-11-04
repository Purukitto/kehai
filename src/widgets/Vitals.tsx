import { useTileSize } from '../core/TileSize';
import { useBreakpoint } from '../core/useBreakpoint';
import { useTopic } from '../core/useTopic';
import { rate } from '../core/format';
import type { AgentsPayload, CpuPayload, MemPayload, NetPayload, NotifyPayload } from '../core/payloads';
import type { WidgetProps } from '../core/types';
import { agentSummary, waitingOnYou } from './Agents';

/** Below this the rows lay out along one line instead of stacking. */
const ROW_BELOW = 110;

const NAMES: Record<string, string> = { cpu: 'CPU', mem: 'Memory', net: 'Network', unread: 'Unread', agents: 'Agents' };

export function Vitals({ props }: WidgetProps) {
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
  const unread = !notify ? '--' : counting ? String(notify.items.length) : 'Off';

  const values: Record<string, string> = {
    cpu: cpu ? cpu.pct + '%' : '--',
    mem: mem ? mem.usedGib.toFixed(1) + 'G' : '--',
    net: net ? rate(net.rxBytesPerSec) : '--',
    unread,
    agents: !agents ? '--' : agents.available ? agentSummary(agents).text : 'Off',
  };

  // Only an agent waiting on you is lit: everything else here is just a value.
  const lit: Record<string, boolean> = {
    agents: agents?.available === true && waitingOnYou(agents) > 0,
  };

  return (
    <div
      style={{
        flex: 1,
        background: 'var(--cc-pane)',
        padding: inline ? '0 16px' : 16,
        display: 'flex',
        flexDirection: inline ? 'row' : 'column',
        alignItems: 'center',
        justifyContent: inline ? 'flex-start' : 'center',
        gap: inline ? 24 : 8,
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
          <span className="cc-label">{NAMES[key] ?? key}</span>
          <span
            className="cc-display"
            style={{
              fontSize: inline ? 17 : 22,
              whiteSpace: 'nowrap',
              color: lit[key] ? 'var(--cc-accent)' : 'var(--cc-text)',
            }}
          >
            {values[key] ?? '--'}
          </span>
        </div>
      ))}
    </div>
  );
}
