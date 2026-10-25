import { useState } from 'react';
import type { ReactNode } from 'react';
import { DisplayMap, displayLabel } from '../components/DisplayMap';
import { WindowControls } from '../components/WindowControls';
import { bus } from '../core/bus';
import { hhmm } from '../core/night';
import type {
  AgentsPayload,
  CpuPayload,
  DisplayCommand,
  DisplaysPayload,
  MediaPayload,
  NotifyCommand,
  NotifyPayload,
} from '../core/payloads';
import { REMOTE_PANEL } from '../core/remoteSource';
import { PRESETS, PRESET_ORDER, useSettings } from '../core/settings';
import { isTauri } from '../core/tauriSource';
import type { Layout, Shape } from '../core/types';
import { useTopic } from '../core/useTopic';
import { useWindowShape } from '../core/useWindowShape';
import { THEMES, TranscriptRootRow, useAutostart } from '../settings/SettingsScreen';
import type { Section } from '../settings/SettingsScreen';
import { registry } from '../widgets/registry';

type Step = 'DISPLAY' | 'SOURCES' | 'LAYOUT' | 'FINISH';

/**
 * A remote panel has no window to place, and the sources belong to the
 * machine it watches: it pairs as it always has, then chooses how it looks.
 */
const STEPS: Step[] = REMOTE_PANEL ? ['LAYOUT', 'FINISH'] : ['DISPLAY', 'SOURCES', 'LAYOUT', 'FINISH'];

/** Only Windows puts up a prompt of its own; elsewhere nothing is read until Allow. */
const WINDOWS = typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent);
/** Media sessions are not wired on macOS. */
const MAC = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent);

/** The engine's reasons are written to follow a colon; here one starts a sentence. */
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function showOn(id: string, fill: boolean) {
  bus.publish<DisplayCommand>('display:command', 'setup', { action: 'show', id, fill });
}

const CHECK = (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M1.5 5.2 4 7.6 8.5 2.4" />
  </svg>
);

function Steps({ at, inline }: { at: number; inline: boolean }) {
  return (
    <>
      {STEPS.map((s, i) => {
        const done = i < at;
        const on = i === at;
        const color = on ? 'var(--cc-accent)' : done ? 'var(--cc-muted)' : 'var(--cc-dim)';
        return (
          <div
            key={s}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              color,
              height: inline ? undefined : '100%',
              padding: inline ? undefined : '0 22px',
              boxShadow: on && !inline ? 'inset 0 -2px 0 var(--cc-accent)' : undefined,
              flex: 'none',
            }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                border: `1px solid ${on ? 'var(--cc-accent)' : done ? 'var(--cc-ok)' : 'var(--cc-line-2)'}`,
                color: done ? 'var(--cc-ok)' : color,
              }}
            >
              {done ? CHECK : i + 1}
            </span>
            <span style={{ fontSize: 10, letterSpacing: '0.16em' }}>{s}</span>
          </div>
        );
      })}
    </>
  );
}

function Title({ children, sub }: { children: string; sub: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 300, letterSpacing: '-0.01em' }}>{children}</div>
      <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--cc-muted)', maxWidth: 860, marginTop: 10 }}>{sub}</div>
    </div>
  );
}

/** A row of setup: what it is on the left, the choice on the right. */
function Choice({ label, desc, dot, children }: { label: string; desc: ReactNode; dot?: string; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '15px 0', borderTop: '1px solid var(--cc-line)', flexWrap: 'wrap' }}>
      {dot && <span style={{ width: 7, height: 7, flex: 'none', background: dot, alignSelf: 'flex-start', marginTop: 5 }} />}
      <div style={{ flex: '1 1 280px', minWidth: 0 }}>
        <div style={{ fontSize: 13 }}>{label}</div>
        <div className="cc-mini" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 5 }}>
          {desc}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 'none', marginLeft: 'auto' }}>{children}</div>
    </div>
  );
}

