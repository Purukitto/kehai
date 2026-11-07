import { bus } from './bus';
import { startMockGame } from './mockGame';
import type {
  AgentCommand,
  AgentJumped,
  AgentsPayload,
  AgentVia,
  ArtPayload,
  BacklightCommand,
  BacklightPayload,
  ClockPayload,
  CpuPayload,
  DiskPayload,
  DisplayCommand,
  DockAppsPayload,
  DockCommand,
  DockIconsPayload,
  DockOpened,
  DockPicked,
  DockPins,
  DockStatePayload,
  DisplaysPayload,
  FlowCommand,
  LogCommand,
  LogCopyPayload,
  LogPayload,
  MediaCommand,
  MediaPayload,
  GpuCard,
  GpuCommand,
  GpuPayload,
  MemPayload,
  MicCommand,
  MicPayload,
  NetPayload,
  NotifyCommand,
  NotifyItem,
  NotifyOpened,
  NotifyPayload,
  NotifyRules,
  PresenceCommand,
  PresencePayload,
  QuotaPayload,
  RemoteCommand,
  RemotePayload,
  SprintPayload,
  UpdateCommand,
  UpdatePayload,
  VolumePayload,
  WindowCommand,
  WindowPayload,
} from './payloads';

/**
 * Stand-in for the Rust integration engine, used in a plain browser and for any
 * topic the engine does not source yet.
 *
 * It publishes the same envelopes on the same topics, so nothing in the UI
 * changes as each real poller lands — the topic simply moves to the skip list.
 */

export interface MockOptions {
  /** Topics the real engine already owns. The mock stays out of their way. */
  skip?: string[];
}

function wave(t: number, seed: number, lo: number, hi: number): number {
  const v =
    0.5 +
    0.28 * Math.sin(t * 0.41 + seed) +
    0.16 * Math.sin(t * 1.13 + seed) +
    0.1 * Math.sin(t * 2.7 + seed);
  return Math.round(lo + (hi - lo) * Math.max(0, Math.min(1, v)));
}

const GIB = 1024 * 1024 * 1024;

