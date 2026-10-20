import { useTileSize } from '../core/TileSize';
import { useBreakpoint } from '../core/useBreakpoint';
import { useTopic } from '../core/useTopic';
import { rate } from '../core/format';
import type { CpuPayload, MemPayload, NetPayload } from '../core/payloads';
import type { WidgetProps, WidgetSpec } from '../core/types';

/** Below this the rows lay out along one line instead of stacking. */
const ROW_BELOW = 110;

function Vitals({ props }: WidgetProps) {
  const size = useTileSize();
  const cpu = useTopic<CpuPayload>('telemetry:cpu');
  const mem = useTopic<MemPayload>('telemetry:mem');
  const net = useTopic<NetPayload>('telemetry:net');
  const show = (props.show as string[] | undefined) ?? ['cpu', 'mem', 'unread'];

  const inline = useBreakpoint(size.h, ROW_BELOW);

  const values: Record<string, string> = {
    cpu: cpu ? cpu.pct + '%' : '--',
    mem: mem ? mem.usedGib.toFixed(1) + 'G' : '--',
    net: net ? rate(net.rxBytesPerSec) : '--',
    unread: '3',
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
              color: key === 'unread' ? 'var(--cc-accent-2)' : 'var(--cc-muted)',
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
  min: [2, 1],
  topics: ['telemetry:cpu', 'telemetry:mem', 'telemetry:net'],
  component: Vitals,
};
