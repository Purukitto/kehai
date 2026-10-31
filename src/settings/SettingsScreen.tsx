import { useEffect, useState } from 'react';
import { DisplayMap, displayLabel } from '../components/DisplayMap';
import { OptionsSheet } from '../components/OptionsSheet';
import { QrCode } from '../components/QrCode';
import { bus } from '../core/bus';
import type {
  DisplayCommand,
  DisplaysPayload,
  NotifyCommand,
  NotifyPayload,
  PresencePayload,
  RemoteCommand,
  RemotePayload,
  UpdateCommand,
  UpdatePayload,
} from '../core/payloads';
import { REMOTE_PANEL, forgetRemote } from '../core/remoteSource';
import { LAYOUT_FORMAT, SHAPE_ASPECT, placeTile, withTiles } from '../core/layout';
import { PRESETS, PRESET_ORDER, findLayout, isPreset, useSettings } from '../core/settings';
import type { DimLevel, FocusSettings, QuietShow, RemoteSettings } from '../core/settings';
import { DIM_NAME, hhmm, previewDim } from '../core/night';
import { SOURCES, SOURCE_IDS } from '../core/sources';
import type { SourceId } from '../core/sources';
import { useTopic } from '../core/useTopic';
import { useWindowShape } from '../core/useWindowShape';
import type { Layout, Shape, ThemeId, WidgetSpec } from '../core/types';
import { minSize, registry, widgetNames } from '../widgets/registry';
import { Group, Row, Seg } from './controls';

const NAV = ['LAYOUT', 'WIDGETS', 'APPEARANCE', 'WINDOW', 'SOURCES', 'REMOTE', 'ABOUT'] as const;
export type Section = (typeof NAV)[number];

const NAV_ICON: Record<Section, string> = {
  LAYOUT: 'M2 2h5v5H2ZM9 2h5v5H9ZM2 9h5v5H2ZM9 9h5v5H9Z',
  WIDGETS: 'M8 1.6 14 5v6l-6 3.4L2 11V5Z',
  APPEARANCE:
    'M8 1.8a6.2 6.2 0 1 0 0 12.4c1 0 1.4-.7 1.4-1.3 0-1.2-1.2-1.3-1.2-2.2 0-.6.5-1 1.2-1h1.2A3.6 3.6 0 0 0 14.2 6c0-2.4-2.6-4.2-6.2-4.2',
  SOURCES:
    'M2.5 4.4c0-1.2 2.5-2.2 5.5-2.2s5.5 1 5.5 2.2-2.5 2.2-5.5 2.2-5.5-1-5.5-2.2M2.5 4.4v7.2c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V4.4M2.5 8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2',
  WINDOW: 'M1.8 3.2h12.4v9.6H1.8zM1.8 6h12.4',
  REMOTE: 'M1.8 2.6h12.4v8.6H1.8zM5.4 13.8h5.2M8 11.2v2.6',
  ABOUT: 'M8 1.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 1 0 0-12.4M8 7.2v4M8 4.9v.1',
};

/**
 * Autostart lives behind the OS, not in our settings file, so the toggle has to
 * read the real state rather than assume it. Unavailable outside Tauri.
 */
