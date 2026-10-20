import { bus } from './bus';
import type {
  ArtPayload,
  ClockPayload,
  CpuPayload,
  DiskPayload,
  MediaPayload,
  MemPayload,
  NetPayload,
  NotifyPayload,
  QuotaPayload,
  SprintPayload,
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

  const sprint: SprintPayload = {
    running: true,
    mode: 'focus',
    remainingSec: 1122,
    index: 3,
    total: 4,
    focusedTodaySec: 15120,
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

    if (sprint.running && sprint.remainingSec > 0) sprint.remainingSec -= 1;
    pub<SprintPayload>('flow:pomodoro', 'mock.flow', { ...sprint });

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

  pub<ArtPayload>('media:art', 'mock.media', { dataUrl: null });

  tick();
  slowTick();
  timers.push(window.setInterval(tick, 1000));
  timers.push(window.setInterval(slowTick, 30_000));

  return () => {
    unsub();
    timers.forEach((id) => window.clearInterval(id));
  };
}
