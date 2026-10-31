import { bus } from './bus';
import type {
  AgentsPayload,
  ArtPayload,
  ClockPayload,
  CpuPayload,
  DiskPayload,
  DisplayCommand,
  DisplaysPayload,
  FlowCommand,
  MediaCommand,
  MediaPayload,
  MemPayload,
  NetPayload,
  NotifyCommand,
  NotifyItem,
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

  const media: MediaPayload = {
    playing: true,
    title: 'Low Orbit Ferry',
    artist: 'Meridian Field',
    elapsedSec: 134,
    durationSec: 348,
    hasArt: true,
    player: 'Spotify',
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
  const note = (id: number, app: string, source: string, title: string, body: string, ago: number): NotifyItem => ({
    id,
    app,
    source,
    title,
    body,
    atMs: at - ago,
    nameOnly: false,
  });
  let tray: NotifyItem[] = [
    note(1, 'ci', 'Continuous Integration', 'build #2841 passed', 'windows-msvc, 3m 12s', 60_000),
    note(2, 'chat', 'Chat', 'standup moved to 15:30', '', 120_000),
    note(3, 'git', 'Git', 'pushed 4 commits', 'origin/feat/event-bus', 240_000),
    note(4, 'chat', 'Chat', 'lunch?', 'in ten', 600_000),
    note(5, 'chat', 'Chat', 'are you around', '', 900_000),
  ];
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
    else if (cmd.action === 'dismiss' || cmd.action === 'clear') {
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
      pub<PresencePayload>('os:presence', 'mock.presence', { available: true, reason: null, state });
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
  const started = Date.now();
  let busyFlip = false;
  const pubAgents = () => {
    busyFlip = !busyFlip;
    const now = Date.now();
    pub<AgentsPayload>('dev:agents', 'mock.agents', {
      available: true,
      reason: null,
      sessions: [
        { id: 'm1', project: 'kehai', worktree: 'agent-sessions', state: 'waiting', sinceMs: started - 192_000, subagents: 0 },
        { id: 'm2', project: 'api-gateway', worktree: null, state: 'tool', sinceMs: started - 38_000, subagents: 2 },
        busyFlip
          ? { id: 'm3', project: 'dotfiles', worktree: null, state: 'working', sinceMs: started - 251_000, subagents: 0 }
          : { id: 'm3', project: 'dotfiles', worktree: null, state: 'tool', sinceMs: now, subagents: 0 },
      ],
    });
  };
  pubAgents();
  timers.push(window.setInterval(pubAgents, 20_000));

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

  pub<ArtPayload>('media:art', 'mock.media', { dataUrl: null });
  pubUpdate();
  pubDisplays();
  lookPresence();

  tick();
  slowTick();
  timers.push(window.setInterval(tick, 1000));
  timers.push(window.setInterval(slowTick, 30_000));

  return () => {
    unsub();
    unsubNotify();
    unsubRules();
    unsubDisplay();
    unsubFlow();
    unsubRemote();
    unsubUpdate();
    unsubPresence();
    unsubShown();
    INPUT.forEach((type) => window.removeEventListener(type, onInput, { capture: true }));
    timers.forEach((id) => window.clearInterval(id));
  };
}
