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

const PAD = 16;
const GAP = 8;
/** A value's line, as a share of its size. */
const LINE = 1.15;
/** How wide a figure is, as a share of the size: the face is fixed-width. */
const ADVANCE = 0.6;
/** Room kept beside a value for its label, in one column, and above it in two. */
const LABEL_W = 84;
const LABEL_H = 18;

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

  // Stacked, the tile picks whichever arrangement gives the values the most
  // room and still fits them: one column with each label beside its value, or
  // two with each label above. Values are as big as the height and width
  // allow, never so big a row runs off the tile.
  const n = Math.max(1, show.length);
  const innerW = size.w - PAD * 2;
  const innerH = size.h - PAD * 2;
  const chars = Math.max(3, ...show.map((k) => (values[k] ?? '--').length));
  const listRow = (innerH - GAP * (n - 1)) / n;
  const listSize = Math.min(48, listRow / LINE, (innerW - LABEL_W) / (chars * ADVANCE));
  const gridRows = Math.ceil(n / 2);
  const gridRow = (innerH - GAP * (gridRows - 1)) / gridRows;
  const gridSize = n > 1 ? Math.min(44, (gridRow - LABEL_H) / LINE, (innerW - GAP * 2) / 2 / (chars * ADVANCE)) : 0;
  const grid = gridSize > listSize * 1.15;
  const valueSize = Math.floor(inline ? Math.max(17, Math.min(30, size.h * 0.28)) : Math.max(13, grid ? gridSize : listSize));

  const value = (key: string) => (
    <span
      className="cc-display"
      style={{
        fontSize: valueSize,
        lineHeight: LINE,
        whiteSpace: 'nowrap',
        color: lit[key] ? 'var(--cc-accent)' : 'var(--cc-text)',
      }}
    >
      {values[key] ?? '--'}
    </span>
  );

  if (!inline && grid) {
    return (
      <div
        style={{
          flex: 1,
          background: 'var(--cc-pane)',
          padding: PAD,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          alignContent: 'center',
          gap: `${GAP}px ${GAP * 2}px`,
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {show.map((key) => (
          <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span className="cc-label">{NAMES[key] ?? key}</span>
            {value(key)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        background: 'var(--cc-pane)',
        padding: inline ? `0 ${PAD}px` : PAD,
        display: 'flex',
        flexDirection: inline ? 'row' : 'column',
        alignItems: 'center',
        justifyContent: inline ? 'flex-start' : 'center',
        gap: inline ? 24 : GAP,
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
          {value(key)}
        </div>
      ))}
    </div>
  );
}