export function useAutostart(): [boolean | null, (on: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('@tauri-apps/plugin-autostart')
      .then(({ isEnabled }) => isEnabled())
      .then((on) => {
        if (!cancelled) setEnabled(on);
      })
      .catch(() => {
        if (!cancelled) setEnabled(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (on: boolean) => {
    void import('@tauri-apps/plugin-autostart')
      .then(async ({ enable, disable, isEnabled }) => {
        if (on) await enable();
        else await disable();
        setEnabled(await isEnabled());
      })
      .catch(() => setEnabled(null));
  };

  return [enabled, set];
}

export const THEMES: { id: ThemeId; name: string; swatch: string[] }[] = [
  { id: 'amber', name: 'AMBER', swatch: ['#161512', '#f0a83c', '#3fc6dc', '#e9e5dc'] },
  { id: 'phosphor', name: 'PHOSPHOR', swatch: ['#0a100b', '#6cf58a', '#c8ff8f', '#a9f5b4'] },
  { id: 'ice', name: 'ICE', swatch: ['#121820', '#56cfe1', '#9d8cff', '#dce6f2'] },
];

/**
 * A layout as it looks on the display Kehai is on. In use is marked in the
 * accent; selected, which only decides what the buttons below act on, in the
 * second accent, so picking a card never changes the screen by itself.
 */
function LayoutCard({
  layout,
  shape,
  inUse,
  selected,
  onSelect,
}: {
  layout: Layout;
  shape: Shape;
  inUse: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { grid, tiles } = layout.shapes[shape];
  const aspect = SHAPE_ASPECT[shape];
  const width = Math.min(176, 76 * aspect);
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      style={{
        background: 'var(--cc-pane)',
        border: `1px solid ${inUse ? 'var(--cc-accent)' : selected ? 'var(--cc-accent-2)' : 'var(--cc-line)'}`,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        minWidth: 0,
      }}
    >
      <div
        style={{
          height: 88,
          width: '100%',
          background: 'var(--cc-inset)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width,
            height: width / aspect,
            display: 'grid',
            gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
            gap: 2,
          }}
        >
          {tiles.map((t, i) => (
            <div
              key={i}
              style={{
                gridArea: `${t.area[0]} / ${t.area[1]} / ${t.area[2]} / ${t.area[3]}`,
                background: inUse ? 'var(--cc-accent)' : 'var(--cc-line-2)',
              }}
            />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, width: '100%', minWidth: 0 }}>
        <span
          style={{
            fontSize: 10,
            letterSpacing: '0.14em',
            color: inUse ? 'var(--cc-accent)' : selected ? 'var(--cc-accent-2)' : 'var(--cc-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {layout.name.toUpperCase()}
        </span>
        <div style={{ flex: 1 }} />
        <span className="cc-mini" style={{ fontSize: 9, flex: 'none' }}>
          {inUse ? 'IN USE' : `${tiles.length} TILES`}
        </span>
      </div>
    </button>
  );
}

/** Rows of cards that wrap rather than squeeze, however many layouts there are. */
const CARD_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: 12,
  marginTop: 10,
};

function SourceRow({ label, topic, desc }: { label: string; topic: string; desc: string }) {
  const value = useTopic<{ available?: boolean; reason?: string | null } | null>(topic);
  // A payload that says it cannot report is not a live source. Counting any
  // payload as live showed a refused notification listener as reporting.
  const refused = value?.available === false;
  const live = value !== undefined && value !== null && !refused;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 0',
        borderBottom: '1px solid var(--cc-line)',
      }}
    >
      <span style={{ width: 6, height: 6, flex: 'none', background: live ? 'var(--cc-ok)' : 'var(--cc-line-2)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12 }}>{label}</div>
        <div className="cc-mini" style={{ marginTop: 4 }}>
          {refused && value?.reason ? value.reason : desc}
        </div>
      </div>
      <span className="cc-mini" style={{ flex: 'none' }}>
        {live ? 'REPORTING' : refused ? 'UNAVAILABLE' : 'SILENT'}
      </span>
    </div>
  );
}

interface SourceState {
  live: boolean;
  refused: boolean;
  /** Notifications waiting for Allow, which is a refusal nobody has made yet. */
  pending: boolean;
  reason: string | null;
}

/** Whether each source is reporting, judged the way SourceRow judges it. */
function useSourceStates(): Record<SourceId, SourceState> {
  const states = {} as Record<SourceId, SourceState>;
  // SOURCE_IDS never changes, so these hooks run in the same order every render.
  for (const id of SOURCE_IDS) {
    const value = useTopic<{ available?: boolean; pending?: boolean; reason?: string | null } | null>(SOURCES[id].topics[0]);
    const refused = value?.available === false;
    states[id] = {
      live: value !== undefined && value !== null && !refused,
      refused,
      pending: value?.pending === true,
      reason: refused ? (value?.reason ?? null) : null,
    };
  }
  return states;
}

/**
 * One widget under Installed: what it shows and what it reads. It is reporting
 * while any of its sources is, so the main readout with no agent transcripts
 * still counts, as the machine half of it does report.
 */
function WidgetRow({
  widget,
  sources,
  onOptions,
}: {
  widget: WidgetSpec;
  sources: Record<SourceId, SourceState>;
  /** Opens its options, for a widget that has any. */
  onOptions?: () => void;
}) {
  const states = widget.sources.map((s) => sources[s]);
  const live = states.some((s) => s.live);
  const blocked = !live && states.every((s) => s.refused);
  const first = states[0];
  const status = live ? 'REPORTING' : blocked ? (first.pending ? 'NOT ALLOWED YET' : 'UNAVAILABLE') : 'SILENT';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 0',
        borderBottom: '1px solid var(--cc-line)',
      }}
    >
      <span style={{ width: 6, height: 6, flex: 'none', background: live ? 'var(--cc-ok)' : 'var(--cc-line-2)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12 }}>{widget.name}</div>
        <div className="cc-mini" style={{ marginTop: 4, lineHeight: 1.5 }}>
          {!blocked ? widget.about : first.pending ? 'Not read until you allow it under Sources.' : (first.reason ?? widget.about)}
        </div>
        <div className="cc-mini" style={{ marginTop: 4, letterSpacing: '0.12em' }}>
          READS {widget.sources.map((s) => SOURCES[s].name.toUpperCase()).join(' · ')}
        </div>
      </div>
      <span className="cc-mini" style={{ flex: 'none' }}>
        {status}
      </span>
      {/* A remote panel's options would be the browser's, not the host's. */}
      {!REMOTE_PANEL && (
        <span style={{ width: 96, flex: 'none', display: 'flex', justifyContent: 'flex-end' }}>
          {onOptions ? (
            <button className="cc-chip" style={{ padding: '7px 13px' }} onClick={onOptions}>
              OPTIONS
            </button>
          ) : (
            <span className="cc-mini">NONE</span>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * Notifications are the one source that waits for a go-ahead, so its row can
 * give one, or ask again once a refusal has been put right in the system.
 */
function NotifyRow() {
  const { allowNotifications } = useSettings();
  const value = useTopic<NotifyPayload>('sys:notify');
  const pending = value?.pending === true;
  const refused = value?.available === false && !pending;
  const live = value?.available === true;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 0',
        borderBottom: '1px solid var(--cc-line)',
      }}
    >
      <span style={{ width: 6, height: 6, flex: 'none', background: live ? 'var(--cc-ok)' : 'var(--cc-line-2)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12 }}>Notifications</div>
        <div className="cc-mini" style={{ marginTop: 4, lineHeight: 1.5 }}>
          {pending
            ? 'Not read until you allow it. Kehai then reads the title and text of each one, and keeps none of them.'
            : refused && value?.reason
              ? value.reason
              : 'Intercepted from the system tray.'}
        </div>
      </div>
      {pending && !REMOTE_PANEL ? (
        <button className="cc-chip cc-chip-on" style={{ padding: '7px 16px' }} onClick={allowNotifications}>
          ALLOW
        </button>
      ) : refused && !REMOTE_PANEL ? (
        <button
          className="cc-chip"
          style={{ padding: '7px 13px' }}
          onClick={() => bus.publish<NotifyCommand>('notify:command', 'settings', { action: 'listen' })}
        >
          CHECK AGAIN
        </button>
      ) : (
        <span className="cc-mini" style={{ flex: 'none' }}>
          {live ? 'REPORTING' : pending ? 'NOT ALLOWED YET' : refused ? 'UNAVAILABLE' : 'SILENT'}
        </span>
      )}
    </div>
  );
}

/**
 * The display Kehai is for, chosen on a map of them. Tapping one moves Kehai
 * there at once, as setup does.
 */
function DisplayRows({ state }: { state: DisplaysPayload }) {
  const show = (id: string, fill: boolean) =>
    bus.publish<DisplayCommand>('display:command', 'settings', { action: 'show', id, fill });
  const chosen = state.displays.find((d) => d.id === state.chosen);
  const target = state.chosen ?? state.current;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
        <span className="cc-label">DISPLAY</span>
        <span className="cc-mini">
          {state.missing
            ? `${displayLabel({ name: state.chosenName, number: state.chosenNumber })} is not connected, so Kehai is in a window on the main display until it is.`
            : chosen
              ? `Kehai is on ${chosen.number} · ${displayLabel(chosen)}. Choose another and it moves there.`
              : 'Choose a display and Kehai moves there.'}
        </span>
      </div>
      <DisplayMap
        displays={state.displays}
        chosen={state.chosen}
        current={state.current}
        filled={state.fill && !state.missing}
        height={250}
        onPick={(id) => show(id, state.fill)}
      />
      <div style={{ height: 14 }} />
      <Row label="Fill the display" desc="Fullscreen, with no window edge. F11 switches it at any time.">
        <Seg
          options={['OFF', 'ON']}
          value={state.fill ? 'ON' : 'OFF'}
          onPick={(v) => {
            if (target) show(target, v === 'ON');
          }}
        />
      </Row>
      <Row
        label="When the display is missing"
        desc="Kehai opens in a window on the main display, says so in the header, and moves back once the display returns."
      >
        <span className="cc-mini" style={{ flex: 'none' }}>ALWAYS</span>
      </Row>
    </>
  );
}

/**
 * Committed on Enter or when focus leaves, not per keystroke: each commit makes
 * the engine re-read the folder, and a half-typed path is a folder that does
 * not exist. Whether the folder worked shows on the two agent rows above.
 */
export function TranscriptRootRow({ value, onCommit }: { value: string | null; onCommit: (path: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => setDraft(value ?? ''), [value]);

  const commit = () => {
    const next = draft.trim() === '' ? null : draft.trim();
    if (next !== value) onCommit(next);
  };

  // Laid out as a SourceRow with no dot, so it reads as part of the agent rows
  // above, which both read this folder, rather than as a separate source.
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 0',
        borderBottom: '1px solid var(--cc-line)',
      }}
    >
      <span style={{ width: 6, flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12 }}>Transcript folder</div>
        <div className="cc-mini" style={{ marginTop: 4, lineHeight: 1.5 }}>
          One subfolder per project, each holding .jsonl transcripts. Blank uses ~/.claude/projects.
        </div>
      </div>
      <div style={{ display: 'flex', flex: 'none' }}>
        <input
          className="cc-field"
          style={{ width: 280 }}
          value={draft}
          placeholder="~/.claude/projects"
          spellCheck={false}
          aria-label="Transcript folder"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setDraft(value ?? '');
          }}
        />
        <button
          className={value === null ? 'cc-chip cc-chip-on' : 'cc-chip'}
          style={{ padding: '7px 13px', marginLeft: -1 }}
          onClick={() => onCommit(null)}
          title="Read from the default location"
        >
          DEFAULT
        </button>
      </div>
    </div>
  );
}

/** A setting that belongs to the source row above it, so it carries no dot. */
function SubRow({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 0',
        borderBottom: '1px solid var(--cc-line)',
      }}
    >
      <span style={{ width: 6, flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12 }}>{label}</div>
        <div className="cc-mini" style={{ marginTop: 4, lineHeight: 1.5 }}>
          {desc}
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * Offered as a few lengths rather than a free field: a panel read from across
 * a desk is set up once, and every option here is one tap.
 */
function FocusRows({ focus, onChange }: { focus: FocusSettings; onChange: (next: Partial<FocusSettings>) => void }) {
  return (
    <>
      <SubRow label="Focus block" desc="A changed length applies from the next block, not the one counting down.">
        <Seg options={[15, 25, 45, 50, 90]} value={focus.focusMin} format={(v) => `${v}M`} onPick={(focusMin) => onChange({ focusMin })} />
      </SubRow>
      <SubRow label="Break" desc="Starts by itself when a focus block runs out. The next block waits for you.">
        <Seg options={[5, 10, 15]} value={focus.breakMin} format={(v) => `${v}M`} onPick={(breakMin) => onChange({ breakMin })} />
      </SubRow>
      <SubRow label="Sprints per round" desc="How many blocks the track shows before it starts again.">
        <Seg options={[2, 3, 4, 6, 8]} value={focus.sprints} onPick={(sprints) => onChange({ sprints })} />
      </SubRow>
    </>
  );
}

const WINDOWS = typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent);

/** Half an hour a tap, round the clock. */
function TimeStep({ value, onChange, label }: { value: number; onChange: (min: number) => void; label: string }) {
  const step = (by: number) => onChange((value + by + 24 * 60) % (24 * 60));
  const button = { width: 32, height: 32, padding: 0, fontSize: 14 };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
      <button className="cc-chip" style={button} onClick={() => step(-30)} aria-label={`${label} earlier`}>
        −
      </button>
      <span style={{ fontSize: 15, width: 62, textAlign: 'center' }}>{hhmm(value)}</span>
      <button className="cc-chip" style={button} onClick={() => step(30)} aria-label={`${label} later`}>
        +
      </button>
    </div>
  );
}

const SHOW_NAME: Record<QuietShow, string> = { clock: 'CLOCK', panel: 'DIMMED PANEL', nothing: 'NOTHING' };
const SHOW_DESC: Record<QuietShow, string> = {
  clock: 'The time, and only what is running or waiting on you. Notifications as a count.',
  panel: 'The whole panel, dimmed to half, with what notifications say hidden.',
  nothing: 'Dark, until an agent waits on you.',
};

/**
 * What the panel does while it is not being read: at night, and while nobody
 * is at the desk. Away belongs to the machine Kehai runs on, so a remote panel
 * only has the night, by its own clock.
 */
function QuietRows() {
  const { settings, setNight, setAway } = useSettings();
  const presence = useTopic<PresencePayload>('os:presence');
  const { night, away } = settings;
  // Never is stored as null; Seg wants a value it can compare.
  const after = [...new Set([0, 5, 10, 30, away.afterMin ?? 0])].sort((a, b) => a - b);

  return (
    <>
      <Group label="AT NIGHT" note={REMOTE_PANEL ? 'By this device’s clock.' : 'By this panel’s clock.'} />
      <Row label="Dim at night" desc="Everything Kehai draws turns down between these times.">
        <Seg options={['OFF', 'ON']} value={night.on ? 'ON' : 'OFF'} onPick={(v) => setNight({ on: v === 'ON' })} />
      </Row>
      <Row label="Between" desc="Fixed hours. Sunset would need your location, and Kehai asks for none.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 'none' }}>
          <TimeStep label="Start" value={night.fromMin} onChange={(fromMin) => setNight({ fromMin })} />
          <span className="cc-mini">TO</span>
          <TimeStep label="End" value={night.toMin} onChange={(toMin) => setNight({ toMin })} />
        </div>
      </Row>
      <Row label="How dim" desc="Shown for a few seconds as you pick. A backlit panel only goes so far: black stays as bright as its backlight.">
        <Seg
          options={['little', 'half', 'lot'] as DimLevel[]}
          value={night.level}
          format={(v) => DIM_NAME[v]}
          onPick={(level) => {
            setNight({ level });
            previewDim(level);
          }}
        />
      </Row>

      {!REMOTE_PANEL && (
        <>
          <Group label="WHEN YOU’RE AWAY" note="No keyboard, mouse or touch on this computer." />
          {presence && !presence.available ? (
            <Row label="Not available here" desc={presence.reason ?? 'This system does not say when you are away.'} />
          ) : (
            <>
              <Row label="Quiet the panel after" desc="A touch or a nudge of the mouse brings it back. The first tap only wakes it.">
                <Seg
                  options={after}
                  value={away.afterMin ?? 0}
                  format={(v) => (v === 0 ? 'NEVER' : `${v} MIN`)}
                  onPick={(v) => setAway({ afterMin: v === 0 ? null : v })}
                />
              </Row>
              <Row label="While it’s quiet, show" desc={SHOW_DESC[away.show]}>
                <Seg
                  options={['clock', 'panel', 'nothing'] as QuietShow[]}
                  value={away.show}
                  format={(v) => SHOW_NAME[v]}
                  onPick={(show) => setAway({ show })}
                />
              </Row>
            </>
          )}
          <div className="cc-mini" style={{ marginTop: 12, lineHeight: 1.6 }}>
            While {WINDOWS ? 'Windows' : 'the system'} is locked, its lock screen covers every display, so nothing of Kehai shows. Kehai
            stops drawing until you are back.
          </div>
        </>
      )}
    </>
  );
}

function sendRemote(command: RemoteCommand) {
  bus.publish<RemoteCommand>('remote:command', 'settings', command);
}

/** Committed like the transcript folder: on Enter or blur, and only when valid. */
function PortField({ value, onCommit }: { value: number; onCommit: (port: number) => void }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const port = Number(draft.trim());
    if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
      if (port !== value) onCommit(port);
    } else {
      setDraft(String(value));
    }
  };

  return (
    <input
      className="cc-field"
      style={{ width: 96, flex: 'none', textAlign: 'right' }}
      value={draft}
      inputMode="numeric"
      spellCheck={false}
      aria-label="Port"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(String(value));
      }}
    />
  );
}

