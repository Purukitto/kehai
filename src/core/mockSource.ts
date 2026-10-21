import { bus } from './bus';
import type {
  ArtPayload,
  ClockPayload,
  CpuPayload,
  DiskPayload,
  FlowCommand,
  MediaPayload,
  MemPayload,
  NetPayload,
  NotifyPayload,
  QuotaPayload,
  SprintPayload,
  UpdateCommand,
  UpdatePayload,
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
  };

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
  };

  const slowTick = () => {
    pub<DiskPayload>('telemetry:disk', 'mock.disk', {
      volumes: [
        { name: 'nvme0', mount: 'C:\\', usedBytes: 612 * GIB, totalBytes: 1024 * GIB },
        { name: 'nvme1', mount: 'D:\\', usedBytes: 1900 * GIB, totalBytes: 4096 * GIB },
      ],
    });

    pub<NotifyPayload>('sys:notify', 'mock.notify', {
      available: true,
      reason: null,
      items: [
        { id: 1, source: 'Continuous Integration', title: 'build #2841 passed', body: 'windows-msvc, 3m 12s', atMs: Date.now() - 60_000 },
        { id: 2, source: 'Git', title: 'pushed 4 commits', body: 'origin/feat/event-bus', atMs: Date.now() - 240_000 },
        { id: 3, source: 'Chat', title: 'standup moved to 15:30', body: '', atMs: Date.now() - 900_000 },
      ],
    });

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

  // media:command is the one topic the UI publishes. The engine owns the side
  // effect; here we reflect it back so the transport feels connected.
  const unsub = bus.subscribe('media:command', (e) => {
    const action = (e.data as { action: string }).action;
    if (action === 'playpause') media.playing = !media.playing;
    pub<MediaPayload>('media:now_playing', 'mock.media', { ...media });
  });

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

  pub<ArtPayload>('media:art', 'mock.media', { dataUrl: null });
  pubUpdate();

  tick();
  slowTick();
  timers.push(window.setInterval(tick, 1000));
  timers.push(window.setInterval(slowTick, 30_000));

  return () => {
    unsub();
    unsubFlow();
    unsubUpdate();
    timers.forEach((id) => window.clearInterval(id));
  };
}