/** Setup's buttons are a size up from Settings': the panel it lands on may be a touchscreen. */
function Button({ children, onClick, fill, disabled }: { children: ReactNode; onClick: () => void; fill?: boolean; disabled?: boolean }) {
  return (
    <button
      className={fill ? 'cc-chip cc-chip-on' : 'cc-chip'}
      style={{ height: 36, minWidth: 96, padding: '0 14px', fontSize: 10 }}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function OnOff({ on, onPick }: { on: boolean; onPick: (on: boolean) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
      {['OFF', 'ON'].map((o) => (
        <button
          key={o}
          className={(o === 'ON') === on ? 'cc-chip cc-chip-on' : 'cc-chip'}
          style={{ height: 36, minWidth: 56, fontSize: 10 }}
          onClick={() => onPick(o === 'ON')}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function Status({ children, ok }: { children: string; ok?: boolean }) {
  return (
    <span className="cc-label" style={{ color: ok ? 'var(--cc-ok)' : 'var(--cc-muted)' }}>
      {children}
    </span>
  );
}

// ------------------------------------------------------------ 1 · display

type Single = 'window' | 'fill' | 'remote';

interface DisplayChoice {
  picked: string | null;
  fill: boolean;
  single: Single;
}

/** The smallest display that is not the main one: nearly always the panel. */
function likelyPanel(displays: DisplaysPayload['displays']): string | null {
  const others = displays.filter((d) => !d.primary).sort((a, b) => a.width * a.height - b.width * b.height);
  return others[0]?.id ?? displays[0]?.id ?? null;
}

/**
 * Where the choice starts: a display already chosen other than the main one,
 * as when setup runs again, or else the likeliest panel.
 */
function startingPick(state: DisplaysPayload): { id: string | null; guessed: boolean } {
  const chosen = state.displays.find((d) => d.id === state.chosen);
  if (chosen && !chosen.primary) return { id: chosen.id, guessed: false };
  return { id: likelyPanel(state.displays), guessed: true };
}

/** What a step shows: its title, the thing itself, and what goes with it. */
interface Parts {
  intro: ReactNode;
  main: ReactNode;
  extra?: ReactNode;
}

function displayParts(state: DisplaysPayload | undefined, choice: DisplayChoice, onChoice: (c: DisplayChoice) => void, mapHeight: number): Parts {
  if (!state || state.displays.length === 0) {
    return { intro: <Title sub="Kehai is asking the system which displays are connected.">Looking for displays</Title>, main: null };
  }

  if (state.displays.length === 1) {
    const only = state.displays[0];
    const option = (id: Single, head: string, text: string) => (
      <button
        key={id}
        onClick={() => onChoice({ ...choice, picked: only.id, single: id })}
        aria-pressed={choice.single === id}
        style={{
          flex: '1 1 220px',
          minWidth: 0,
          padding: 18,
          textAlign: 'left',
          background: choice.single === id ? 'var(--cc-pane-2)' : 'var(--cc-pane)',
          border: choice.single === id ? '2px solid var(--cc-accent)' : '1px solid var(--cc-line-2)',
        }}
      >
        <div style={{ fontSize: 11, letterSpacing: '0.14em', color: choice.single === id ? 'var(--cc-accent)' : 'var(--cc-text)' }}>{head}</div>
        <div className="cc-mini" style={{ fontSize: 11, lineHeight: 1.65, marginTop: 8, color: 'var(--cc-muted)' }}>
          {text}
        </div>
      </button>
    );
    return {
      intro: (
        <Title sub="Kehai is made for a small second display, but it runs in a window just as well. Plug one in at any time and choose it under Settings → Window.">
          Only one display is connected
        </Title>
      ),
      main: <DisplayMap displays={state.displays} chosen={only.id} current={state.current} filled={state.fill} height={Math.min(mapHeight, 270)} />,
      extra: (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {option('window', 'IN A WINDOW HERE', 'Beside your work. Drag it by the top strip and it reopens where you leave it.')}
          {option('fill', 'FILL THIS DISPLAY', 'Kehai takes the whole screen. F11 gives the screen back.')}
          {option('remote', 'ANOTHER DEVICE', 'An old tablet or laptop can show the panel over your network. Settings → Remote opens once setup is done.')}
        </div>
      ),
    };
  }

  const start = startingPick(state);
  const picked = choice.picked ?? start.id;
  const target = state.displays.find((d) => d.id === picked);
  return {
    intro: (
      <Title sub="Kehai is made for a small display beside your main one. Choose it and Kehai moves there straight away, so you can see which one it is. If it is the wrong one, choose again from there.">
        Which display is Kehai for?
      </Title>
    ),
    main: (
      <DisplayMap
        displays={state.displays}
        chosen={picked}
        current={state.current}
        filled={state.fill && state.current === state.chosen}
        hint={choice.picked === null && start.guessed ? 'LOOKS LIKE THE SMALL ONE' : undefined}
        height={mapHeight}
        onPick={(id) => onChoice({ ...choice, picked: id })}
      />
    ),
    extra: (
      <Choice label="Fill the display" desc={`Fullscreen on ${target ? target.number : 'it'}, with no window edge. F11 switches it at any time.`}>
        <OnOff on={choice.fill} onPick={(fill) => onChoice({ ...choice, fill })} />
      </Choice>
    ),
  };
}

// ------------------------------------------------------------ 2 · sources

function SourcesStep({ notifyLater, onNotifyLater, agentsAnswer, onAgents }: { notifyLater: boolean; onNotifyLater: () => void; agentsAnswer: 'unused' | 'folder' | null; onAgents: (a: 'unused' | 'folder') => void }) {
  const { settings, allowNotifications, setTranscriptRoot } = useSettings();
  const cpu = useTopic<CpuPayload>('telemetry:cpu');
  // Nothing arrives while nothing plays, so silence here is a quiet player,
  // not a missing source.
  const media = useTopic<MediaPayload | null>('media:now_playing');
  const notify = useTopic<NotifyPayload>('sys:notify');
  const agents = useTopic<AgentsPayload>('dev:agents');

  const askAgain = () => bus.publish<NotifyCommand>('notify:command', 'setup', { action: 'listen' });

  let notifyRow: { dot: string; desc: ReactNode; right: ReactNode };
  if (!notify || notify.pending) {
    notifyRow = notifyLater
      ? {
          dot: 'var(--cc-line-2)',
          desc: 'Not read until you allow it, from the tile or Settings → Sources.',
          right: (
            <>
              <Status>NOT NOW</Status>
              <Button fill onClick={allowNotifications}>ALLOW</Button>
            </>
          ),
        }
      : {
          dot: 'var(--cc-accent-2)',
          desc: WINDOWS
            ? 'To show them, Kehai reads the title and text of each notification. Windows asks you once, when you press ALLOW.'
            : 'To show them, Kehai reads the title and text of each notification. Nothing is read until you press ALLOW.',
          right: (
            <>
              <Button onClick={onNotifyLater}>NOT NOW</Button>
              <Button fill onClick={allowNotifications}>ALLOW</Button>
            </>
          ),
        };
  } else if (notify.available) {
    notifyRow = { dot: 'var(--cc-ok)', desc: 'The title and text of each one, shown and never kept.', right: <Status ok>ALLOWED</Status> };
  } else {
    notifyRow = {
      dot: 'var(--cc-line-2)',
      desc: WINDOWS
        ? `Windows said no: ${notify.reason ?? 'access refused'}. Turn it on in Windows Settings → Privacy & security → Notifications, then check again.`
        : (notify.reason ?? 'This system does not let Kehai read notifications.'),
      right: <Button onClick={askAgain}>CHECK AGAIN</Button>,
    };
  }

  const found = agents?.available === true;
  let agentsRow: { dot: string; desc: ReactNode; right: ReactNode };
  if (!agents) {
    agentsRow = { dot: 'var(--cc-line-2)', desc: 'Looking for local session transcripts.', right: <Status>LOOKING</Status> };
  } else if (found) {
    agentsRow = {
      dot: 'var(--cc-ok)',
      desc: `Token usage, and which sessions wait on you, from the transcripts in ${settings.transcriptRoot ?? 'the default folder'}.`,
      right: <Status ok>FOUND</Status>,
    };
  } else if (agentsAnswer === 'unused') {
    agentsRow = { dot: 'var(--cc-line-2)', desc: 'Their tiles say so rather than showing zeroes.', right: <Status>NOT USED HERE</Status> };
  } else {
    agentsRow = {
      dot: 'var(--cc-line-2)',
      desc: `Token usage, and which sessions wait on you, from local session transcripts. ${sentence(agents.reason ?? 'none found')}.`,
      right: (
        <>
          <Button onClick={() => onAgents('unused')}>NOT USED HERE</Button>
          <Button onClick={() => onAgents('folder')}>CHOOSE FOLDER</Button>
        </>
      ),
    };
  }

  const tempKnown = cpu !== undefined && cpu.tempC !== null;

  return (
    <>
      <div style={{ borderBottom: '1px solid var(--cc-line)' }}>
        <Choice label="Processor, memory, network and disks" desc="Usage now and over the last few minutes." dot={cpu ? 'var(--cc-ok)' : 'var(--cc-line-2)'}>
          <Status ok={!!cpu}>{cpu ? 'READING' : 'LOOKING'}</Status>
        </Choice>
        <Choice
          label="Processor temperature"
          desc={
            tempKnown
              ? 'From the processor’s own sensor.'
              : WINDOWS
                ? 'On most Windows machines only a kernel driver can read it, and Kehai does not install one.'
                : 'This machine does not report it.'
          }
          dot={tempKnown ? 'var(--cc-ok)' : 'var(--cc-line-2)'}
        >
          <Status ok={tempKnown}>{tempKnown ? 'READING' : 'NOT AVAILABLE'}</Status>
        </Choice>
        <Choice
          label="Now playing"
          desc={
            MAC
              ? 'Not available on this system yet.'
              : media && media.title
                ? `Any player the system knows about, with its buttons. ${media.player || 'A player'} is ${media.playing ? 'playing' : 'paused'}.`
                : 'Any player the system knows about, with its buttons. Nothing is playing yet.'
          }
          dot={media ? 'var(--cc-ok)' : 'var(--cc-line-2)'}
        >
          <Status ok={!!media}>{media ? 'READING' : MAC ? 'NOT AVAILABLE' : 'NOTHING PLAYING'}</Status>
        </Choice>
        <Choice label="Notifications" desc={notifyRow.desc} dot={notifyRow.dot}>
          {notifyRow.right}
        </Choice>
        <Choice label="Coding agents" desc={agentsRow.desc} dot={agentsRow.dot}>
          {agentsRow.right}
        </Choice>
        {agentsAnswer === 'folder' && !found && (
          <TranscriptRootRow value={settings.transcriptRoot} onCommit={setTranscriptRoot} />
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------- 3 · layout

/** Widgets whose every topic says it has nothing to report. */
function useEmptyWidgets(): (widget: string) => boolean {
  const quota = useTopic<{ available: boolean }>('dev:llm_tokens');
  const agents = useTopic<{ available: boolean }>('dev:agents');
  const notify = useTopic<{ available: boolean }>('sys:notify');
  const empty = new Set<string>();
  if (quota?.available === false) empty.add('dev:llm_tokens');
  if (agents?.available === false) empty.add('dev:agents');
  if (notify?.available === false) empty.add('sys:notify');
  return (widget) => {
    const topics = registry[widget]?.topics ?? [];
    return topics.length > 0 && topics.every((t) => empty.has(t));
  };
}

function PresetCard({ layout, shape, chosen, suggested, isEmpty, onPick }: { layout: Layout; shape: Shape; chosen: boolean; suggested: boolean; isEmpty: (w: string) => boolean; onPick: () => void }) {
  const { grid, tiles } = layout.shapes[shape];
  const emptyCount = tiles.filter((t) => isEmpty(t.widget)).length;
  const aspect = shape === 'bar' ? 4 : shape === 'portrait' ? 0.625 : 1.6;
  return (
    <button
      onClick={onPick}
      aria-pressed={chosen}
      style={{
        flex: '1 1 0',
        minWidth: 0,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: 'var(--cc-pane)',
        border: chosen ? '2px solid var(--cc-accent)' : '1px solid var(--cc-line)',
        textAlign: 'left',
      }}
    >
      <div style={{ background: 'var(--cc-inset)', padding: 8, width: '100%' }}>
        <div
          style={{
            width: '100%',
            aspectRatio: String(aspect),
            maxHeight: shape === 'portrait' ? 260 : undefined,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
            gap: 2,
          }}
        >
          {tiles.map((t, i) => {
            const hatched = isEmpty(t.widget);
            return (
              <div
                key={i}
                style={{
                  gridArea: `${t.area[0]} / ${t.area[1]} / ${t.area[2]} / ${t.area[3]}`,
                  background: hatched
                    ? 'repeating-linear-gradient(45deg, var(--cc-line) 0 1px, transparent 1px 7px)'
                    : chosen
                      ? 'color-mix(in srgb, var(--cc-accent) 22%, var(--cc-pane))'
                      : 'var(--cc-pane-2)',
                  border: `1px ${hatched ? 'dashed var(--cc-line-2)' : `solid ${chosen ? 'var(--cc-accent)' : 'var(--cc-line-2)'}`}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  minWidth: 0,
                  minHeight: 0,
                }}
              >
                <span style={{ fontSize: 8, letterSpacing: '0.12em', padding: '0 4px', textAlign: 'center', lineHeight: 1.3, color: hatched ? 'var(--cc-muted)' : chosen ? 'var(--cc-text)' : 'var(--cc-muted)' }}>
                  {(registry[t.widget]?.name ?? t.widget).toUpperCase()}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, width: '100%' }}>
        <span style={{ fontSize: 11, letterSpacing: '0.14em', color: chosen ? 'var(--cc-accent)' : 'var(--cc-text)' }}>{layout.name.toUpperCase()}</span>
        {suggested && (
          <span style={{ fontSize: 9, letterSpacing: '0.1em', padding: '2px 6px', border: '1px solid currentColor', color: 'var(--cc-accent-2)' }}>SUGGESTED</span>
        )}
        <span style={{ flex: 1 }} />
        <span className="cc-mini">
          {tiles.length} TILES{emptyCount ? ` · ${emptyCount} EMPTY` : ''}
        </span>
      </div>
    </button>
  );
}

function Colours({ height }: { height: number }) {
  const { settings, setTheme } = useSettings();
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {THEMES.map((t) => {
        const on = settings.theme === t.id;
        const [pane, accent, second, text] = t.swatch;
        return (
          <button
            key={t.id}
            onClick={() => setTheme(t.id)}
            aria-pressed={on}
            style={{ flex: '1 1 0', minWidth: 0, height, display: 'flex', flexDirection: 'column', padding: 0, border: on ? '2px solid var(--cc-accent)' : '1px solid var(--cc-line)', background: pane }}
          >
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
              <span style={{ fontSize: 20, fontWeight: 200, color: accent }}>21:50</span>
              <span style={{ width: 6, height: 6, background: second }} />
            </div>
            <div style={{ height: 26, display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 10, letterSpacing: '0.14em', color: on ? 'var(--cc-accent)' : text }}>{t.name}</div>
          </button>
        );
      })}
    </div>
  );
}

function LayoutCards({ shape }: { shape: Shape }) {
  const { settings, useLayout } = useSettings();
  const isEmpty = useEmptyWidgets();
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: shape === 'portrait' ? 'wrap' : 'nowrap' }}>
      {PRESET_ORDER.map((id) => (
        <div key={id} style={{ flex: shape === 'portrait' ? '1 1 200px' : '1 1 0', minWidth: 0, display: 'flex' }}>
          <PresetCard layout={PRESETS[id]} shape={shape} chosen={settings.layoutId === id} suggested={id === 'stage'} isEmpty={isEmpty} onPick={() => useLayout(id)} />
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------- 4 · finish

function Key({ k, what }: { k: string; what: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span className="cc-chip" style={{ minWidth: 64, color: 'var(--cc-text)', fontSize: 10 }}>
        {k}
      </span>
      <span className="cc-mini" style={{ fontSize: 11, color: 'var(--cc-muted)' }}>
        {what}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ setup

/**
 * First run: where the panel goes, what it can read, how it looks, and the
 * few things worth deciding before it starts. Shown once, on a fresh install;
 * About → Run setup again brings it back. Every step lays itself out for the
 * shape of the display it is on, because choosing a display moves it there.
 */
export function Setup({ onDone }: { onDone: (then?: Section) => void }) {
  const { settings, setSetupDone, setAutoCheckUpdates, setAutoHideBar, setQuiet } = useSettings();
  const { shape, height } = useWindowShape();
  const displays = useTopic<DisplaysPayload>('app:displays');
  const [autostart, setAutostart] = useAutostart();

  const [at, setAt] = useState(0);
  const [choice, setChoice] = useState<DisplayChoice>({ picked: null, fill: true, single: 'window' });
  const [notifyLater, setNotifyLater] = useState(false);
  const [agentsAnswer, setAgentsAnswer] = useState<'unused' | 'folder' | null>(null);
  const [startWithSystem, setStartWithSystem] = useState(true);
  const [checkUpdates, setCheckUpdates] = useState(settings.autoCheckUpdates);
  const [hideHeader, setHideHeader] = useState(settings.autoHideBar);
  // On to begin with, like starting with the system: a panel that glows all
  // night, or shows what came in to whoever walks past, is not what anyone wants.
  const [quieter, setQuieter] = useState(true);

  const step = STEPS[at];
  const bar = shape === 'bar';
  const single = displays?.displays.length === 1;

  const finish = (then?: Section) => {
    setSetupDone(true);
    onDone(then);
  };

  const next = () => {
    if (step === 'DISPLAY' && displays && displays.displays.length > 0) {
      if (single) {
        showOn(displays.displays[0].id, choice.single === 'fill');
      } else {
        const id = choice.picked ?? startingPick(displays).id;
        if (id) showOn(id, choice.fill);
      }
    }
    if (step === 'FINISH') {
      if (autostart !== null && autostart !== startWithSystem) setAutostart(startWithSystem);
      setAutoCheckUpdates(checkUpdates);
      setAutoHideBar(hideHeader);
      setQuiet(quieter);
      finish(single && choice.single === 'remote' ? 'REMOTE' : undefined);
      return;
    }
    setAt((i) => Math.min(STEPS.length - 1, i + 1));
  };

  let nextLabel = 'NEXT';
  let hint = '';
  if (step === 'DISPLAY' && displays && displays.displays.length > 1) {
    const id = choice.picked ?? startingPick(displays).id;
    const target = displays.displays.find((d) => d.id === id);
    nextLabel = target ? `SHOW KEHAI ON ${target.number}` : 'NEXT';
    hint = target ? `${target.number} · ${displayLabel(target)} · ${target.width} × ${target.height}` : '';
  }
  if (step === 'SOURCES') hint = 'All of this stays under Settings → Sources.';
  if (step === 'LAYOUT') hint = 'Later, the layout’s name in the header switches it.';
  if (step === 'FINISH') nextLabel = 'OPEN THE PANEL';

  // In numbers, so nobody is surprised when the panel turns down at ten.
  const { fromMin, toMin } = settings.night;
  const awayMin = settings.away.afterMin ?? 10;
  const quietDesc = REMOTE_PANEL
    ? `Dims from ${hhmm(fromMin)} to ${hhmm(toMin)}, by this device’s clock. Settings → Appearance sets it.`
    : `Dims from ${hhmm(fromMin)} to ${hhmm(toMin)}, and after ${awayMin} minutes with nobody here ${
        settings.away.show === 'clock' ? 'shows only the time and what waits on you' : 'goes quiet'
      }. Settings → Appearance sets either.`;

  // What the display map gets: whatever the frame and the step's other parts leave.
  const mapHeight = bar ? Math.max(180, height - 128) : Math.max(220, Math.min(360, height - 420));

  let parts: Parts;
  switch (step) {
    case 'DISPLAY':
      parts = displayParts(displays, choice, setChoice, mapHeight);
      break;
    case 'SOURCES':
      parts = {
        intro: (
          <Title sub="Everything is read on this machine and stays on it. Anything that is missing leaves its tile saying why, never showing a zero it does not have.">
            What Kehai can read here
          </Title>
        ),
        main: <SourcesStep notifyLater={notifyLater} onNotifyLater={() => setNotifyLater(true)} agentsAnswer={agentsAnswer} onAgents={setAgentsAnswer} />,
        extra: (
          <div className="cc-mini" style={{ fontSize: 11 }}>
            The clock and the focus timer need nothing.
          </div>
        ),
      };
      break;
    case 'LAYOUT': {
      const where = `${window.innerWidth} × ${window.innerHeight}${shape === 'bar' ? ', a bar' : ` ${shape}`}`;
      parts = {
        intro: <Title sub={`Drawn for this display, ${where}, with what Kehai found here. Hatched tiles would have nothing to show.`}>Choose how it looks</Title>,
        main: <LayoutCards shape={shape} />,
        extra: (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
              <span className="cc-label">COLOURS</span>
              <span className="cc-mini">The whole screen changes as you pick.</span>
            </div>
            <Colours height={bar ? 76 : 84} />
          </div>
        ),
      };
      break;
    }
    case 'FINISH':
      parts = {
        intro: <Title sub="Each of these is under Settings later, and so is this setup: About → Run setup again.">Last few things</Title>,
        main: (
          <div style={{ borderBottom: '1px solid var(--cc-line)' }}>
            {!REMOTE_PANEL && autostart !== null && (
              <Choice label={WINDOWS ? 'Start with Windows' : 'Start when you sign in'} desc="Kehai opens on its display when you sign in. Written to the system, not to these settings.">
                <OnOff on={startWithSystem} onPick={setStartWithSystem} />
              </Choice>
            )}
            <Choice label={REMOTE_PANEL ? 'Dim at night' : 'Quieter at night and when you’re away'} desc={quietDesc}>
              <OnOff on={quieter} onPick={setQuieter} />
            </Choice>
            {!REMOTE_PANEL && (
              <Choice label="Check for updates once a day" desc="Asks GitHub for the latest release, the only request Kehai makes. Off unless you turn it on.">
                <OnOff on={checkUpdates} onPick={setCheckUpdates} />
              </Choice>
            )}
            <Choice label="Hide the header" desc="It slides away, and comes back when you reach the top edge.">
              <OnOff on={hideHeader} onPick={setHideHeader} />
            </Choice>
          </div>
        ),
        extra: (
          <div>
            <div className="cc-label">WORTH KNOWING</div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(max(${bar ? 220 : 300}px, 45%), 1fr))`, gap: '12px 40px', marginTop: 14 }}>
              <Key k="S" what="Settings, and back to the panel" />
              <Key k="F11" what="Fullscreen, or a window again" />
              <Key k="ESC" what="Back to the panel from anywhere" />
              <Key k="SWIPE" what="Along the header, for the next layout" />
            </div>
          </div>
        ),
      };
      break;
  }

  const buttons = (
    <>
      {at > 0 ? (
        <button className="cc-chip" style={{ height: 40, minWidth: 110, fontSize: 10 }} onClick={() => setAt((i) => i - 1)}>
          BACK
        </button>
      ) : (
        <span style={{ width: 110 }} />
      )}
      <span className="cc-mini" style={{ flex: 1, textAlign: 'center', fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {hint}
      </span>
      <button className="cc-chip cc-chip-on" style={{ height: 40, minWidth: 150, padding: '0 20px', fontSize: 10 }} onClick={next}>
        {nextLabel}
      </button>
    </>
  );

  const skip = (
    <button className="cc-chip" style={{ height: bar ? 26 : 28, marginRight: isTauri() ? 6 : 18, fontSize: 10, padding: '0 12px' }} onClick={() => finish()}>
      SKIP SETUP
    </button>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--cc-bg)' }}>
      <div
        data-tauri-drag-region
        style={{
          height: bar ? 32 : 40,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          paddingLeft: 18,
          background: 'var(--cc-pane)',
          borderBottom: '1px solid var(--cc-line)',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--cc-accent)" strokeWidth="1.8" strokeLinejoin="round">
          <path d="M8 1.4 14.6 8 8 14.6 1.4 8Z" />
        </svg>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.24em' }}>KEHAI</span>
        <span className="cc-label">· SETUP</span>
        {bar && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginLeft: 28 }}>
            <Steps at={at} inline />
          </div>
        )}
        <div style={{ flex: 1 }} />
        {skip}
        {isTauri() && <WindowControls />}
      </div>
      {!bar && (
        <div
          style={{
            height: 46,
            flex: 'none',
            display: 'flex',
            alignItems: 'stretch',
            paddingLeft: 18,
            background: 'var(--cc-inset)',
            borderBottom: '1px solid var(--cc-line)',
            overflowX: 'auto',
          }}
        >
          <Steps at={at} inline={false} />
        </div>
      )}
      {bar ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 36, padding: '20px 32px' }}>
          <div style={{ width: 500, flex: 'none', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
            {parts.intro}
            {parts.extra && <div style={{ marginTop: 'auto' }}>{parts.extra}</div>}
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>{parts.main}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 'none' }}>{buttons}</div>
          </div>
        </div>
      ) : (
        <>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20, padding: '30px 40px 24px' }}>
            {parts.intro}
            {parts.main}
            {parts.extra}
          </div>
          <div
            style={{
              height: 68,
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '0 40px',
              background: 'var(--cc-pane)',
              borderTop: '1px solid var(--cc-line)',
            }}
          >
            {buttons}
          </div>
        </>
      )}
    </div>
  );
}