/** Shown without its key, which is the part that grants access. */
function masked(link: string): string {
  return link.replace(/key=[0-9a-f]+/i, 'key=••••••••');
}

function remoteStatus(status: RemotePayload | undefined): { text: string; color: string } {
  if (!status) return { text: 'Awaiting the engine.', color: 'var(--cc-line-2)' };
  if (status.error) return { text: status.error, color: 'var(--cc-danger)' };
  if (!status.on) return { text: 'Not serving. Nothing is listening.', color: 'var(--cc-line-2)' };
  if (!status.listening) return { text: 'Starting.', color: 'var(--cc-line-2)' };
  const panels = status.clients === 1 ? '1 remote panel' : `${status.clients} remote panels`;
  return { text: `Listening on port ${status.port}. ${panels} connected.`, color: 'var(--cc-ok)' };
}

/** The code holds the key, and a desk panel sits in plain view: it shows for this long, then covers itself. */
const CODE_SHOWS_MS = 2 * 60_000;
const CODE_SIZE = 236;

/**
 * The code to scan and the link it carries, for one of this machine's
 * addresses. Covered until asked for, and again after two minutes or when
 * Settings closes, which unmounts it.
 */
function PairBlock({ status, onNote }: { status: RemotePayload; onNote: (note: string) => void }) {
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (until === null) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= until) setUntil(null);
    }, 1000);
    return () => window.clearInterval(id);
  }, [until]);

  const address = status.addresses.find((a) => a.ip === picked) ?? status.addresses[0];
  if (!address) {
    return <Row label="Address" desc="This machine has no network address another device could reach." />;
  }

  const left = until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address.link);
      onNote('Link copied. Open it on the other device.');
    } catch {
      onNote('Clipboard refused. Nothing was copied.');
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 30,
        padding: '14px 0 16px',
        borderTop: '1px solid var(--cc-line)',
        borderBottom: '1px solid var(--cc-line)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 'none', width: CODE_SIZE }}>
        {until !== null ? (
          <>
            <QrCode text={address.link} size={CODE_SIZE} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="cc-mini" style={{ color: 'var(--cc-accent-2)' }}>
                HIDES IN {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}, OR WHEN SETTINGS CLOSES
              </span>
              <span style={{ flex: 1 }} />
              <button className="cc-chip" style={{ padding: '0 12px' }} onClick={() => setUntil(null)}>
                HIDE
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                width: CODE_SIZE,
                height: CODE_SIZE,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 14,
                background: 'var(--cc-inset)',
                backgroundImage: 'repeating-linear-gradient(135deg, var(--cc-line) 0 1px, transparent 1px 9px)',
                border: '1px solid var(--cc-line-2)',
              }}
            >
              <span className="cc-mini" style={{ textAlign: 'center', lineHeight: 1.7, color: 'var(--cc-muted)' }}>
                THE CODE HOLDS THE KEY,
                <br />
                SO IT STAYS COVERED
              </span>
              <button
                className="cc-chip cc-chip-on"
                style={{ height: 40, minWidth: 150, fontSize: 10 }}
                onClick={() => {
                  const t = Date.now();
                  setNow(t);
                  setUntil(t + CODE_SHOWS_MS);
                }}
              >
                SHOW CODE
              </button>
            </div>
            <span className="cc-mini">SHOWS FOR TWO MINUTES</span>
          </>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 9 }}>
        <span className="cc-label">Address</span>
        {status.addresses.map((a) => {
          const on = a.ip === address.ip;
          return (
            <button
              key={a.ip}
              className="cc-chip"
              aria-pressed={on}
              onClick={() => setPicked(a.ip)}
              style={{
                height: 40,
                justifyContent: 'flex-start',
                gap: 10,
                padding: '0 14px',
                borderColor: on ? 'var(--cc-accent)' : 'var(--cc-line-2)',
                color: on ? 'var(--cc-accent)' : 'var(--cc-dim)',
              }}
            >
              <span style={{ width: 6, height: 6, flex: 'none', background: on ? 'var(--cc-accent)' : 'var(--cc-line-2)' }} />
              <span style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.adapter.toUpperCase()}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, letterSpacing: 0, color: on ? 'var(--cc-text)' : 'var(--cc-dim)' }}>{a.ip}</span>
              {a.virtual && (
                <span style={{ fontSize: 9, padding: '2px 6px', border: '1px solid currentColor' }}>VIRTUAL</span>
              )}
            </button>
          );
        })}
        {status.addresses.some((a) => a.virtual) && (
          <span className="cc-mini" style={{ lineHeight: 1.6 }}>
            Real network adapters first. A virtual one, like WSL’s, can’t be reached from a tablet.
          </span>
        )}
        <span className="cc-label" style={{ marginTop: 8 }}>
          Link
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              color: 'var(--cc-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {masked(address.link)}
          </span>
          <button className="cc-chip" style={{ padding: '0 14px', height: 32 }} onClick={() => void copy()}>
            COPY LINK
          </button>
        </div>
        <span className="cc-mini" style={{ lineHeight: 1.6, marginTop: 'auto' }}>
          Anyone who scans the code or opens the link can see the panel, notifications included, until you make a new
          key.
        </span>
      </div>
    </div>
  );
}

