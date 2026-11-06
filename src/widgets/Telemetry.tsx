import { bytes, rate, sparkPath } from '../core/format';
import { useTileSize } from '../core/TileSize';
import { useHistory } from '../core/useHistory';
import { useTopic } from '../core/useTopic';
import { gpuExtras, gpuHot, gpuModel, gpuTemp } from '../core/gpu';
import type { CpuPayload, DiskPayload, GpuPayload, MemPayload, NetPayload } from '../core/payloads';
import type { WidgetProps } from '../core/types';
import { Pane } from './chrome';

/** A thread is only worth a colour when it is pinned. */
function threadColor(v: number): string {
  if (v > 82) return 'var(--cc-danger)';
  if (v > 40) return 'var(--cc-muted)';
  return 'var(--cc-line-2)';
}

function Section({ label, right, children }: { label: string; right?: string; children?: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--cc-line)', flex: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span className="cc-label">{label}</span>
        {right && (
          <span style={{ fontSize: 13, color: 'var(--cc-text)', whiteSpace: 'nowrap' }}>{right}</span>
        )}
      </div>
      {children}
    </div>
  );
}

export function Telemetry(_: WidgetProps) {
  const size = useTileSize();
  const cpu = useTopic<CpuPayload>('telemetry:cpu');
  const mem = useTopic<MemPayload>('telemetry:mem');
  const net = useTopic<NetPayload>('telemetry:net');
  const disk = useTopic<DiskPayload>('telemetry:disk');
  const gpu = useTopic<GpuPayload>('telemetry:gpu');
  const card = gpu?.available ? gpu : null;

  const cpuHistory = useHistory(cpu?.pct);
  // The engine keeps a minute; until it has one, the line grows in from the right.
  const gpuW = card ? (436 * Math.max(1, card.history.length - 1)) / 59 : 436;
  const gpuPath = card ? sparkPath(card.history, Math.min(436, gpuW), 56, 100) : '';
  const gpuMemPct = card && card.memTotalGib > 0 ? (card.memUsedGib / card.memTotalGib) * 100 : 0;
  const rxHistory = useHistory(net?.rxBytesPerSec);
  const txHistory = useHistory(net?.txBytesPerSec);

  const cpuPath = sparkPath(cpuHistory, 436, 70);
  const netMax = Math.max(1, ...rxHistory, ...txHistory);
  const rxPath = sparkPath(rxHistory, 436, 64, netMax);
  const txPath = sparkPath(txHistory, 436, 64, netMax);

  const memPct = mem && mem.totalGib > 0 ? (mem.usedGib / mem.totalGib) * 100 : 0;

  // Sections drop from the bottom as the tile shrinks, in the order the spec
  // sheet set: disk first, then network, then the history graphs. A graphics
  // card takes its own section under the processor, so the rest drop sooner.
  const extra = card ? 130 : 0;
  const showDisk = size.h > 520 + extra;
  const showNet = size.h > 380 + extra;
  const showGraph = size.h > 270 + extra;

  return (
    <Pane label="Machine" padded={false}>
      <div style={{ padding: '8px 16px 12px', flex: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span className="cc-label">
            CPU{cpu ? ` · ${cpu.threads.length} threads` : ''}
          </span>
          <span style={{ fontSize: 13, color: 'var(--cc-muted)', whiteSpace: 'nowrap' }}>
            {cpu ? (
              <>
                <b style={{ color: 'var(--cc-text)', fontWeight: 500 }}>{cpu.pct}%</b>
                {' · '}
                {cpu.clockGhz.toFixed(2)} GHz{' · '}
                <span style={{ color: cpu.tempC === null ? 'var(--cc-dim)' : 'var(--cc-muted)' }}>
                  {cpu.tempC === null ? '--°C' : cpu.tempC.toFixed(0) + '°C'}
                </span>
              </>
            ) : (
              '--'
            )}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 44, marginTop: 8 }}>
          {(cpu?.threads ?? Array.from({ length: 16 }, () => 0)).map((v, i) => (
            <div key={i} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', background: 'var(--cc-inset)', borderRadius: 1 }}>
              <div style={{ width: '100%', height: `${v}%`, background: threadColor(v), borderRadius: 1 }} />
            </div>
          ))}
        </div>

        {showGraph && cpuHistory.length > 1 && (
          <svg
            width="100%"
            height="70"
            viewBox="0 0 436 70"
            preserveAspectRatio="none"
            style={{ marginTop: 10, display: 'block', borderBottom: '1px solid var(--cc-line)' }}
          >
            <path d="M0 35h436" stroke="var(--cc-line)" strokeWidth="1" strokeDasharray="2 5" />
            <path d={cpuPath + ' L436 70 L0 70 Z'} fill="var(--cc-muted)" opacity="0.1" />
            <path d={cpuPath} fill="none" stroke="var(--cc-muted)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </div>

      {card && (
        <Section label={'Graphics · ' + gpuModel(card.name)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--cc-muted)', whiteSpace: 'nowrap' }}>
              <b style={{ color: 'var(--cc-text)', fontWeight: 500 }}>{card.pct}%</b>
              {' · '}
              <span style={{ color: gpuHot(card) ? 'var(--cc-danger)' : card.tempC === null ? 'var(--cc-dim)' : 'var(--cc-muted)' }}>
                {gpuTemp(card)}
              </span>
            </span>
            <span className="cc-mini" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {gpuExtras(card)}
            </span>
          </div>
          {showGraph && gpuPath && (
            <svg
              width="100%"
              height="56"
              viewBox="0 0 436 56"
              preserveAspectRatio="none"
              style={{ marginTop: 8, display: 'block', borderBottom: '1px solid var(--cc-line)' }}
            >
              <g transform={`translate(${436 - Math.min(436, gpuW)} 0)`}>
                <path d={gpuPath + ` L${Math.min(436, gpuW)} 56 L0 56 Z`} fill="var(--cc-muted)" opacity="0.1" />
                <path d={gpuPath} fill="none" stroke="var(--cc-muted)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
              </g>
            </svg>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            <span className="cc-mini">Memory</span>
            <span className="cc-mini">
              {card.memUsedGib.toFixed(1)} of {card.memTotalGib.toFixed(1)} GiB
            </span>
          </div>
          <div style={{ display: 'flex', height: 4, marginTop: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--cc-line)' }}>
            <div style={{ width: `${gpuMemPct}%`, background: 'var(--cc-muted)' }} />
          </div>
        </Section>
      )}

      <Section
        label="Memory"
        right={mem ? `${mem.usedGib.toFixed(1)} of ${mem.totalGib.toFixed(1)} GiB` : '--'}
      >
        <div style={{ display: 'flex', height: 4, marginTop: 8, borderRadius: 2, overflow: 'hidden', background: 'var(--cc-line)' }}>
          <div style={{ width: `${memPct}%`, background: 'var(--cc-muted)' }} />
        </div>
        {mem && mem.swapTotalGib > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            <span className="cc-mini">Swap</span>
            <span className="cc-mini">
              {mem.swapUsedGib.toFixed(1)} / {mem.swapTotalGib.toFixed(1)} GiB
            </span>
          </div>
        )}
      </Section>

      {showNet && (
        <Section
          label="Network"
          right={net ? `↓ ${rate(net.rxBytesPerSec)}   ↑ ${rate(net.txBytesPerSec)}` : '--'}
        >
          {rxHistory.length > 1 ? (
            <svg
              width="100%"
              height="64"
              viewBox="0 0 436 64"
              preserveAspectRatio="none"
              style={{ marginTop: 9, display: 'block', borderBottom: '1px solid var(--cc-line)' }}
            >
              <path d={rxPath + ' L436 64 L0 64 Z'} fill="var(--cc-muted)" opacity="0.1" />
              <path d={rxPath} fill="none" stroke="var(--cc-muted)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
              <path d={txPath} fill="none" stroke="var(--cc-dim)" strokeWidth="1.25" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
            </svg>
          ) : (
            <div style={{ height: 64, display: 'flex', alignItems: 'center' }}>
              <span className="cc-mini">Measuring</span>
            </div>
          )}
          {net?.active[0] && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7 }}>
              <span className="cc-mini" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {net.active[0].name}
              </span>
              <span className="cc-mini">{rate(net.active[0].rxBytesPerSec + net.active[0].txBytesPerSec)}</span>
            </div>
          )}
        </Section>
      )}

      {showDisk && (
        <Section label="Disks" right={disk ? `${disk.volumes.length} volume${disk.volumes.length === 1 ? '' : 's'}` : '--'}>
          {(disk?.volumes ?? []).slice(0, 3).map((v) => {
            const pct = v.totalBytes > 0 ? (v.usedBytes / v.totalBytes) * 100 : 0;
            return (
              <div key={v.mount} style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--cc-muted)', gap: 8 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.mount}</span>
                  <span style={{ color: 'var(--cc-text)', whiteSpace: 'nowrap' }}>
                    {bytes(v.usedBytes)} / {bytes(v.totalBytes)}
                  </span>
                </div>
                <div style={{ height: 4, background: 'var(--cc-line)', marginTop: 4, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: pct > 90 ? 'var(--cc-danger)' : 'var(--cc-muted)' }} />
                </div>
              </div>
            );
          })}
        </Section>
      )}

      <div style={{ flex: 1 }} />
    </Pane>
  );
}