export function startMockSource(options: MockOptions = {}): () => void {
  const skip = new Set(options.skip ?? []);
  const pub = <T,>(topic: string, src: string, data: T) => {
    if (!skip.has(topic)) bus.publish<T>(topic, src, data);
  };

  let t = 0;
  const timers: number[] = [];

  // A card in a game: ?gpu=none for a PC without one, ?gpu=hot past its
  // warning point, ?gpu=nosensor for one whose driver reports no sensors.
  // The PC has the two cards the author's does, so the choice shows; picking
  // the integrated one reads as a card without sensors.
  const gpuMode = new URLSearchParams(location.search).get('gpu');
  const gpuLoad = (at: number) => wave(at, 3, 34, 92);
  const gpuHistory = Array.from({ length: 60 }, (_, i) => gpuLoad(i - 60));
  const GPU_CARDS: GpuCard[] = [
    { id: '10de:2783:413a1458', name: 'NVIDIA GeForce RTX 4070 SUPER' },
    { id: '8086:4682:d0001458', name: 'Intel(R) UHD Graphics 730' },
  ];
  let gpuPicked: string | null = null;
  const unsubGpu = bus.subscribe('gpu:command', (e) => {
    const c = e.data as GpuCommand;
    if (c.action === 'pick') gpuPicked = c.card;
  });

  // The display Kehai is for answers DDC/CI, as the author's panel does.
  // ?backlight=none for a display that doesn't, ?backlight=missing for Kehai
  // on the main display while its own is gone, ?backlight=os for a system
  // Kehai can't do it on yet.
  const backlightMode = new URLSearchParams(location.search).get('backlight');
  const BACKLIGHT_WHY: Record<string, string> = {
    none: 'This display doesn’t let programs set its brightness, so at night Kehai darkens what it draws instead.',
    missing: 'Kehai is on the main display while its own is missing, and leaves the brightness of every display alone until it’s back.',
    os: 'Kehai can’t set a display’s brightness on this system yet, so at night it darkens what it draws instead.',
  };
  let backlightYours = 80;
  let backlightHold: number | null = null;
  const pubBacklight = () =>
    pub<BacklightPayload>(
      'app:backlight',
      'mock.backlight',
      backlightMode && BACKLIGHT_WHY[backlightMode]
        ? { available: false, reason: BACKLIGHT_WHY[backlightMode], yours: null, now: null }
        : { available: true, reason: null, yours: backlightYours, now: backlightHold ?? backlightYours }
    );
  const unsubBacklight = bus.subscribe('backlight:command', (e) => {
    const c = e.data as BacklightCommand;
    if (c.action === 'set') backlightYours = Math.max(0, Math.min(100, Math.round(c.level)));
    if (c.action === 'hold') backlightHold = c.level;
    pubBacklight();
  });
  pubBacklight();

  const media: MediaPayload = {
    playing: true,
    title: 'Low Orbit Ferry',
    artist: 'Meridian Field',
    elapsedSec: 134,
    durationSec: 348,
    hasArt: true,
    player: 'Spotify',
    playerApp: 'spotify',
    canSeek: true,
  };
  const volume: VolumePayload = { level: 40, muted: false };

  // Walks the same states as `flow.rs`, a second at a time, so the timer's
  // controls can be built and reviewed without the engine.
  const flow = { focusMin: 25, breakMin: 5 };
  const sprint: SprintPayload = {
    state: 'running',
    mode: 'focus',
    remainingSec: 1122,
    lengthSec: 1500,
    index: 3,
    total: 4,
    focusedTodaySec: 15120,
  };
  const pubSprint = () => pub<SprintPayload>('flow:pomodoro', 'mock.flow', { ...sprint });
  const idle = () => {
    sprint.state = 'idle';
    sprint.remainingSec = sprint.lengthSec;
  };
  const finish = (running: boolean) => {
    if (sprint.mode === 'focus') {
      sprint.mode = 'break';
      sprint.lengthSec = flow.breakMin * 60;
      sprint.remainingSec = sprint.lengthSec;
      sprint.state = running ? 'running' : 'idle';
    } else {
      sprint.mode = 'focus';
      sprint.index = sprint.index >= sprint.total ? 1 : sprint.index + 1;
      sprint.lengthSec = flow.focusMin * 60;
      idle();
    }
  };

  const tick = () => {
    t += 1;

    pub<CpuPayload>('telemetry:cpu', 'mock.cpu', {
      pct: wave(t, 0, 18, 48),
      threads: Array.from({ length: 16 }, (_, i) => wave(t + i * 3, i, 8, 95)),
      clockGhz: 4.21,
      tempC: 61,
    });

    pub<MemPayload>('telemetry:mem', 'mock.mem', {
      usedGib: 18.4,
      totalGib: 32,
      swapUsedGib: 0.4,
      swapTotalGib: 8,
    });

    gpuHistory.push(gpuLoad(t));
    gpuHistory.splice(0, gpuHistory.length - 60);
    const sensors = gpuMode !== 'nosensor' && gpuPicked !== GPU_CARDS[1].id;
    const shown = sensors ? GPU_CARDS[0] : GPU_CARDS[1];
    pub<GpuPayload>(
      'telemetry:gpu',
      'mock.gpu',
      gpuMode === 'none'
        ? {
            available: false,
            name: '',
            card: '',
            pct: 0,
            engine: '',
            memUsedGib: 0,
            memTotalGib: 0,
            tempC: null,
            warnC: null,
            fanRpm: null,
            powerPct: null,
            history: [],
            cards: [],
          }
        : {
            available: true,
            name: shown.name,
            card: shown.id,
            cards: GPU_CARDS,
            pct: gpuLoad(t),
            engine: '3d',
            // Integrated graphics shares the system's memory, and counts it.
            memUsedGib: sensors ? 9.4 : 1.2,
            memTotalGib: sensors ? 12 : 16.1,
            tempC: !sensors ? null : gpuMode === 'hot' ? wave(t, 4, 85, 88) : wave(t, 4, 56, 64),
            warnC: sensors ? 84 : null,
            fanRpm: sensors ? wave(t, 6, 1480, 1720) : null,
            powerPct: sensors ? wave(t, 7, 38, 74) : null,
            history: [...gpuHistory],
          }
    );

    pub<NetPayload>('telemetry:net', 'mock.net', {
      rxBytesPerSec: wave(t, 5, 200_000, 12_000_000),
      txBytesPerSec: wave(t, 9, 40_000, 2_400_000),
      active: [{ name: 'mock0', rxBytesPerSec: 1_240_000, txBytesPerSec: 610_000 }],
    });

    if (media.playing) media.elapsedSec = (media.elapsedSec + 1) % media.durationSec;
    pub<MediaPayload>('media:now_playing', 'mock.media', { ...media });

    if (sprint.state === 'running') {
      sprint.remainingSec -= 1;
      if (sprint.mode === 'focus') sprint.focusedTodaySec += 1;
      if (sprint.remainingSec <= 0) finish(true);
    }
    pubSprint();

    pub<ClockPayload>('os:clock', 'clock', { iso: new Date().toISOString() });
    lookPresence();
  };

  const slowTick = () => {
    pub<DiskPayload>('telemetry:disk', 'mock.disk', {
      volumes: [
        { name: 'nvme0', mount: 'C:\\', usedBytes: 612 * GIB, totalBytes: 1024 * GIB },
        { name: 'nvme1', mount: 'D:\\', usedBytes: 1900 * GIB, totalBytes: 4096 * GIB },
      ],
    });

    pubNotify();

    pub<QuotaPayload>('dev:llm_tokens', 'mock.quota', {
      available: true,
      reason: null,
      provider: 'Mock agent',
      tokensIn: 1_240_000,
      tokensOut: 186_000,
      cacheRead: 812_000,
      cacheWrite: 96_000,
      requests: 312,
      windowHours: 5,
      blockStartMs: Date.now() - 11_520_000,
      resetsInMs: 6_480_000,
      burnPerMin: 24_600,
      models: [
        { model: 'mock-large', tokens: 970_000 },
        { model: 'mock-small', tokens: 456_000 },
      ],
      history: Array.from({ length: 56 }, (_, i) => wave(i, 3, 8, 96) * 1000),
      budgetTokens: null,
    });
  };

  // Nothing until the go-ahead, as the engine does, so setup's Allow can be
  // tried in a browser. The rules apply here as the engine applies them.
  let listening = false;
  let rules: NotifyRules['apps'] = {};
  const at = Date.now();
  // `?notify=fail` answers every open with a refusal; `?notify=nolist` is a
  // Windows that won't open its own list on request, so those rows don't open;
  // `?notify=today` is the tile before any of it, when no row opens.
  const notifyMode = new URLSearchParams(location.search).get('notify');
  const note = (id: number, app: string, source: string, title: string, body: string, ago: number, opens: NotifyItem['opens'] = 'app'): NotifyItem => ({
    id,
    app,
    source,
    title,
    body,
    atMs: at - ago,
    nameOnly: false,
    opens: notifyMode === 'today' || (opens === 'list' && notifyMode === 'nolist') ? null : opens,
  });
  let tray: NotifyItem[] = [
    note(1, 'ci', 'Continuous Integration', 'build #2841 passed', 'windows-msvc, 3m 12s', 60_000),
    note(2, 'chat', 'Chat', 'standup moved to 15:30', '', 120_000),
    note(6, 'windows', 'Windows', 'Restart to finish installing updates', 'Pick a time, or restart now', 180_000, 'list'),
    note(3, 'git', 'Git', 'pushed 4 commits', 'origin/feat/event-bus', 240_000),
    note(4, 'chat', 'Chat', 'lunch?', 'in ten', 600_000),
    note(5, 'chat', 'Chat', 'are you around', '', 900_000),
  ];
  // Chat sits in the tray with no window, so opening it starts it as the
  // Start menu would; the others have a window to bring forward.
  const howOpen = (i: NotifyItem): NotifyOpened['how'] => (i.opens === 'list' ? 'list' : i.app === 'chat' ? 'started' : 'front');
  const onTile = () =>
    tray.flatMap((i) => {
      const rule = rules[i.app] ?? 'show';
      return rule === 'hide' ? [] : rule === 'name' ? [{ ...i, title: '', body: '', nameOnly: true }] : [i];
    });
  const pubNotify = () => {
    const apps = [...new Set(tray.map((i) => i.app))].map((id) => {
      const mine = tray.filter((i) => i.app === id);
      return { id, name: mine[0].source, count: mine.length, lastMs: Math.max(...mine.map((i) => i.atMs)) };
    });
    pub<NotifyPayload>(
      'sys:notify',
      'mock.notify',
      listening
        ? { available: true, pending: false, reason: null, items: onTile(), apps, withheld: false }
        : { available: false, pending: true, reason: 'not allowed yet', items: [], apps: [], withheld: false }
    );
  };
  const unsubNotify = bus.subscribe('notify:command', (e) => {
    const cmd = e.data as NotifyCommand;
    if (cmd.action === 'listen' && !listening) listening = true;
    else if (cmd.action === 'open') {
      // Opened as the engine would: only what the tile shows, and a row whose
      // app came forward is cleared once it has said so.
      const shownNow = onTile();
      const item = shownNow.find((i) => i.id === cmd.id);
      if (!item?.opens) return;
      const ok = notifyMode !== 'fail';
      const how = ok ? howOpen(item) : null;
      window.setTimeout(() => pub<NotifyOpened>('notify:opened', 'mock.notify', { id: item.id, ok, how, reason: ok ? null : 'the window would not come forward' }), 120);
      if (ok && how !== 'list') {
        const may = new Set(shownNow.map((i) => i.id));
        window.setTimeout(() => {
          tray = tray.filter((i) => !(may.has(i.id) && cmd.ids.includes(i.id)));
          pubNotify();
        }, 120 + 1_500);
      }
      return;
    } else if (cmd.action === 'dismiss' || cmd.action === 'clear') {
      const may = new Set(onTile().map((i) => i.id));
      const ids = cmd.action === 'dismiss' ? [cmd.id] : (cmd.ids ?? [...may]);
      tray = tray.filter((i) => !(may.has(i.id) && ids.includes(i.id)));
    } else return;
    pubNotify();
  });
  const unsubRules = bus.subscribe('notify:rules', (e) => {
    rules = (e.data as NotifyRules).apps;
    if (listening) pubNotify();
  });

  // A desk of three, arranged as the system would: the main monitor, a laptop
  // to its left and the small panel to its right. Choosing one moves the
  // pretend window there at once.
  const displays: DisplaysPayload = {
    displays: [
      { id: 'mock-main', number: 1, name: 'U27 MONITOR', x: 0, y: 0, width: 2560, height: 1440, scale: 1, primary: true },
      { id: 'mock-panel', number: 2, name: 'T10 PANEL', x: 2560, y: 640, width: 1280, height: 800, scale: 1, primary: false },
      { id: 'mock-laptop', number: 3, name: 'Built-in display', x: -1920, y: 240, width: 1920, height: 1200, scale: 1.5, primary: false },
    ],
    current: 'mock-main',
    chosen: 'mock-main',
    chosenName: 'U27 MONITOR',
    chosenNumber: 1,
    missing: false,
    fill: false,
  };
  const pubDisplays = () => pub<DisplaysPayload>('app:displays', 'mock.display', { ...displays });
  const unsubDisplay = bus.subscribe('display:command', (e) => {
    const command = e.data as DisplayCommand;
    const found = displays.displays.find((d) => d.id === command.id);
    if (command.action !== 'show' || !found) return;
    Object.assign(displays, {
      current: found.id,
      chosen: found.id,
      chosenName: found.name,
      chosenNumber: found.number,
      missing: false,
      fill: command.fill,
    });
    pubDisplays();
  });

  // Away as the engine decides it, from this browser's own input, so the quiet
  // panel can be tried without the engine. Like the engine it publishes only
  // changes, so a state published by hand while reviewing stays until the next
  // input puts it right.
  // `?fullscreen`: a game fills the main display, so taps that take the front ask twice.
  const FULL_SCREEN = new URLSearchParams(location.search).has('fullscreen');
  let awayAfterMs: number | null = null;
  let lastInput = Date.now();
  let decided: PresencePayload['state'] | null = null;
  let shown: PresencePayload['state'] | null = null;
  const unsubShown = bus.subscribe('os:presence', (e) => {
    shown = (e.data as PresencePayload).state;
  });
  const lookPresence = (correct = false) => {
    const state = awayAfterMs !== null && Date.now() - lastInput >= awayAfterMs ? 'away' : 'here';
    if (state !== decided || (correct && state !== shown)) {
      pub<PresencePayload>('os:presence', 'mock.presence', { available: true, reason: null, state, fullscreen: FULL_SCREEN });
    }
    decided = state;
  };
  const onInput = () => {
    lastInput = Date.now();
    lookPresence(true);
  };
  const INPUT = ['pointerdown', 'pointermove', 'keydown', 'wheel'];
  INPUT.forEach((type) => window.addEventListener(type, onInput, { capture: true, passive: true }));
  const unsubPresence = bus.subscribe('presence:command', (e) => {
    const { awayAfterSec } = e.data as PresenceCommand;
    awayAfterMs = awayAfterSec === null ? null : awayAfterSec * 1000;
    lookPresence();
  });

  // One session per state, in the order the engine sorts them. The last one
  // goes back and forth between working and a tool call, so both can be seen
  // changing without the engine.
  //
  // `?agents=today` draws the list as it is without the agent's session
  // files: nothing to tap, and a session closed since still says it waits.
  // `?agents=fail` answers every jump with a refusal.
  const started = Date.now();
  const agentsMode = new URLSearchParams(location.search).get('agents');
  const plain = agentsMode === 'today';
  let busyFlip = false;
  const pubAgents = () => {
    busyFlip = !busyFlip;
    const now = Date.now();
    const sessions: AgentsPayload['sessions'] = [
      { id: 'm1', project: 'kehai', worktree: 'agent-sessions', state: 'waiting', sinceMs: started - 192_000, subagents: 0, via: 'desktop' },
      { id: 'm2', project: 'api-gateway', worktree: null, state: 'tool', sinceMs: started - 38_000, subagents: 2, via: 'vscode' },
      busyFlip
        ? { id: 'm3', project: 'dotfiles', worktree: null, state: 'working', sinceMs: started - 251_000, subagents: 0, via: 'terminal' }
        : { id: 'm3', project: 'dotfiles', worktree: null, state: 'tool', sinceMs: now, subagents: 0, via: 'terminal' },
    ];
    if (plain) {
      sessions.splice(1, 0, { id: 'm0', project: 'notes', worktree: null, state: 'waiting', sinceMs: started - 2_460_000, subagents: 0, via: null });
      sessions.forEach((s) => (s.via = null));
    }
    pub<AgentsPayload>('dev:agents', 'mock.agents', { available: true, reason: null, sessions });
  };
  pubAgents();
  timers.push(window.setInterval(pubAgents, 20_000));

  // A jump, answered as the engine would once the window is in front.
  const unsubJump = bus.subscribe('agents:command', (e) => {
    const { id } = e.data as AgentCommand;
    const via = (bus.peek<AgentsPayload>('dev:agents')?.data.sessions.find((s) => s.id === id)?.via ?? null) as AgentVia | null;
    const ok = agentsMode !== 'fail' && via !== null;
    window.setTimeout(
      () => pub<AgentJumped>('agents:jumped', 'mock.agents', { id, ok, via, reason: ok ? null : 'the window would not come forward' }),
      120
    );
  });

  // media:command is the one topic the UI publishes. The engine owns the side
  // effect; here we reflect it back so the transport feels connected.
  const unsub = bus.subscribe('media:command', (e) => {
    const command = e.data as MediaCommand;
    if (command.action === 'playpause') media.playing = !media.playing;
    if (command.action === 'seek') media.elapsedSec = Math.min(media.durationSec, Math.max(0, Math.round(command.positionSec)));
    if (command.action === 'volume') Object.assign(volume, { level: Math.round(command.level), muted: false });
    if (command.action === 'mute') volume.muted = command.muted;
    pub<MediaPayload>('media:now_playing', 'mock.media', { ...media });
    pub<VolumePayload>('media:volume', 'mock.media', { ...volume });
  });
  pub<VolumePayload>('media:volume', 'mock.media', { ...volume });

  const unsubFlow = bus.subscribe('flow:command', (e) => {
    const command = e.data as FlowCommand;
    switch (command.action) {
      case 'start':
        sprint.state = 'running';
        break;
      case 'pause':
        if (sprint.state === 'running') sprint.state = 'paused';
        break;
      case 'skip':
        finish(sprint.state === 'running');
        break;
      case 'reset':
        sprint.mode = 'focus';
        sprint.index = 1;
        sprint.lengthSec = flow.focusMin * 60;
        idle();
        break;
      case 'configure':
        flow.focusMin = command.focusMin;
        flow.breakMin = command.breakMin;
        sprint.total = command.sprints;
        sprint.index = Math.min(sprint.index, sprint.total);
        if (sprint.state === 'idle') {
          sprint.lengthSec = (sprint.mode === 'focus' ? flow.focusMin : flow.breakMin) * 60;
          sprint.remainingSec = sprint.lengthSec;
        }
        break;
    }
    pubSprint();
  });

  // Walks the same states the engine does, so Settings → About can be built
  // and reviewed without a release to update to.
  const update: UpdatePayload = {
    current: '0.1.0',
    state: 'idle',
    latest: null,
    notes: null,
    installable: true,
    reason: null,
    progress: null,
    checkedAtMs: null,
    error: null,
    auto: false,
  };
  const pubUpdate = () => pub<UpdatePayload>('app:update', 'mock.update', { ...update });
  const unsubUpdate = bus.subscribe('update:command', (e) => {
    const command = e.data as UpdateCommand;
    if (command.action === 'set_auto') {
      update.auto = command.on;
      pubUpdate();
    }
    if (command.action === 'check') {
      update.state = 'checking';
      pubUpdate();
      timers.push(
        window.setTimeout(() => {
          Object.assign(update, {
            state: 'available',
            latest: '0.2.0',
            // Shaped like a real CHANGELOG.md section, wrapped bullet included.
            notes: [
              '### Added',
              '',
              '- Kehai can update itself. **Settings → About** checks for a new version and installs',
              '  it: Kehai closes, updates and opens again.',
              '',
              '### Fixed',
              '',
              '- Settings → About shows the version you are actually running.',
            ].join('\n'),
            checkedAtMs: Date.now(),
          });
          pubUpdate();
        }, 700)
      );
    }
    if (command.action === 'install' && update.state === 'available') {
      update.state = 'downloading';
      update.progress = 0;
      pubUpdate();
      const id = window.setInterval(() => {
        update.progress = Math.min(1, (update.progress ?? 0) + 0.1);
        if (update.progress >= 1) {
          window.clearInterval(id);
          // The real engine exits here and the installer reopens the new
          // version. The mock just becomes it.
          Object.assign(update, {
            state: 'current',
            current: update.latest ?? update.current,
            latest: null,
            notes: null,
            progress: null,
          });
        }
        pubUpdate();
      }, 250);
      timers.push(id);
    }
  });

  // Pretends to serve, so Settings → Remote can be built without the engine.
  // Nothing listens: the links lead nowhere.
  const remote: RemotePayload = {
    on: false,
    listening: false,
    port: 5280,
    name: 'DESKTOP-PURU',
    addresses: [],
    key: null,
    control: false,
    clients: 0,
    error: null,
  };
  const mockKey = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const unsubRemote = bus.subscribe('remote:command', (e) => {
    const command = e.data as RemoteCommand;
    if (command.action === 'configure') {
      Object.assign(remote, { on: command.on, listening: command.on, port: command.port, control: command.control });
    }
    if (command.action === 'new_key' || (remote.on && !remote.key)) remote.key = mockKey();
    const at = (adapter: string, ip: string, virtual = false) => ({
      adapter,
      ip,
      virtual,
      link: `http://${ip}:${remote.port}/#key=${remote.key}&name=${remote.name}`,
    });
    remote.addresses = remote.listening
      ? [at('Ethernet', '192.168.1.20'), at('Wi-Fi', '192.168.1.34'), at('vEthernet (WSL)', '172.28.160.1', true)]
      : [];
    pub<RemotePayload>('app:remote', 'mock.remote', { ...remote });
  });

  // Sits in a pretend tray, so Settings → Window and the hide sheet can be
  // built without the engine. Hiding a browser tab does nothing.
  const shell: WindowPayload = { taskbar: false, start: 'panel', tray: true };
  const pubShell = () => pub<WindowPayload>('app:window', 'mock.shell', { ...shell });
  const unsubShell = bus.subscribe('window:command', (e) => {
    const command = e.data as WindowCommand;
    if (command.action === 'set_taskbar') shell.taskbar = command.on;
    if (command.action === 'set_start') shell.start = command.start;
    pubShell();
  });

  // A log with something in it, and a crash to dismiss, for Settings → About
  // and the line under the header.
  const minutes = (n: number) => Date.now() - n * 60_000;
  const log: LogPayload = {
    file: 'C:\\Users\\you\\AppData\\Local\\dev.purukitto.kehai\\logs\\kehai.log',
    detail: false,
    problems: [
      {
        atMs: minutes(12),
        src: 'poller.update',
        level: 'warn',
        what: 'Checking for updates failed. Could not reach GitHub.',
        then: 'Press Check to try again.',
        detail: 'error sending request for url (https://github.com/Purukitto/kehai/releases/latest/download/latest.json)',
        count: 2,
      },
      {
        atMs: minutes(140),
        src: 'poller.notify',
        level: 'warn',
        what: "Notifications can't be read.",
        then: 'Settings → Sources says why.',
        detail: 'Windows refused access.',
        count: 1,
      },
      {
        atMs: minutes(60 * 22),
        src: 'kehai',
        level: 'error',
        what: 'Kehai closed unexpectedly.',
        then: 'The log has what happened.',
        detail: 'panicked on main at src\\pollers\\display.rs:391: no monitor',
        count: 1,
      },
    ],
    crashedAtMs: minutes(60 * 22),
  };
  const pubLog = () => pub<LogPayload>('app:log', 'mock.log', { ...log });
  const unsubLog = bus.subscribe('log:command', (e) => {
    const command = e.data as LogCommand;
    if (command.action === 'detail') log.detail = command.on;
    if (command.action === 'dismiss_crash') log.crashedAtMs = null;
    if (command.action === 'copy') {
      pub<LogCopyPayload>('app:log-copy', 'mock.log', {
        text: '2026-11-01 21:14:03.120 WARN  poller.update  Checking for updates failed.',
        atMs: Date.now(),
      });
    }
    pubLog();
  });

  pub<ArtPayload>('media:art', 'mock.media', { dataUrl: null });
  pubUpdate();
  pubDisplays();
  pubShell();
  pubLog();
  lookPresence();

  // The dock: a Start menu of made-up apps with drawn icons, the author's
  // Steam games with drawn covers, and what the engine would know of them.
  // `?dock=fail` refuses every open, `?dock=scenefail` only Terminal's;
  // `?mic=muted` starts muted, `?mic=none` has no microphone, `?mic=quiet`
  // has nobody listening.
  const dockMode = new URLSearchParams(location.search).get('dock');
  const micMode = new URLSearchParams(location.search).get('mic');
  const svg = (inner: string, w = 64, h = 64) =>
    `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${inner}</svg>`)}`;
  const tile = (a: string, b: string, glyph: string) =>
    svg(
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`
    );
  const APP_ICONS: Record<string, string> = {
    agent: tile('#d9a46a', '#9c5f33', '<path d="M32 15l15 17-15 17-15-17z" fill="#fff" stroke="none"/>'),
    editor: tile('#3b8de0', '#1d4f9a', '<path d="M25 22L15 32l10 10M39 22l10 10-10 10"/>'),
    browser: tile('#f2913f', '#c2412b', '<circle cx="32" cy="32" r="15"/><path d="M17 32h30M32 17c7 7 7 23 0 30M32 17c-7 7-7 23 0 30" stroke-width="3"/>'),
    chat: tile('#7176f4', '#3e42b2', '<path d="M16 19h32v21H31l-9 7v-7h-6z" fill="#fff" stroke="none"/>'),
    terminal: tile('#33363d', '#141519', '<path d="M18 23l9 9-9 9M31 43h15"/>'),
    spotify: tile('#2fc56d', '#16864a', '<path d="M27 43V22l17-4v21"/><circle cx="23" cy="43" r="4.5" fill="#fff" stroke="none"/><circle cx="40" cy="39" r="4.5" fill="#fff" stroke="none"/>'),
    files: tile('#f4c654', '#d0921f', '<path d="M15 22a3 3 0 0 1 3-3h9l4 4h15a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3z" fill="#fff" stroke="none" opacity=".95"/>'),
    mail: tile('#38b6e8', '#1a6fb0', '<rect x="15" y="20" width="34" height="24" rx="3"/><path d="M16 22l16 12 16-12"/>'),
    notes: tile('#a978e6', '#6c3fb0', '<path d="M21 17h22v30H21zM26 25h12M26 32h12M26 39h7"/>'),
    recorder: tile('#3a3d45', '#17181c', '<circle cx="32" cy="32" r="12" fill="#ef5b5b" stroke="none"/><circle cx="32" cy="32" r="17"/>'),
    calendar: tile('#ef6b6b', '#b8313a', '<rect x="16" y="19" width="32" height="28" rx="3"/><path d="M16 27h32M24 15v8M40 15v8"/>'),
    photos: tile('#5cc0c9', '#2a7c9e', '<rect x="15" y="18" width="34" height="28" rx="3"/><path d="M17 42l10-11 8 8 5-5 8 8"/>'),
    steam: tile('#2a475e', '#121d28', '<circle cx="38" cy="26" r="7"/><circle cx="24" cy="40" r="5"/><path d="M28 37l6-6"/>'),
    phone: tile('#4f8ef7', '#2852b8', '<rect x="22" y="14" width="20" height="36" rx="4"/><path d="M29 44h6"/>'),
  };
  const APPS: DockAppsPayload['apps'] = [
    { id: 'agent', name: 'Agent', running: true },
    { id: 'editor', name: 'Editor', running: true },
    { id: 'browser', name: 'Browser', running: true },
    { id: 'chat', name: 'Chat', running: true },
    { id: 'spotify', name: 'Spotify', running: true },
    { id: 'terminal', name: 'Terminal', running: false },
    { id: 'files', name: 'Files', running: false },
    { id: 'mail', name: 'Mail', running: false },
    { id: 'notes', name: 'Notes', running: false },
    { id: 'recorder', name: 'Recorder', running: false },
    { id: 'calendar', name: 'Calendar', running: false },
    { id: 'photos', name: 'Photos', running: false },
    { id: 'steam', name: 'Steam', running: false },
    { id: 'phone', name: 'Phone', running: false },
  ];
  const DAYS = 86_400_000;
  const GAMES: DockAppsPayload['games'] = [
    { id: '730', name: 'Counter-Strike 2', running: false, playedMs: Date.now() - 2 * DAYS },
    { id: '1422450', name: 'Deadlock', running: false, playedMs: Date.now() - 6 * DAYS },
    { id: '1903340', name: 'Clair Obscur: Expedition 33', running: false, playedMs: Date.now() - 9 * DAYS },
    { id: '1091500', name: 'Cyberpunk 2077', running: false, playedMs: Date.now() - 20 * DAYS },
    { id: '1158310', name: 'Crusader Kings III', running: false, playedMs: Date.now() - 41 * DAYS },
    { id: '489830', name: 'The Elder Scrolls V: Skyrim Special Edition', running: false, playedMs: Date.now() - 80 * DAYS },
    { id: '949230', name: 'Cities: Skylines II', running: false, playedMs: Date.now() - 120 * DAYS },
    { id: '870780', name: 'Control Ultimate Edition', running: false, playedMs: 0 },
  ];
  const COVER_HUES: [string, string][] = [
    ['#c98a3a', '#2a1c10'],
    ['#7d5a9e', '#151020'],
    ['#d8b26a', '#2b2216'],
    ['#e5e44a', '#3a1630'],
    ['#a33a32', '#1b0d0c'],
    ['#7e8fa0', '#14181d'],
    ['#4f9fd0', '#0e1d2a'],
    ['#b7473f', '#140c0c'],
  ];
  const cover = (name: string, i: number) => {
    const [a, b] = COVER_HUES[i % COVER_HUES.length];
    const lines = name
      .replace(/:.*/, '')
      .split(' ')
      .reduce<string[]>((acc, w) => {
        const last = acc[acc.length - 1];
        if (last && `${last} ${w}`.length <= 12) acc[acc.length - 1] = `${last} ${w}`;
        else acc.push(w);
        return acc;
      }, []);
    const text = lines
      .map((l, j) => `<text x="300" y="${640 + j * 74}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-weight="700" font-size="64" fill="#fff" opacity=".92">${l}</text>`)
      .join('');
    return svg(
      `<defs><linearGradient id="c" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="600" height="900" fill="url(#c)"/><circle cx="${180 + ((i * 47) % 260)}" cy="300" r="180" fill="#fff" opacity=".08"/>${text}`,
      600,
      900
    );
  };
  const dockIcons: Record<string, string> = {
    ...Object.fromEntries(Object.entries(APP_ICONS).map(([id, src]) => [`app:${id}`, src])),
    ...Object.fromEntries(GAMES.map((g, i) => [`game:${g.id}`, cover(g.name, i)])),
  };
  const pubDock = () =>
    pub<DockStatePayload>('dock:state', 'mock.dock', {
      live: {
        ...Object.fromEntries(APPS.map((a) => [`app:${a.id}`, { running: a.running, listening: a.id === 'chat' && micMode !== 'quiet' && micMode !== 'none', waiting: 0 }])),
        'app:agent': { running: true, listening: false, waiting: new URLSearchParams(location.search).get('agents') === 'today' ? 2 : 1 },
        ...Object.fromEntries(GAMES.map((g) => [`game:${g.id}`, { running: g.running, listening: false, waiting: 0 }])),
      },
    });
  pubDock();
  // Icons for what the buttons name, as the engine sends them.
  const unsubPins = bus.subscribe('dock:pins', (e) => {
    const keys = new Set((e.data as DockPins).targets.map((t) => (t.kind === 'app' || t.kind === 'game' ? `${t.kind}:${t.id}` : '')));
    pub<DockIconsPayload>('dock:icons', 'mock.dock', { icons: Object.fromEntries(Object.entries(dockIcons).filter(([k]) => keys.has(k))) });
  });
  const mic: MicPayload = { available: micMode !== 'none', muted: micMode === 'muted', listening: micMode === 'quiet' || micMode === 'none' ? [] : ['Chat'] };
  pub<MicPayload>('os:mic', 'mock.mic', { ...mic });
  const unsubMic = bus.subscribe('mic:command', (e) => {
    const c = e.data as MicCommand;
    if (c.action === 'mute' && mic.available) mic.muted = c.muted;
    pub<MicPayload>('os:mic', 'mock.mic', { ...mic, listening: [...mic.listening] });
  });
  const unsubDock = bus.subscribe('dock:command', (e) => {
    const c = e.data as DockCommand;
    if (c.action === 'list') {
      window.setTimeout(() => pub<DockAppsPayload>('dock:apps', 'mock.dock', { apps: APPS, games: GAMES, steam: 'D:/Steam', icons: dockIcons }), 80);
      return;
    }
    // Windows' picker, answered at once with a made-up choice.
    if (c.action === 'pick') {
      window.setTimeout(
        () =>
          pub<DockPicked>('dock:picked', 'mock.dock', c.folder ? { path: String.raw`D:\Projects`, folder: true, name: 'Projects' } : { path: String.raw`D:\Notes\Plan.md`, folder: false, name: 'Plan' }),
        300
      );
      return;
    }
    if (c.action !== 'open') return;
    const t = c.target;
    const ok = dockMode !== 'fail' && !(dockMode === 'scenefail' && t.kind === 'app' && t.id === 'terminal');
    const running = t.kind === 'app' ? APPS.find((a) => a.id === t.id)?.running : t.kind === 'game' ? GAMES.find((g) => g.id === t.id)?.running : false;
    const how: DockOpened['how'] = !ok ? null : t.kind === 'link' || t.kind === 'path' ? 'link' : running ? 'front' : t.kind === 'game' ? 'launched' : 'started';
    window.setTimeout(() => pub<DockOpened>('dock:opened', 'mock.dock', { press: c.press, ok, how, reason: ok ? null : 'it would not start' }), 120);
  });

  // Everything the game widgets read, unless the engine owns all of it.
  const stopGame = skip.has('game:cs2') ? () => undefined : startMockGame(pub);

  tick();
  slowTick();
  timers.push(window.setInterval(tick, 1000));
  timers.push(window.setInterval(slowTick, 30_000));

  return () => {
    unsub();
    unsubJump();
    unsubDock();
    unsubPins();
    unsubMic();
    unsubNotify();
    unsubRules();
    unsubDisplay();
    unsubFlow();
    unsubRemote();
    unsubShell();
    unsubLog();
    unsubUpdate();
    unsubPresence();
    unsubGpu();
    unsubBacklight();
    unsubShown();
    stopGame();
    INPUT.forEach((type) => window.removeEventListener(type, onInput, { capture: true }));
    timers.forEach((id) => window.clearInterval(id));
  };
}