/** On the machine being watched: whether, where and how far to let others in. */
function RemoteHostRows({
  remote,
  onChange,
  onNote,
}: {
  remote: RemoteSettings;
  onChange: (next: Partial<RemoteSettings>) => void;
  onNote: (note: string) => void;
}) {
  const status = useTopic<RemotePayload>('app:remote');
  const state = remoteStatus(status);

  return (
    <>
      <Group label="This computer" note="Other devices on your network can show this panel." />
      <div style={{ borderTop: '1px solid var(--cc-line)' }}>
        <Row
          label="Serve a remote panel"
          desc="Lets a browser on a tablet, phone or another computer on your network show this panel. While it serves, Kehai tells the network its name and port, so a paired tablet finds it again. Windows may ask whether to let Kehai through its firewall the first time."
        >
          <Seg options={['OFF', 'ON']} value={remote.on ? 'ON' : 'OFF'} onPick={(v) => onChange({ on: v === 'ON' })} />
        </Row>
        <Row
          label="Allow control"
          desc="Remote panels can press the media, notification and focus-timer buttons. Never anything else, whatever this says."
        >
          <Seg
            options={['OFF', 'ON']}
            value={remote.control ? 'ON' : 'OFF'}
            onPick={(v) => onChange({ control: v === 'ON' })}
          />
        </Row>
        <Row
          label="Status"
          desc={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: status?.error ? state.color : undefined }}>
              <span style={{ width: 5, height: 5, flex: 'none', background: state.color }} />
              {state.text}
            </span>
          }
        >
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}
            title="1024 to 65535. Changing it disconnects every remote panel."
          >
            <span className="cc-label">Port</span>
            <PortField value={remote.port} onCommit={(port) => onChange({ port })} />
          </div>
        </Row>
      </div>
      {status?.listening && (
        <>
          <Group label="Pair a tablet or phone" note="Scan the code with its camera, or open the link." />
          <PairBlock status={status} onNote={onNote} />
        </>
      )}
      <Row
        label="New key"
        desc="Disconnects every remote panel. Each then needs the new code or link. Use it when a link has gone somewhere it should not."
      >
        <button
          className="cc-chip"
          style={{ padding: '8px 16px' }}
          disabled={!status?.key}
          onClick={() => {
            sendRemote({ action: 'new_key' });
            onNote('New key made. Remote panels need the new code or link.');
          }}
        >
          NEW KEY
        </button>
      </Row>
    </>
  );
}

