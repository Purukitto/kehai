import { useEffect, useState } from 'react';
import { PairPrompt } from './components/PairPrompt';
import { WindowControls } from './components/WindowControls';
import { bus } from './core/bus';
import { startMockSource } from './core/mockSource';
import type { FlowCommand, QuotaCommand, RemoteCommand, UpdateCommand, UpdatePayload } from './core/payloads';
import { REMOTE_PANEL as REMOTE, startRemoteSource } from './core/remoteSource';
import type { RemoteLink } from './core/remoteSource';
import { useSettings } from './core/settings';
import { ENGINE_TOPICS, isTauri, startTauriSource } from './core/tauriSource';
import { useTopic } from './core/useTopic';
import { useWindowShape } from './core/useWindowShape';
import { Arranger } from './grid/Arranger';
import { Grid } from './grid/Grid';
import { SettingsScreen } from './settings/SettingsScreen';
import type { Section } from './settings/SettingsScreen';

type Mode = 'dashboard' | 'settings' | 'arrange';

async function toggleFullscreen(): Promise<void> {
  // A remote panel is a browser tab, often on a tablet: the page's own
  // fullscreen is the only one there is.
  if (!isTauri()) {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    return;
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  await win.setFullscreen(!(await win.isFullscreen()));
}

export default function App() {
  const { settings, layout } = useSettings();
  const { shape } = useWindowShape();
  const autoHide = settings.autoHideBar;
  const [mode, setMode] = useState<Mode>('dashboard');
  const [settingsAt, setSettingsAt] = useState<Section | undefined>(undefined);
  // Which layout the arranger was opened on: Settings can arrange one that is
  // not on screen.
  const [arranging, setArranging] = useState(settings.layoutId);
  const [engine, setEngine] = useState(false);
  const [remote, setRemote] = useState<RemoteLink>({ state: 'connecting' });
  const update = useTopic<UpdatePayload>('app:update');

  // Under Tauri the Rust engine owns the topics it can actually source, and the
  // mock fills the rest until each poller lands. A remote panel gets the same
  // topics from another machine's engine. In a plain browser the mock covers
  // everything.
  useEffect(() => {
    const live = isTauri();
    setEngine(live);
    const stopMock = startMockSource({ skip: live || REMOTE ? ENGINE_TOPICS : [] });

    if (REMOTE) {
      const stopRemote = startRemoteSource(setRemote);
      return () => {
        stopRemote();
        stopMock();
      };
    }
    if (!live) return stopMock;

    let stopBridge: (() => void) | undefined;
    let cancelled = false;
    startTauriSource()
      .then((stop) => {
        if (cancelled) stop();
        else stopBridge = stop;
      })
      .catch((err) => {
        // A denied capability or a missing bridge must be loud, not a widget
        // quietly showing a dash forever.
        console.error('engine bridge failed to attach', err);
        setEngine(false);
      });

    return () => {
      cancelled = true;
      stopBridge?.();
      stopMock();
    };
  }, []);

  // The engine reads transcripts from wherever this says, and has no other way
  // to learn it. On launch this runs before the bridge above has attached; the
  // bus retains the command, so the bridge forwards it as soon as it subscribes,
  // ahead of its hello.
  //
  // None of these settings reach the engine from a remote panel: they belong
  // to the machine it is watching, and the host would refuse them anyway.
  useEffect(() => {
    if (REMOTE) return;
    bus.publish<QuotaCommand>('quota:command', 'settings', {
      action: 'set_root',
      path: settings.transcriptRoot,
    });
  }, [settings.transcriptRoot]);

  // Same arrangement as the transcript folder: the engine starts with automatic
  // checks off and learns the stored choice from this, retained until the
  // bridge forwards it.
  useEffect(() => {
    if (REMOTE) return;
    bus.publish<UpdateCommand>('update:command', 'settings', {
      action: 'set_auto',
      on: settings.autoCheckUpdates,
    });
  }, [settings.autoCheckUpdates]);

  // And the focus timer's block lengths. The engine waits a moment for these
  // before showing the timer, so the first countdown is already the right one.
  const { focusMin, breakMin, sprints } = settings.focus;
  useEffect(() => {
    if (REMOTE) return;
    bus.publish<FlowCommand>('flow:command', 'settings', { action: 'configure', focusMin, breakMin, sprints });
  }, [focusMin, breakMin, sprints]);

  // And whether to serve remote panels at all.
  const { on: serveOn, port: servePort, control: serveControl } = settings.remote;
  useEffect(() => {
    if (REMOTE) return;
    bus.publish<RemoteCommand>('remote:command', 'settings', {
      action: 'configure',
      on: serveOn,
      port: servePort,
      control: serveControl,
    });
  }, [serveOn, servePort, serveControl]);

  // Opening settings from the update badge lands on About. Every other way in,
  // including back from the arranger, starts where it always has.
  useEffect(() => {
    if (mode !== 'settings') setSettingsAt(undefined);
  }, [mode]);

  useEffect(() => {
    document.documentElement.className = 't-' + settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.tagName === 'INPUT';
      if (typing) return;

      if (e.key === 'Escape') setMode('dashboard');
      if (e.key === 's' || e.key === 'S') setMode((m) => (m === 'settings' ? 'dashboard' : 'settings'));
      if (e.key === 'F11') {
        e.preventDefault();
        // A browser can refuse fullscreen; there is nothing to do about it.
        toggleFullscreen().catch(() => undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (mode === 'settings') {
    return (
      <SettingsScreen
        initialSection={settingsAt}
        onClose={() => setMode('dashboard')}
        onArrange={(id) => {
          setArranging(id);
          setMode('arrange');
        }}
      />
    );
  }

  if (mode === 'arrange') {
    return <Arranger layoutId={arranging} initialShape={shape} onDone={() => setMode('settings')} />;
  }

  // What the header says the panel is reading. A remote panel says more,
  // because it can be up and still not be showing anything real.
  const source = REMOTE
    ? remote.state === 'live'
      ? { live: true, label: remote.control ? 'REMOTE' : 'REMOTE · VIEW ONLY', title: 'Showing ' + location.host }
      : remote.state === 'unpaired'
        ? { live: false, label: 'NOT PAIRED', title: remote.reason }
        : {
            live: false,
            label: remote.state === 'offline' ? 'REMOTE · OFFLINE' : 'REMOTE · CONNECTING',
            title: 'Reaching ' + location.host,
          }
    : engine
      ? { live: true, label: 'ENGINE', title: 'Rust engine connected' }
      : { live: false, label: 'MOCK', title: 'Mock source' };

  const bar = (
      <div
        data-tauri-drag-region
        className="cc-topbar"
        style={{
          height: 32,
          flex: autoHide ? undefined : 'none',
          width: autoHide ? '100%' : undefined,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '0 0 0 18px',
          background: 'var(--cc-pane)',
          borderBottom: '1px solid var(--cc-line)',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--cc-accent)" strokeWidth="1.8" strokeLinejoin="round">
          <path d="M8 1.4 14.6 8 8 14.6 1.4 8Z" />
        </svg>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.24em' }}>KEHAI</span>
        <div style={{ flex: 1 }} />
        {update?.state === 'available' && (
          // Waits to be noticed rather than asking: a panel read sideways has no
          // business flashing for attention.
          <button
            className="cc-chip"
            style={{ padding: '5px 10px', marginRight: 4, color: 'var(--cc-accent)', borderColor: 'var(--cc-accent)' }}
            onClick={() => {
              setSettingsAt('ABOUT');
              setMode('settings');
            }}
            title={`Version ${update.latest} is available`}
          >
            UPDATE
          </button>
        )}
        <span
          style={{ width: 5, height: 5, flex: 'none', background: source.live ? 'var(--cc-ok)' : 'var(--cc-line-2)' }}
          title={source.title}
        />
        <span className="cc-mini" style={{ fontSize: 10 }} title={source.title}>
          {source.label}
        </span>
        <span className="cc-mini" style={{ fontSize: 10 }}>
          {layout.name.toUpperCase()}
        </span>
        <button
          className="cc-chip"
          style={{ padding: '5px 10px', marginLeft: 4 }}
          onClick={() => setMode('settings')}
          title="Settings (S)"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <circle cx="8" cy="8" r="2.4" />
            <path d="M8 1.4v2M8 12.6v2M1.4 8h2M12.6 8h2M3.3 3.3l1.4 1.4M11.3 11.3l1.4 1.4M12.7 3.3l-1.4 1.4M4.7 11.3l-1.4 1.4" />
          </svg>
        </button>
        {isTauri() && <WindowControls />}
      </div>
  );

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--cc-bg)',
        position: 'relative',
      }}
    >
      {autoHide ? <div className="cc-barzone">{bar}</div> : bar}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {/* Keyed by shape: a tile that moves to another shape starts afresh, rather
            than keeping a breakpoint its old size decided. */}
        <Grid key={shape} arrangement={layout.shapes[shape]} />
        {REMOTE && remote.state === 'unpaired' && <PairPrompt reason={remote.reason} />}
      </div>
    </div>
  );
}
