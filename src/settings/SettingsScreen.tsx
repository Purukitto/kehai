import { useEffect, useState } from 'react';
import { bus } from '../core/bus';
import type { UpdateCommand, UpdatePayload } from '../core/payloads';
import { PRESETS, PRESET_ORDER, useSettings } from '../core/settings';
import { useTopic } from '../core/useTopic';
import type { Layout, ThemeId } from '../core/types';
import { registry, widgetNames } from '../widgets/registry';

const NAV = ['LAYOUT', 'WIDGETS', 'APPEARANCE', 'WINDOW', 'SOURCES', 'ABOUT'] as const;
export type Section = (typeof NAV)[number];

const NAV_ICON: Record<Section, string> = {
  LAYOUT: 'M2 2h5v5H2ZM9 2h5v5H9ZM2 9h5v5H2ZM9 9h5v5H9Z',
  WIDGETS: 'M8 1.6 14 5v6l-6 3.4L2 11V5Z',
  APPEARANCE:
    'M8 1.8a6.2 6.2 0 1 0 0 12.4c1 0 1.4-.7 1.4-1.3 0-1.2-1.2-1.3-1.2-2.2 0-.6.5-1 1.2-1h1.2A3.6 3.6 0 0 0 14.2 6c0-2.4-2.6-4.2-6.2-4.2',
  SOURCES:
    'M2.5 4.4c0-1.2 2.5-2.2 5.5-2.2s5.5 1 5.5 2.2-2.5 2.2-5.5 2.2-5.5-1-5.5-2.2M2.5 4.4v7.2c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V4.4M2.5 8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2',
  WINDOW: 'M1.8 3.2h12.4v9.6H1.8zM1.8 6h12.4',
  ABOUT: 'M8 1.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 1 0 0-12.4M8 7.2v4M8 4.9v.1',
};

/**
 * Autostart lives behind the OS, not in our settings file, so the toggle has to
 * read the real state rather than assume it. Unavailable outside Tauri.
 */