/** On a remote panel: what it is showing, and the way out. */
function RemotePanelRows({ onNote }: { onNote: (note: string) => void }) {
  return (
    <>
      <Row
        label="This panel"
        desc={`Shows the Kehai running at ${location.host}. Layout, theme and token budget here belong to this browser alone.`}
      >
        <span className="cc-mini" style={{ flex: 'none' }}>REMOTE</span>
      </Row>
      <Row label="Forget the key" desc="This browser stops showing the host until it is paired again.">
        <button
          className="cc-chip"
          style={{ padding: '8px 16px' }}
          onClick={() => {
            forgetRemote();
            onNote('Key forgotten.');
          }}
        >
          FORGET
        </button>
      </Row>
    </>
  );
}

function sendUpdate(command: UpdateCommand) {
  bus.publish<UpdateCommand>('update:command', 'settings', command);
}

function ago(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/**
 * The engine runs every step of an update; this row only says where it has got
 * to and offers the one action that makes sense next.
 */
function UpdateRow({ update }: { update: UpdatePayload | undefined }) {
  let desc: string;
  let control: React.ReactNode = null;
  const check = (
    <button className="cc-chip" style={{ padding: '8px 16px' }} onClick={() => sendUpdate({ action: 'check' })}>
      CHECK
    </button>
  );

  if (!update) {
    desc = 'Awaiting the engine.';
  } else {
    switch (update.state) {
      case 'idle':
        desc = update.auto ? 'Checks GitHub for a new release once a day.' : 'Not checked yet.';
        control = check;
        break;
      case 'checking':
        desc = 'Asking GitHub for the latest release.';
        control = <span className="cc-mini" style={{ flex: 'none' }}>CHECKING</span>;
        break;
      case 'current':
        desc = `Up to date. Checked ${update.checkedAtMs ? ago(update.checkedAtMs) : 'just now'}.`;
        control = check;
        break;
      case 'available':
        if (update.installable) {
          desc = `Version ${update.latest} is ready. Installing closes Kehai, updates it and opens it again.`;
          control = (
            <button
              className="cc-chip cc-chip-on"
              style={{ padding: '8px 16px' }}
              onClick={() => sendUpdate({ action: 'install' })}
            >
              INSTALL
            </button>
          );
        } else {
          desc = `Version ${update.latest} is out. ${update.reason ?? ''}`.trim();
          control = (
            <button className="cc-chip" style={{ padding: '8px 16px' }} onClick={() => sendUpdate({ action: 'open_release' })}>
              RELEASE PAGE
            </button>
          );
        }
        break;
      case 'downloading':
        desc = `Downloading ${update.latest}.`;
        control = (
          <span className="cc-mini" style={{ flex: 'none' }}>
            {update.progress === null ? 'DOWNLOADING' : `${Math.round(update.progress * 100)}%`}
          </span>
        );
        break;
      case 'installing':
        desc = 'Handing over to the installer. Kehai closes now and opens again when it is done.';
        control = <span className="cc-mini" style={{ flex: 'none' }}>INSTALLING</span>;
        break;
      case 'failed':
        desc = 'The last check did not finish.';
        control = check;
        break;
    }
  }

  return (
    <Row
      label="Updates"
      desc={
        <>
          {desc}
          {update?.error && <span style={{ display: 'block', color: 'var(--cc-danger)' }}>{update.error}</span>}
        </>
      }
    >
      {control}
    </Row>
  );
}

/** Inline Markdown down to its words: the notes have no room for links or code spans. */
function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .trim();
}

interface NoteBlock {
  kind: 'heading' | 'item' | 'text';
  text: string;
}

/**
 * Release notes come from the version's CHANGELOG.md section, which is only
 * ever `###` headings, bullets and the odd sentence. Rendering those is
 * enough, and keeps a Markdown parser out of the bundle.
 */
