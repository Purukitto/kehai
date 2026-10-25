import { bytes, rate, sparkPath } from '../core/format';
import { useTileSize } from '../core/TileSize';
import { useHistory } from '../core/useHistory';
import { useTopic } from '../core/useTopic';
import type { CpuPayload, DiskPayload, MemPayload, NetPayload } from '../core/payloads';
import type { WidgetProps } from '../core/types';
import { Pane } from './chrome';

function threadColor(v: number): string {
  if (v > 82) return 'var(--cc-danger)';
  if (v > 40) return 'var(--cc-accent)';
  return 'var(--cc-line-2)';
}

function Section({ label, right, children }: { label: string; right?: string; children?: React.ReactNode }) {
  return (
    <div style={{ padding: '12px 14px', borderTop: '1px solid var(--cc-line)', flex: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span className="cc-label" style={{ fontSize: 9 }}>{label}</span>
        {right && (
          <span style={{ fontSize: 11, color: 'var(--cc-muted)', whiteSpace: 'nowrap' }}>{right}</span>
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

  const cpuHistory = useHistory(cpu?.pct);
  const rxHistory = useHistory(net?.rxBytesPerSec);
  const txHistory = useHistory(net?.txBytesPerSec);

  const cpuPath = sparkPath(cpuHistory, 436, 70);
  const netMax = Math.max(1, ...rxHistory, ...txHistory);
  const rxPath = sparkPath(rxHistory, 436, 64, netMax);
  const txPath = sparkPath(txHistory, 436, 64, netMax);

  const memPct = mem && mem.totalGib > 0 ? (mem.usedGib / mem.totalGib) * 100 : 0;

  // Sections drop from the bottom as the tile shrinks, in the order the spec
  // sheet set: disk first, then network, then the CPU history graph.
  const showDisk = size.h > 520;
  const showNet = size.h > 380;
  const showGraph = size.h > 270;

  return (
    <Pane label="MACHINE" padded={false}>
      <div style={{ padding: '12px 14px', flex: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <span className="cc-label" style={{ fontSize: 9 }}>
            CPU{cpu ? ` / ${cpu.threads.length}T` : ''}
          </span>
          <span style={{ fontSize: 11, color: 'var(--cc-muted)', whiteSpace: 'nowrap' }}>
            {cpu ? (
              <>
                <b style={{ color: 'var(--cc-accent)', fontWeight: 500 }}>{cpu.pct}%</b>
                {' '}
                {cpu.clockGhz.toFixed(2)}GHz{' '}
                <span style={{ color: cpu.tempC === null ? 'var(--cc-line-2)' : 'var(--cc-muted)' }}>
                  {cpu.tempC === null ? '--°C' : cpu.tempC.toFixed(0) + '°C'}
                </span>
              </>
            ) : (
              '--'
            )}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 46, marginTop: 9 }}>
          {(cpu?.threads ?? Array.from({ length: 16 }, () => 0)).map((v, i) => (
            <div key={i} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', background: 'var(--cc-inset)' }}>
              <div style={{ width: '100%', height: `${v}%`, background: threadColor(v) }} />
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
            <path d={cpuPath + ' L436 70 L0 70 Z'} fill="var(--cc-accent)" opacity="0.12" />
            <path d={cpuPath} fill="none" stroke="var(--cc-accent)" strokeWidth="1.3" />
          </svg>
        )}
      </div>

      <Section
        label="MEMORY"
        right={mem ? `${mem.usedGib.toFixed(1)} / ${mem.totalGib.toFixed(1)} GiB` : '--'}
      >
        <div style={{ display: 'flex', height: 12, marginTop: 9, border: '1px solid var(--cc-line)', background: 'var(--cc-inset)' }}>
          <div style={{ width: `${memPct}%`, background: 'var(--cc-accent)' }} />
        </div>
        {mem && mem.swapTotalGib > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            <span className="cc-mini">SWAP</span>
            <span className="cc-mini">
              {mem.swapUsedGib.toFixed(1)} / {mem.swapTotalGib.toFixed(1)} GiB
            </span>
          </div>
        )}
      </Section>

      {showNet && (
        <Section
          label="NETWORK"
          right={net ? `RX ${rate(net.rxBytesPerSec)}  TX ${rate(net.txBytesPerSec)}` : '--'}
        >
          {rxHistory.length > 1 ? (
            <svg
              width="100%"
              height="64"
              viewBox="0 0 436 64"
              preserveAspectRatio="none"
              style={{ marginTop: 9, display: 'block', borderBottom: '1px solid var(--cc-line)' }}
            >
              <path d={rxPath + ' L436 64 L0 64 Z'} fill="var(--cc-accent-2)" opacity="0.12" />
              <path d={rxPath} fill="none" stroke="var(--cc-accent-2)" strokeWidth="1.3" />
              <path d={txPath} fill="none" stroke="var(--cc-accent)" strokeWidth="1.3" strokeDasharray="3 2" />
            </svg>
          ) : (
            <div style={{ height: 64, display: 'flex', alignItems: 'center' }}>
              <span className="cc-mini">SAMPLING</span>
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
        <Section label="DISK" right={disk ? `${disk.volumes.length} VOLUMES` : '--'}>
          {(disk?.volumes ?? []).slice(0, 3).map((v) => {
            const pct = v.totalBytes > 0 ? (v.usedBytes / v.totalBytes) * 100 : 0;
            return (
              <div key={v.mount} style={{ marginTop: 9 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--cc-muted)', gap: 10 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.mount}</span>
                  <span style={{ color: 'var(--cc-text)', whiteSpace: 'nowrap' }}>
                    {bytes(v.usedBytes)} / {bytes(v.totalBytes)}
                  </span>
                </div>
                <div style={{ height: 5, background: 'var(--cc-inset)', marginTop: 4, border: '1px solid var(--cc-line)' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: pct > 90 ? 'var(--cc-danger)' : 'var(--cc-accent)' }} />
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