function useAutostart(): [boolean | null, (on: boolean) => void] {
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

const THEMES: { id: ThemeId; name: string; swatch: string[] }[] = [
  { id: 'amber', name: 'AMBER', swatch: ['#161512', '#f0a83c', '#3fc6dc', '#e9e5dc'] },
  { id: 'phosphor', name: 'PHOSPHOR', swatch: ['#0a100b', '#6cf58a', '#c8ff8f', '#a9f5b4'] },
  { id: 'ice', name: 'ICE', swatch: ['#121820', '#56cfe1', '#9d8cff', '#dce6f2'] },
];

function Row({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '12px 0',
        borderBottom: '1px solid var(--cc-line)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12 }}>{label}</div>
        {desc && (
          <div className="cc-mini" style={{ marginTop: 4, lineHeight: 1.5 }}>
            {desc}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Seg<T extends string | number>({
  options,
  value,
  onPick,
  format,
}: {
  options: T[];
  value: T;
  onPick: (v: T) => void;
  format?: (v: T) => string;
}) {
  return (
    <div style={{ display: 'flex', flex: 'none' }}>
      {options.map((o) => (
        <button
          key={String(o)}
          onClick={() => onPick(o)}
          className={o === value ? 'cc-chip cc-chip-on' : 'cc-chip'}
          style={{ padding: '7px 13px', marginLeft: -1 }}
        >
          {format ? format(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

function Stepper({ value, onChange, lo, hi }: { value: number; onChange: (v: number) => void; lo: number; hi: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', flex: 'none' }}>
      <button className="cc-chip" style={{ width: 34 }} onClick={() => onChange(Math.max(lo, value - 1))}>
        −
      </button>
      <div
        style={{
          width: 54,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderTop: '1px solid var(--cc-line)',
          borderBottom: '1px solid var(--cc-line)',
          fontSize: 13,
        }}
      >
        {value}
      </div>
      <button className="cc-chip" style={{ width: 34, marginLeft: -1 }} onClick={() => onChange(Math.min(hi, value + 1))}>
        +
      </button>
    </div>
  );
}

function PresetCard({
  layout,
  name,
  meta,
  active,
  onPick,
}: {
  layout: Layout;
  name: string;
  meta: string;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      onClick={onPick}
      style={{
        flex: 1,
        background: 'var(--cc-pane)',
        border: `1px solid ${active ? 'var(--cc-accent)' : 'var(--cc-line)'}`,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 9,
        minWidth: 0,
      }}
    >
      <div
        style={{
          height: 74,
          width: '100%',
          background: 'var(--cc-inset)',
          display: 'grid',
          gridTemplateColumns: `repeat(${layout.grid.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${layout.grid.rows}, minmax(0, 1fr))`,
          gap: 2,
          padding: 5,
        }}
      >
        {layout.tiles.map((t, i) => (
          <div
            key={i}
            style={{
              gridArea: `${t.area[0]} / ${t.area[1]} / ${t.area[2]} / ${t.area[3]}`,
              background: active ? 'var(--cc-accent)' : 'var(--cc-line-2)',
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, width: '100%' }}>
        <span style={{ fontSize: 10, letterSpacing: '0.14em', color: active ? 'var(--cc-accent)' : 'var(--cc-muted)' }}>
          {name}
        </span>
        <div style={{ flex: 1 }} />
        <span className="cc-mini" style={{ fontSize: 9 }}>
          {meta}
        </span>
      </div>
    </button>
  );
}

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

/**
 * Committed on Enter or when focus leaves, not per keystroke: each commit makes
 * the engine re-read the folder, and a half-typed path is a folder that does
 * not exist. Whether the folder worked shows on the Agent tokens row above.
 */
function TranscriptRootRow({ value, onCommit }: { value: string | null; onCommit: (path: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => setDraft(value ?? ''), [value]);

  const commit = () => {
    const next = draft.trim() === '' ? null : draft.trim();
    if (next !== value) onCommit(next);
  };

  // Laid out as a SourceRow with no dot, so it reads as part of Agent tokens
  // rather than as a separate source.
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

export function SettingsScreen({
  initialSection,
  onClose,
  onArrange,
}: {
  initialSection?: Section;
  onClose: () => void;
  onArrange: () => void;
}) {
  const {
    settings,
    usePreset,
    setTheme,
    setBudget,
    setAutoHideBar,
    setTranscriptRoot,
    setAutoCheckUpdates,
    setGrid,
    toggleWidget,
    setTileProp,
    reset,
    importLayout,
  } = useSettings();
  const [autostart, setAutostart] = useAutostart();
  const [section, setSection] = useState<Section>(initialSection ?? 'LAYOUT');
  const update = useTopic<UpdatePayload>('app:update');
  const [note, setNote] = useState<string | null>(null);

  const layout = settings.layout;
  const mediaIndex = layout.tiles.findIndex((t) => t.widget === 'media');
  const mediaTile = mediaIndex >= 0 ? layout.tiles[mediaIndex] : undefined;

  const copyLayout = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(layout, null, 2));
      setNote('Layout copied to the clipboard.');
    } catch {
      setNote('Clipboard refused. Nothing was copied.');
    }
  };

  const pasteLayout = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const reason = importLayout(JSON.parse(text));
      setNote(reason ? `Rejected: ${reason}` : 'Layout imported.');
    } catch {
      setNote('Could not read a layout from the clipboard.');
    }
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
              <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
                {PRESET_ORDER.map((id) => (
                  <PresetCard
                    key={id}
                    layout={PRESETS[id]}
                    name={PRESETS[id].name.toUpperCase()}
                    meta={`${PRESETS[id].tiles.length} TILES`}
                    active={settings.presetId === id}
                    onPick={() => usePreset(id)}
                  />
                ))}
                <PresetCard
                  layout={layout}
                  name="CUSTOM"
                  meta="YOURS"
                  active={settings.presetId === 'custom'}
                  onPick={() => undefined}
                />
              </div>
              <div style={{ marginTop: 20 }}>
                <Row label="Arrange tiles" desc="Drag to move, drag a corner to resize. Snaps to grid cells.">
                  <button className="cc-chip cc-chip-on" style={{ padding: '8px 16px' }} onClick={onArrange}>
                    OPEN
                  </button>
                </Row>
                <Row label="Grid columns" desc="More columns let you place things more finely.">
                  <Stepper value={layout.grid.cols} lo={4} hi={24} onChange={(cols) => setGrid({ cols })} />
                </Row>
                <Row label="Grid rows" desc="Same, vertically.">
                  <Stepper value={layout.grid.rows} lo={4} hi={24} onChange={(rows) => setGrid({ rows })} />
                </Row>
                <Row label="Tile gap" desc="Hairline gutters between tiles, in pixels.">
                  <Seg options={[0, 1, 2, 4]} value={layout.grid.gap} onPick={(gap) => setGrid({ gap })} />
                </Row>
              </div>
            </>
          )}

          {section === 'WIDGETS' && (
            <div style={{ marginTop: 18 }}>
              {widgetNames.map((name) => {
                const on = layout.tiles.some((t) => t.widget === name);
                return (
                  <Row
                    key={name}
                    label={name.replace(/^\w/, (c) => c.toUpperCase())}
                    desc={registry[name].topics.join(' · ')}
                  >
                    <Seg
                      options={['OFF', 'ON']}
                      value={on ? 'ON' : 'OFF'}
                      onPick={(v) => {
                        if ((v === 'ON') !== on) toggleWidget(name);
                      }}
                    />
                  </Row>
                );
              })}

              {mediaTile && (
                <>
                  <Row label="Album art" desc="Shown beside the track when the player provides one.">
                    <Seg
                      options={['OFF', 'ON']}
                      value={mediaTile.props?.art === false ? 'OFF' : 'ON'}
                      onPick={(v) => setTileProp(mediaIndex, 'art', v === 'ON')}
                    />
                  </Row>
                  <Row label="Equaliser" desc="A horizontal bar that freezes when playback pauses.">
                    <Seg
                      options={['off', 'bar']}
                      value={mediaTile.props?.equaliser === 'off' ? 'off' : 'bar'}
                      onPick={(v) => setTileProp(mediaIndex, 'equaliser', v)}
                    />
                  </Row>
                </>
              )}
            </div>
          )}

          {section === 'APPEARANCE' && (
            <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  style={{
                    flex: 1,
                    background: 'var(--cc-pane)',
                    border: `1px solid ${layout.theme === t.id ? 'var(--cc-accent)' : 'var(--cc-line)'}`,
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
                      color: layout.theme === t.id ? 'var(--cc-accent)' : 'var(--cc-muted)',
                    }}
                  >
                    {t.name}
                  </span>
                </button>
              ))}
            </div>
          )}

          {section === 'WINDOW' && (
            <div style={{ marginTop: 18 }}>
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
              <Row
                label="Remember where it was"
                desc="Position and size are saved on exit and restored on launch, so it reopens on the display you left it on."
              >
                <span className="cc-mini" style={{ flex: 'none' }}>ALWAYS ON</span>
              </Row>
              <Row label="Fullscreen" desc="F11 toggles it at any time.">
                <span className="cc-mini" style={{ flex: 'none' }}>F11</span>
              </Row>
            </div>
          )}

          {section === 'SOURCES' && (
            <div style={{ marginTop: 18 }}>
              <SourceRow label="Processor" topic="telemetry:cpu" desc="Usage, per-thread load and clock." />
              <SourceRow label="Memory" topic="telemetry:mem" desc="Physical and swap." />
              <SourceRow label="Network" topic="telemetry:net" desc="Throughput per interface." />
              <SourceRow label="Disk" topic="telemetry:disk" desc="Volumes and capacity." />
              <SourceRow label="Agent tokens" topic="dev:llm_tokens" desc="Tallied from local session transcripts. Never leaves the machine." />
              <TranscriptRootRow value={settings.transcriptRoot} onCommit={setTranscriptRoot} />
              <SourceRow label="Media session" topic="media:now_playing" desc="Track, position and transport." />
              <SourceRow label="Notifications" topic="sys:notify" desc="Intercepted from the system tray." />
            </div>
          )}

          {section === 'ABOUT' && (
            <div style={{ marginTop: 18 }}>
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
              <Row
                label="Token budget"
                desc="No local source exposes your real plan limit, so a percentage only means something once you pick a number to measure against."
              >
                <Seg
                  options={[0, 1, 5, 10, 20]}
                  value={settings.budgetTokens ? settings.budgetTokens / 1_000_000 : 0}
                  format={(v) => (v === 0 ? 'NONE' : `${v}M`)}
                  onPick={(v) => setBudget(v === 0 ? null : v * 1_000_000)}
                />
              </Row>
              <Row label="Export layout" desc="Copies the current arrangement as JSON you can keep or share.">
                <button className="cc-chip" style={{ padding: '8px 16px' }} onClick={() => void copyLayout()}>
                  COPY
                </button>
              </Row>
              <Row label="Import layout" desc="Reads an arrangement from the clipboard.">
                <button className="cc-chip" style={{ padding: '8px 16px' }} onClick={() => void pasteLayout()}>
                  PASTE
                </button>
              </Row>
              <Row label="Reset everything" desc="Back to the Stage preset and its theme.">
                <button
                  className="cc-chip"
                  style={{ padding: '8px 16px', color: 'var(--cc-danger)', borderColor: 'var(--cc-danger)' }}
                  onClick={() => {
                    reset();
                    setNote('Reset to defaults.');
                  }}
                >
                  RESET
                </button>
              </Row>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