function ReleaseNotes({ text }: { text: string }) {
  const blocks: NoteBlock[] = [];
  // The changelog wraps long bullets onto indented lines; join them back.
  let joinable = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const last = blocks[blocks.length - 1];
    if (line === '') {
      joinable = false;
    } else if (line.startsWith('#')) {
      blocks.push({ kind: 'heading', text: line.replace(/^#+/, '') });
      joinable = false;
    } else if (/^[-*]\s/.test(line)) {
      blocks.push({ kind: 'item', text: line.replace(/^[-*]\s+/, '') });
      joinable = true;
    } else if (joinable && last) {
      last.text += ' ' + line;
    } else {
      blocks.push({ kind: 'text', text: line });
      joinable = true;
    }
  }

  return (
    <div style={{ padding: '12px 14px', background: 'var(--cc-inset)', borderBottom: '1px solid var(--cc-line)' }}>
      {blocks.map((block, i) =>
        block.kind === 'heading' ? (
          <div key={i} className="cc-mini" style={{ letterSpacing: '0.14em', marginTop: i === 0 ? 0 : 12 }}>
            {plain(block.text).toUpperCase()}
          </div>
        ) : (
          <div
            key={i}
            style={{
              fontSize: 11,
              lineHeight: 1.6,
              marginTop: 4,
              paddingLeft: block.kind === 'item' ? 12 : 0,
              textIndent: block.kind === 'item' ? -12 : 0,
            }}
          >
            {block.kind === 'item' ? '· ' : ''}
            {plain(block.text)}
          </div>
        )
      )}
    </div>
  );
}

/** A second press within a few seconds; one stray tap should not delete anything. */
function useConfirm(): [boolean, (on: boolean) => void] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  return [armed, setArmed];
}

export function SettingsScreen({
  initialSection,
  onClose,
  onArrange,
}: {
  initialSection?: Section;
  onClose: () => void;
  /** Opens the arranger on a layout, which need not be the one on screen. */
  onArrange: (layoutId: string) => void;
}) {
  const {
    settings,
    layout,
    useLayout,
    copyLayout,
    renameLayout,
    deleteLayout,
    editArrangement,
    importLayout,
    setTheme,
    setBudget,
    setAutoHideBar,
    setTranscriptRoot,
    setAutoCheckUpdates,
    setFocus,
    setRemote,
    setSetupDone,
    reset,
  } = useSettings();
  const display = useWindowShape();
  const shape = display.shape;
  const [autostart, setAutostart] = useAutostart();
  const [section, setSection] = useState<Section>(initialSection ?? 'LAYOUT');
  const update = useTopic<UpdatePayload>('app:update');
  const displays = useTopic<DisplaysPayload>('app:displays');
  const [note, setNote] = useState<string | null>(null);
  // On This Layout sits below the layout cards, out of sight of the note
  // beside the section title, so what its switches did is said beside them.
  const [onScreenNote, setOnScreenNote] = useState<string | null>(null);
  const sources = useSourceStates();
  const [jumpToOnScreen, setJumpToOnScreen] = useState(false);
  useEffect(() => {
    if (!jumpToOnScreen || section !== 'LAYOUT') return;
    document.getElementById('on-this-layout')?.scrollIntoView({ block: 'start' });
    setJumpToOnScreen(false);
  }, [jumpToOnScreen, section]);
  const [confirmReset, setConfirmReset] = useConfirm();
  const [confirmDelete, setConfirmDelete] = useConfirm();

  // What the buttons under the cards act on. Selecting is not using: only USE
  // changes the screen.
  const [selectedId, setSelectedId] = useState(settings.layoutId);
  const selected = findLayout(settings, selectedId) ?? layout;
  const [renaming, setRenaming] = useState<string | null>(null);
  const select = (id: string) => {
    setSelectedId(id);
    setRenaming(null);
    setConfirmDelete(false);
  };
  const commitRename = () => {
    if (renaming !== null) renameLayout(selected.id, renaming);
    setRenaming(null);
  };

  const label = (name: string) => registry[name]?.name ?? name;
  const here = layout.shapes[shape];
  // Whose options are open, from Widgets, and the first of its tiles on screen.
  const [optionsFor, setOptionsFor] = useState<string | null>(null);
  const tileOf = (widget: string) => {
    const i = here.tiles.findIndex((t) => t.widget === widget);
    return i >= 0 ? i : null;
  };
  const editHere = (fn: Parameters<typeof editArrangement>[2]) => editArrangement(settings.layoutId, shape, fn);

  const exportSelected = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ format: LAYOUT_FORMAT, ...selected }, null, 2));
      setNote(`${selected.name} copied to the clipboard.`);
    } catch {
      setNote('Clipboard refused. Nothing was copied.');
    }
  };

  const importFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const result = importLayout(JSON.parse(text));
      if (!result.ok) {
        setNote(`Rejected: ${result.reason}`);
        return;
      }
      setSelectedId(result.id);
      setNote('Imported under Yours. USE puts it on screen.');
    } catch {
      setNote('Could not read a layout from the clipboard.');
    }
  };

  const toggleWidget = (name: string, on: boolean) => {
    const copying = isPreset(settings.layoutId);
    if (on) {
      editHere((a) => withTiles(a, a.tiles.filter((t) => t.widget !== name)));
    } else {
      const tiles = placeTile(here, name, minSize);
      if (!tiles) {
        setOnScreenNote(`No room for ${label(name)}. Make space with ARRANGE first.`);
        return;
      }
      editHere((a) => withTiles(a, tiles));
    }
    if (copying) setOnScreenNote(`${layout.name} is a preset, so this changed a copy of it, now under Yours and on screen.`);
    else setOnScreenNote(on ? `${label(name)} removed from this layout.` : `${label(name)} added. ARRANGE moves it.`);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--cc-bg)' }}>
      <div
        data-tauri-drag-region
        style={{
          height: 40,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          padding: '0 18px',
          background: 'var(--cc-pane)',
          borderBottom: '1px solid var(--cc-line)',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--cc-accent)" strokeWidth="1.3">
          <circle cx="8" cy="8" r="2.4" />
          <path d="M8 1.4v2M8 12.6v2M1.4 8h2M12.6 8h2M3.3 3.3l1.4 1.4M11.3 11.3l1.4 1.4M12.7 3.3l-1.4 1.4M4.7 11.3l-1.4 1.4" />
        </svg>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.2em' }}>SETTINGS</span>
        <div style={{ flex: 1 }} />
        <span className="cc-mini">CHANGES APPLY IMMEDIATELY</span>
        <button className="cc-chip" style={{ padding: '6px 14px' }} onClick={onClose}>
          CLOSE
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div
          style={{
            width: 224,
            flex: 'none',
            background: 'var(--cc-pane)',
            borderRight: '1px solid var(--cc-line)',
            display: 'flex',
            flexDirection: 'column',
            paddingTop: 10,
          }}
        >
          {NAV.map((n) => (
            <button
              key={n}
              onClick={() => setSection(n)}
              style={{
                height: 46,
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '0 18px',
                background: section === n ? 'var(--cc-pane-2)' : 'transparent',
                border: 0,
                borderLeft: `2px solid ${section === n ? 'var(--cc-accent)' : 'transparent'}`,
                color: section === n ? 'var(--cc-accent)' : 'var(--cc-muted)',
                textAlign: 'left',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
                <path d={NAV_ICON[n]} />
              </svg>
              <span style={{ fontSize: 11, letterSpacing: '0.16em', flex: 1 }}>{n}</span>
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ padding: '16px 18px', borderTop: '1px solid var(--cc-line)' }}>
            <span className="cc-mini" style={{ fontSize: 9, lineHeight: 1.7, display: 'block' }}>
              EVERY CHANGE IS SAVED AS YOU MAKE IT. THERE IS NO FILE TO EDIT AND NOTHING TO RESTART.
            </span>
          </div>
        </div>

        <div style={{ flex: 1, padding: '26px 30px', minWidth: 0, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.16em' }}>{section}</span>
            {note && <span className="cc-mini" style={{ color: 'var(--cc-accent)' }}>{note}</span>}
          </div>

          {section === 'LAYOUT' && (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 16 }}>
                <span className="cc-mini" style={{ letterSpacing: '0.16em' }}>
                  PRESETS · UPDATED WITH EACH RELEASE
                </span>
                <div style={{ flex: 1 }} />
                <span className="cc-mini" style={{ letterSpacing: '0.16em' }}>
                  THIS DISPLAY
                </span>
                <span style={{ fontSize: 11 }}>
                  {display.width} × {display.height} · {shape.toUpperCase()}
                </span>
              </div>
              <div style={CARD_GRID}>
                {PRESET_ORDER.map((id) => (
                  <LayoutCard
                    key={id}
                    layout={PRESETS[id]}
                    shape={shape}
                    inUse={settings.layoutId === id}
                    selected={selected.id === id}
                    onSelect={() => select(id)}
                  />
                ))}
              </div>

              <div style={{ marginTop: 22 }}>
                <span className="cc-mini" style={{ letterSpacing: '0.16em' }}>
                  YOURS
                </span>
              </div>
              <div style={CARD_GRID}>
                {settings.layouts.map((l) => (
                  <LayoutCard
                    key={l.id}
                    layout={l}
                    shape={shape}
                    inUse={settings.layoutId === l.id}
                    selected={selected.id === l.id}
                    onSelect={() => select(l.id)}
                  />
                ))}
                <button
                  onClick={() => {
                    const id = copyLayout(settings.layoutId);
                    select(id);
                    setNote(`Copied ${layout.name}. ARRANGE changes the copy; USE puts it on screen.`);
                  }}
                  style={{
                    minHeight: 132,
                    background: 'transparent',
                    border: '1px dashed var(--cc-line-2)',
                    color: 'var(--cc-muted)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 22, fontWeight: 200 }}>+</span>
                  <span className="cc-mini" style={{ letterSpacing: '0.14em', color: 'var(--cc-muted)' }}>
                    COPY THE ONE IN USE
                  </span>
                </button>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 22,
                  paddingTop: 16,
                  borderTop: '1px solid var(--cc-line)',
                }}
              >
                {renaming !== null ? (
                  <>
                    <input
                      autoFocus
                      aria-label="Layout name"
                      value={renaming}
                      maxLength={40}
                      onChange={(e) => setRenaming(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      style={{
                        height: 34,
                        width: 260,
                        padding: '0 10px',
                        background: 'var(--cc-inset)',
                        border: '1px solid var(--cc-accent-2)',
                        color: 'var(--cc-text)',
                        font: 'inherit',
                        fontSize: 12,
                      }}
                    />
                    <button className="cc-chip cc-chip-on" style={{ height: 34, padding: '0 14px' }} onClick={commitRename}>
                      SAVE NAME
                    </button>
                    <button className="cc-chip" style={{ height: 34, padding: '0 14px' }} onClick={() => setRenaming(null)}>
                      CANCEL
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="cc-chip cc-chip-on"
                      style={{ height: 34, padding: '0 14px', opacity: selected.id === settings.layoutId ? 0.5 : 1 }}
                      disabled={selected.id === settings.layoutId}
                      onClick={() => {
                        useLayout(selected.id);
                        setNote(null);
                      }}
                    >
                      {selected.id === settings.layoutId ? 'IN USE' : `USE ${selected.name.toUpperCase()}`}
                    </button>
                    <button className="cc-chip" style={{ height: 34, padding: '0 14px' }} onClick={() => onArrange(selected.id)}>
                      ARRANGE
                    </button>
                    {!isPreset(selected.id) && (
                      <button
                        className="cc-chip"
                        style={{ height: 34, padding: '0 14px' }}
                        onClick={() => setRenaming(selected.name)}
                      >
                        RENAME
                      </button>
                    )}
                    <button className="cc-chip" style={{ height: 34, padding: '0 14px' }} onClick={() => void exportSelected()}>
                      EXPORT
                    </button>
                    <button className="cc-chip" style={{ height: 34, padding: '0 14px' }} onClick={() => void importFromClipboard()}>
                      IMPORT
                    </button>
                    <div style={{ flex: 1 }} />
                    {!isPreset(selected.id) && (
                      <button
                        className="cc-chip"
                        style={{
                          height: 34,
                          padding: '0 14px',
                          color: confirmDelete ? 'var(--cc-bg)' : 'var(--cc-danger)',
                          background: confirmDelete ? 'var(--cc-danger)' : 'transparent',
                          borderColor: 'var(--cc-danger)',
                        }}
                        onClick={() => {
                          if (!confirmDelete) {
                            setConfirmDelete(true);
                            return;
                          }
                          setConfirmDelete(false);
                          deleteLayout(selected.id);
                          select(selected.id === settings.layoutId ? 'stage' : settings.layoutId);
                          setNote(`${selected.name} deleted.`);
                        }}
                      >
                        {confirmDelete ? 'PRESS AGAIN TO DELETE' : 'DELETE'}
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className="cc-mini" style={{ marginTop: 10, lineHeight: 1.6 }}>
                Presets cannot be changed: arranging one saves a copy under Yours. Each layout has an arrangement for
                landscape, bar and portrait displays, and Kehai shows the one that fits its window. Export copies the
                selected layout to the clipboard; Import adds one from it.
              </div>

              <div id="on-this-layout" style={{ marginTop: 28, paddingTop: 18, borderTop: '1px solid var(--cc-line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="cc-label">ON THIS LAYOUT</span>
                  <span className="cc-mini" style={{ flex: 1, minWidth: 0 }}>
                    {layout.name.toUpperCase()} · {shape.toUpperCase()}, THE ONE ON SCREEN
                  </span>
                  <button className="cc-chip" style={{ height: 34, padding: '0 14px' }} onClick={() => onArrange(settings.layoutId)}>
                    ARRANGE
                  </button>
                </div>
                <div className="cc-mini" style={{ marginTop: 8, marginBottom: 6, lineHeight: 1.6 }}>
                  Which widgets are in the {shape} arrangement of {layout.name}. One turned on goes in the first space it
                  fits.
                  {isPreset(settings.layoutId) ? ' It is a preset, so a change saves a copy under Yours.' : ''}
                </div>
                {onScreenNote && (
                  <div className="cc-mini" style={{ color: 'var(--cc-accent)', marginBottom: 6 }}>
                    {onScreenNote}
                  </div>
                )}
                {[...widgetNames].sort((a, b) => label(a).localeCompare(label(b))).map((name) => {
                  const on = here.tiles.some((t) => t.widget === name);
                  return (
                    <Row key={name} label={label(name)} desc={registry[name].about}>
                      <Seg
                        options={['OFF', 'ON']}
                        value={on ? 'ON' : 'OFF'}
                        onPick={(v) => {
                          if ((v === 'ON') !== on) toggleWidget(name, on);
                        }}
                      />
                    </Row>
                  );
                })}
  
                <div className="cc-mini" style={{ marginTop: 12, lineHeight: 1.6 }}>
                  A widget’s options are in its own sheet: hold its tile, right-click it, or OPTIONS under Widgets.
                </div>
              </div>
            </>
          )}

          {section === 'WIDGETS' && (
            <>
              <Group
                label={`BUNDLED WITH KEHAI · ${widgetNames.length}`}
                note="Part of Kehai, and updated with it. Each reads only the computer Kehai runs on."
              />
              {[...widgetNames]
                .sort((a, b) => label(a).localeCompare(label(b)))
                .map((name) => (
                  <WidgetRow
                    key={name}
                    widget={registry[name]}
                    sources={sources}
                    onOptions={registry[name].options ? () => setOptionsFor(name) : undefined}
                  />
                ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
                <span className="cc-mini" style={{ flex: 1, lineHeight: 1.6 }}>
                  Which of them are on screen is under Layout.
                  {REMOTE_PANEL ? ' Options are on the PC Kehai runs on.' : ' Holding a tile, or right-clicking it, opens the same options.'}
                </span>
                <button
                  className="cc-chip"
                  style={{ padding: '7px 13px' }}
                  onClick={() => {
                    setSection('LAYOUT');
                    setJumpToOnScreen(true);
                  }}
                >
                  ON THIS LAYOUT
                </button>
              </div>
            </>
          )}

          {section === 'APPEARANCE' && (
            <>
              <Group label="COLOURS" note="Any layout takes any colours." />
              <div style={{ display: 'flex', gap: 12 }}>
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    style={{
                      flex: 1,
                      background: 'var(--cc-pane)',
                      border: `1px solid ${settings.theme === t.id ? 'var(--cc-accent)' : 'var(--cc-line)'}`,
                      padding: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 9,
                    }}
                  >
                    <div style={{ height: 74, background: t.swatch[0], display: 'flex', alignItems: 'flex-end', gap: 6, padding: 8 }}>
                      <div style={{ flex: 1, height: 10, background: t.swatch[1] }} />
                      <div style={{ flex: 1, height: 10, background: t.swatch[2] }} />
                      <div style={{ flex: 2, height: 10, background: t.swatch[3] }} />
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        letterSpacing: '0.14em',
                        color: settings.theme === t.id ? 'var(--cc-accent)' : 'var(--cc-muted)',
                      }}
                    >
                      {t.name}
                    </span>
                  </button>
                ))}
              </div>
              <QuietRows />
            </>
          )}

          {section === 'WINDOW' && (
            <div style={{ marginTop: 18 }}>
              {!REMOTE_PANEL && displays && displays.displays.length > 0 && <DisplayRows state={displays} />}
              {/* A remote panel is a browser tab: it starts with nothing and has no window to remember. */}
              {!REMOTE_PANEL && (
                <Row
                  label="Start with Windows"
                  desc="Registers the app to launch at sign-in. Written to the OS, not to these settings."
                >
                  {autostart === null ? (
                    <span className="cc-mini" style={{ flex: 'none' }}>UNAVAILABLE HERE</span>
                  ) : (
                    <Seg
                      options={['OFF', 'ON']}
                      value={autostart ? 'ON' : 'OFF'}
                      onPick={(v) => setAutostart(v === 'ON')}
                    />
                  )}
                </Row>
              )}
              <Row
                label="Auto-hide the top bar"
                desc="The header slides away and returns when the pointer reaches the top edge."
              >
                <Seg
                  options={['OFF', 'ON']}
                  value={settings.autoHideBar ? 'ON' : 'OFF'}
                  onPick={(v) => setAutoHideBar(v === 'ON')}
                />
              </Row>
              {REMOTE_PANEL && (
                <Row label="Fullscreen" desc="F11 toggles it at any time.">
                  <span className="cc-mini" style={{ flex: 'none' }}>F11</span>
                </Row>
              )}
            </div>
          )}

          {section === 'SOURCES' && (
            <div style={{ marginTop: 18 }}>
              <SourceRow label="Processor" topic="telemetry:cpu" desc="Usage, per-thread load and clock." />
              <SourceRow label="Memory" topic="telemetry:mem" desc="Physical and swap." />
              <SourceRow label="Network" topic="telemetry:net" desc="Throughput per interface." />
              <SourceRow label="Disk" topic="telemetry:disk" desc="Volumes and capacity." />
              <SourceRow
                label="Focus timer"
                topic="flow:pomodoro"
                desc="Kept by the engine. Today's total is saved locally and survives a restart."
              />
              {!REMOTE_PANEL && <FocusRows focus={settings.focus} onChange={setFocus} />}
              <SourceRow label="Agent tokens" topic="dev:llm_tokens" desc="Tallied from local session transcripts. Never leaves the machine." />
              <SubRow
                label="Token budget"
                desc="No local source exposes your real plan limit, so a percentage only means something once you pick a number to measure against."
              >
                <Seg
                  options={[0, 1, 5, 10, 20]}
                  value={settings.budgetTokens ? settings.budgetTokens / 1_000_000 : 0}
                  format={(v) => (v === 0 ? 'NONE' : `${v}M`)}
                  onPick={(v) => setBudget(v === 0 ? null : v * 1_000_000)}
                />
              </SubRow>
              <SourceRow
                label="Agent sessions"
                topic="dev:agents"
                desc="Which sessions are working and which wait on you, from the same transcripts."
              />
              {!REMOTE_PANEL && <TranscriptRootRow value={settings.transcriptRoot} onCommit={setTranscriptRoot} />}
              <SourceRow label="Media session" topic="media:now_playing" desc="Track, position and transport." />
              <NotifyRow />
            </div>
          )}

          {section === 'REMOTE' && (
            <div style={{ marginTop: 18 }}>
              {REMOTE_PANEL ? (
                <RemotePanelRows onNote={setNote} />
              ) : (
                <RemoteHostRows remote={settings.remote} onChange={setRemote} onNote={setNote} />
              )}
            </div>
          )}

          {section === 'ABOUT' && (
            <div style={{ marginTop: 18 }}>
              {/* Updating belongs to the machine running Kehai, which a remote panel is not. */}
              {!REMOTE_PANEL && (
                <>
                  <Row label="Version" desc={update && !update.installable ? (update.reason ?? undefined) : undefined}>
                    <span style={{ fontSize: 12, color: 'var(--cc-muted)' }}>{update?.current ?? '--'}</span>
                  </Row>
                  <UpdateRow update={update} />
                  {update?.notes && (update.state === 'available' || update.state === 'downloading') && (
                    <ReleaseNotes text={update.notes} />
                  )}
                  <Row
                    label="Check automatically"
                    desc="Once a day, starting a minute after launch. Asks github.com for the latest release and sends nothing else."
                  >
                    <Seg
                      options={['OFF', 'ON']}
                      value={settings.autoCheckUpdates ? 'ON' : 'OFF'}
                      onPick={(v) => setAutoCheckUpdates(v === 'ON')}
                    />
                  </Row>
                  {/* Not on a remote panel either: it may be showing inside another app, whose store decides which links it may carry. */}
                  <Row
                    label="Support Kehai"
                    desc="Kehai is free and stays free. If it earns its place on your desk, you can buy its author a coffee. Opens buymeacoffee.com in your browser."
                  >
                    <button
                      className="cc-chip"
                      style={{ padding: '8px 16px' }}
                      onClick={() => sendUpdate({ action: 'open_support' })}
                    >
                      BUY A COFFEE
                    </button>
                  </Row>
                </>
              )}
              <Row label="Run setup again" desc="Display, sources, layout and colours, as on the first launch. Nothing changes until you choose.">
                <button
                  className="cc-chip"
                  style={{ padding: '8px 16px' }}
                  onClick={() => {
                    setSetupDone(false);
                    onClose();
                  }}
                >
                  SETUP
                </button>
              </Row>
              <Row
                label="Reset everything"
                desc="Every setting back to how Kehai ships: Stage in Amber, no budget, no layouts of your own, no remote panel. Setup runs again."
              >
                <button
                  className="cc-chip"
                  style={{
                    padding: '8px 16px',
                    color: confirmReset ? 'var(--cc-bg)' : 'var(--cc-danger)',
                    background: confirmReset ? 'var(--cc-danger)' : 'transparent',
                    borderColor: 'var(--cc-danger)',
                  }}
                  onClick={() => {
                    if (!confirmReset) {
                      setConfirmReset(true);
                      return;
                    }
                    setConfirmReset(false);
                    reset();
                    setNote('Reset to defaults.');
                  }}
                >
                  {confirmReset ? 'PRESS AGAIN TO RESET' : 'RESET'}
                </button>
              </Row>
            </div>
          )}
        </div>
      </div>
      {optionsFor && (
        <OptionsSheet
          held={{ widget: optionsFor, tile: tileOf(optionsFor), rect: null }}
          inSettings
          onClose={() => setOptionsFor(null)}
          onArrange={() => {
            setOptionsFor(null);
            onArrange(settings.layoutId);
          }}
        />
      )}
    </div>
  );
}
