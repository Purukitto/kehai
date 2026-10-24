import { useEffect, useMemo, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { bus } from '../core/bus';
import { mmss } from '../core/format';
import { useTileSize } from '../core/TileSize';
import { useBreakpoint } from '../core/useBreakpoint';
import { useTopic } from '../core/useTopic';
import type { ArtPayload, MediaCommand, MediaPayload, VolumePayload } from '../core/payloads';
import type { WidgetProps, WidgetSpec } from '../core/types';
import { Pane } from './chrome';

const PREV = 'M13 3v10L5 8ZM3 3h1.6v10H3Z';
const PAUSE = 'M4.5 3h2.6v10H4.5ZM8.9 3h2.6v10H8.9Z';
const PLAY = 'M4.5 2.5 13 8 4.5 13.5Z';
const NEXT = 'M3 3v10l8-5ZM11.4 3H13v10h-1.6Z';

/** Below this the widget drops to a single row: art, progress and header go. */
const COMPACT_BELOW = 210;
/** A tile with a header this wide keeps volume beside the buttons, with no speaker to press. */
const VOLUME_BESIDE_FROM = 720;
/** One row narrower than this drops the cover, so the title keeps some room. */
const ROW_COVER_FROM = 460;
/** As the volume keys move it. A block sets a tenth. */
const VOLUME_STEP = 2;
/** Volume opened from the speaker goes back to the buttons after this long untouched. */
const VOLUME_CLOSES_MS = 5000;
/** How long a seek's target is shown before the player has said where it is. */
const SEEK_SETTLES_MS = 3000;

function command(c: MediaCommand) {
  bus.publish<MediaCommand>('media:command', 'widget.media', c);
}

function Speaker({ muted }: { muted: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="M2 6h2.6L8.4 3v10L4.6 10H2Z" fill="currentColor" />
      {muted ? <path d="M10.8 6.2 14.4 9.8M14.4 6.2 10.8 9.8" /> : <path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.4 3.8a6 6 0 0 1 0 8.4" />}
    </svg>
  );
}

function Equaliser({
  bars,
  playing,
  height,
  width,
}: {
  bars: number;
  playing: boolean;
  height: number;
  width?: number;
}) {
  const cells = useMemo(
    () =>
      Array.from({ length: bars }, (_, i) => ({
        delay: (Math.sin(i * 0.62) * 0.42 + 0.44).toFixed(2) + 's',
        dur: (0.72 + (i % 4) * 0.14).toFixed(2) + 's',
      })),
    [bars]
  );

  return (
    <div
      className="cc-eq"
      data-playing={playing}
      style={width === undefined ? { height, flex: 1, minWidth: 0 } : { height, width, flex: 'none' }}
    >
      {cells.map((c, i) => (
        <span key={i} style={{ animationDelay: c.delay, animationDuration: c.dur }} />
      ))}
    </div>
  );
}

/** Previous, play/pause and next, then the speaker that opens volume when there is one. */
function Transport({
  playing,
  size,
  volume,
  onVolume,
}: {
  playing: boolean;
  size: number;
  volume?: Volume | null;
  onVolume?: () => void;
}) {
  const buttons = [
    { d: PREV, action: 'previous', accent: false },
    { d: playing ? PAUSE : PLAY, action: 'playpause', accent: true },
    { d: NEXT, action: 'next', accent: false },
  ] as const;

  return (
    <div style={{ display: 'flex', gap: 8, flex: 'none', alignItems: 'center' }}>
      {buttons.map((b) => (
        <button
          key={b.action}
          onClick={() => command({ action: b.action })}
          aria-label={b.action}
          style={{
            width: size + 10,
            height: size,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: b.accent ? 'var(--cc-accent)' : 'var(--cc-muted)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d={b.d} />
          </svg>
        </button>
      ))}
      {volume && onVolume && (
        <>
          <span style={{ width: 1, height: Math.round(size / 2), background: 'var(--cc-line)', margin: '0 2px' }} />
          <SpeakerButton size={size} muted={volume.muted} onClick={onVolume} />
        </>
      )}
    </div>
  );
}

function SpeakerButton({ size, muted, onClick }: { size: number; muted: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Volume"
      title="This computer's volume"
      style={{
        width: size + 10,
        height: size,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: muted ? 'var(--cc-dim)' : 'var(--cc-muted)',
      }}
    >
      <Speaker muted={muted} />
    </button>
  );
}

/**
 * The computer's volume as the panel last heard it, with a press that has not
 * come back yet standing in for it, so a finger pressing + several times in a
 * row never steps from a stale level.
 */
function useVolume() {
  const heard = useTopic<VolumePayload | null>('media:volume') ?? null;
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    if (pending === null) return;
    if (heard?.level === pending) {
      setPending(null);
      return;
    }
    const id = window.setTimeout(() => setPending(null), 1500);
    return () => window.clearTimeout(id);
  }, [heard, pending]);

  if (!heard) return null;
  const level = pending ?? heard.level;
  return {
    level,
    muted: pending === null && heard.muted,
    set: (next: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(next)));
      setPending(clamped);
      command({ action: 'volume', level: clamped });
    },
    mute: (muted: boolean) => command({ action: 'mute', muted }),
  };
}

type Volume = NonNullable<ReturnType<typeof useVolume>>;

/** Mute, −, ten blocks and +, then the level, and × when it was opened from the speaker. */
function VolumeControls({
  volume,
  size,
  readout = true,
  onTouch,
  onClose,
}: {
  volume: Volume;
  size: number;
  readout?: boolean;
  onTouch?: () => void;
  onClose?: () => void;
}) {
  const press = (f: () => void) => () => {
    onTouch?.();
    f();
  };
  const on = Math.round(volume.level / 10);
  const square = { width: size, height: size, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' } as const;

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        style={{ ...square, color: volume.muted ? 'var(--cc-accent)' : 'var(--cc-muted)' }}
        onClick={press(() => volume.mute(!volume.muted))}
        aria-label={volume.muted ? 'Unmute' : 'Mute'}
        aria-pressed={volume.muted}
      >
        <Speaker muted={volume.muted} />
      </button>
      <button style={{ ...square, color: 'var(--cc-muted)' }} onClick={press(() => volume.set(volume.level - VOLUME_STEP))} aria-label="Quieter">
        <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.4">
          <path d="M2 7h10" />
        </svg>
      </button>
      <div style={{ flex: 1, minWidth: 40, height: size, display: 'flex', gap: 3 }} role="group" aria-label="Volume level">
        {Array.from({ length: 10 }, (_, i) => (
          <button
            key={i}
            onClick={press(() => volume.set((i + 1) * 10))}
            aria-label={`${(i + 1) * 10}`}
            style={{ flex: 1, minWidth: 0, padding: 0, border: 0, display: 'flex', alignItems: 'center' }}
          >
            <span
              style={{
                display: 'block',
                width: '100%',
                height: Math.round(size * 0.42),
                background: i < on ? (volume.muted ? 'var(--cc-line-2)' : 'var(--cc-accent)') : 'var(--cc-line)',
              }}
            />
          </button>
        ))}
      </div>
      <button style={{ ...square, color: 'var(--cc-muted)' }} onClick={press(() => volume.set(volume.level + VOLUME_STEP))} aria-label="Louder">
        <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.4">
          <path d="M2 7h10M7 2v10" />
        </svg>
      </button>
      {readout && <Level volume={volume} style={{ width: 44, textAlign: 'right' }} />}
      {onClose && (
        <button style={{ ...square, border: 0, color: 'var(--cc-dim)' }} onClick={onClose} aria-label="Close volume">
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      )}
    </div>
  );
}

function Level({ volume, style }: { volume: Volume; style?: React.CSSProperties }) {
  return volume.muted ? (
    <span className="cc-mini" style={{ flex: 'none', letterSpacing: '0.14em', ...style }}>
      MUTED
    </span>
  ) : (
    <span style={{ flex: 'none', fontSize: 13, ...style }}>{volume.level}</span>
  );
}

/** Opened from the speaker; goes back to the buttons once left alone. */
function useVolumeOpen() {
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(0);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setOpen(false), VOLUME_CLOSES_MS);
    return () => window.clearTimeout(id);
  }, [open, touched]);

  return {
    open,
    show: () => {
      setOpen(true);
      setTouched(Date.now());
    },
    touch: () => setTouched(Date.now()),
    close: () => setOpen(false),
  };
}

/**
 * A tap or a drag along an element, as a fraction of its width. The player is
 * only asked to seek on release, so a drag across the track is one seek, not
 * forty.
 */
function useScrub(onRelease: (fraction: number) => void) {
  const [drag, setDrag] = useState<number | null>(null);

  const at = (e: ReactPointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return r.width > 0 ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0;
  };

  return {
    drag,
    handlers: {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(at(e));
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) setDrag(at(e));
      },
      onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        setDrag(null);
        onRelease(at(e));
      },
      onPointerCancel: () => setDrag(null),
    },
  };
}

/** The bar between the times. Where the player can seek, a 32 px strip around it takes a tap or a drag. */
function SeekBar({
  elapsed,
  duration,
  canSeek,
  onSeek,
}: {
  elapsed: number;
  duration: number;
  canSeek: boolean;
  onSeek: (sec: number) => void;
}) {
  const { drag, handlers } = useScrub((f) => onSeek(f * duration));
  const pct = (drag ?? (duration > 0 ? elapsed / duration : 0)) * 100;
  const was = duration > 0 ? (elapsed / duration) * 100 : 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: canSeek ? 3 : 12 }}>
      <span className="cc-mini" style={{ color: drag !== null ? 'var(--cc-accent-2)' : undefined }}>
        {mmss(drag !== null ? drag * duration : elapsed)}
      </span>
      <div
        {...(canSeek ? handlers : {})}
        style={{
          flex: 1,
          height: canSeek ? 32 : 3,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          cursor: canSeek ? 'pointer' : undefined,
          touchAction: canSeek ? 'none' : undefined,
        }}
      >
        <div style={{ position: 'relative', width: '100%', height: drag !== null ? 6 : 3, background: 'var(--cc-inset)' }}>
          {drag !== null && <div style={{ position: 'absolute', inset: 0, width: was + '%', background: 'var(--cc-line-2)' }} />}
          <div style={{ position: 'absolute', inset: 0, width: pct + '%', background: 'var(--cc-accent-2)' }} />
        </div>
        {drag !== null && (
          <span
            style={{ position: 'absolute', left: `calc(${pct}% - 2px)`, top: 2, bottom: 2, width: 4, background: 'var(--cc-text)' }}
          />
        )}
      </div>
      <span className="cc-mini">{mmss(duration)}</span>
    </div>
  );
}

/**
 * Along the bottom edge of the one-row form: a hairline, and where the player
 * can seek, a 28 px strip to tap or drag, with the time shown above the finger.
 */
function SeekEdge({
  elapsed,
  duration,
  canSeek,
  onSeek,
}: {
  elapsed: number;
  duration: number;
  canSeek: boolean;
  onSeek: (sec: number) => void;
}) {
  const { drag, handlers } = useScrub((f) => onSeek(f * duration));
  const pct = (drag ?? (duration > 0 ? elapsed / duration : 0)) * 100;
  const was = duration > 0 ? (elapsed / duration) * 100 : 0;

  return (
    <div
      {...(canSeek ? handlers : {})}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: canSeek ? 28 : 3,
        cursor: canSeek ? 'pointer' : undefined,
        touchAction: canSeek ? 'none' : undefined,
      }}
    >
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: drag !== null ? 6 : 3, background: 'var(--cc-inset)' }}>
        {drag !== null && <div style={{ position: 'absolute', inset: 0, width: was + '%', background: 'var(--cc-line-2)' }} />}
        <div style={{ position: 'absolute', inset: 0, width: pct + '%', background: 'var(--cc-accent-2)' }} />
      </div>
      {drag !== null && (
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            left: `clamp(0px, calc(${pct}% - 52px), calc(100% - 104px))`,
            width: 104,
            height: 30,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            background: 'var(--cc-pane-2)',
            border: '1px solid var(--cc-accent-2)',
            pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--cc-accent-2)' }}>{mmss(drag * duration)}</span>
          <span className="cc-mini">/ {mmss(duration)}</span>
        </div>
      )}
    </div>
  );
}

function Cover({ src, size }: { src: string | null; size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        flex: 'none',
        background: 'var(--cc-inset)',
        border: '1px solid var(--cc-line)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {src ? (
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <svg
          width={Math.round(size * 0.36)}
          height={Math.round(size * 0.36)}
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--cc-line-2)"
          strokeWidth="1.2"
        >
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="2.4" />
        </svg>
      )}
    </div>
  );
}

function Title({ media, size }: { media: MediaPayload; size: 'sm' | 'md' }) {
  const clip = {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as const;

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: size === 'sm' ? 15 : 17, ...clip }}>{media.title}</div>
      <div style={{ fontSize: size === 'sm' ? 12 : 13, color: 'var(--cc-muted)', marginTop: 4, ...clip }}>
        {media.artist}
      </div>
    </div>
  );
}

/** The whole row as volume, labelled, as the one-row form and the empty tile show it. */
function VolumeRow({ volume, opened }: { volume: Volume; opened: ReturnType<typeof useVolumeOpen> }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px', minWidth: 0 }}>
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 84 }}>
        <span className="cc-label">PC volume</span>
        <Level volume={volume} style={{ fontSize: volume.muted ? 10 : 22, fontWeight: 300 }} />
      </div>
      <VolumeControls volume={volume} size={40} readout={false} onTouch={opened.touch} onClose={opened.close} />
    </div>
  );
}

function NowPlaying({ props }: WidgetProps) {
  const size = useTileSize();
  const media = useTopic<MediaPayload>('media:now_playing');
  const art = useTopic<ArtPayload>('media:art');
  const volume = useVolume();
  const opened = useVolumeOpen();
  const wantArt = props.art !== false;
  const wantEq = props.equaliser !== 'off';

  const compact = useBreakpoint(size.h, COMPACT_BELOW);

  // Where a seek was sent, shown until the player says it has moved there.
  const [sought, setSought] = useState<number | null>(null);
  useEffect(() => {
    if (sought !== null && media && Math.abs(media.elapsedSec - sought) <= 2) setSought(null);
  }, [media, sought]);
  // Timed from the seek alone: a playing track publishes every second, and a
  // seek the player refused must not be held up by that.
  useEffect(() => {
    if (sought === null) return;
    const id = window.setTimeout(() => setSought(null), SEEK_SETTLES_MS);
    return () => window.clearTimeout(id);
  }, [sought]);

  const seek = (sec: number) => {
    const at = Math.round(sec);
    setSought(at);
    command({ action: 'seek', positionSec: at });
  };

  const duration = media?.durationSec ?? 0;
  const elapsed = sought ?? media?.elapsedSec ?? 0;
  const canSeek = !!media?.canSeek && duration > 0;
  const showVolume = volume && opened.open;

  let inner: React.ReactNode;

  if (!media) {
    inner = showVolume ? (
      <VolumeRow volume={volume} opened={opened} />
    ) : (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--cc-line-2)', padding: '0 18px' }}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
          <path d="M6 12.4V3.2l7-1.4v9.2" />
          <circle cx="4" cy="12.4" r="2" />
          <path d="M2 14 14 2" />
        </svg>
        <span style={{ fontSize: 12, flex: 1 }}>nothing playing</span>
        {/* It's the computer's volume, not the track's, so it stays. */}
        {volume && <SpeakerButton size={40} muted={volume.muted} onClick={opened.show} />}
      </div>
    );
  } else if (compact) {
    // One row. Art, header and the timestamped bar are the first to go; the
    // bottom edge keeps position, and takes a seek, without costing a row.
    inner = (
      <div style={{ position: 'relative', flex: 1, display: 'flex', minWidth: 0 }}>
        {showVolume ? (
          <VolumeRow volume={volume} opened={opened} />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px', minWidth: 0 }}>
            {wantArt && size.h > 90 && size.w >= ROW_COVER_FROM && <Cover src={art?.dataUrl ?? null} size={Math.min(52, size.h - 34)} />}
            <Title media={media} size="sm" />
            {wantEq && size.w > (volume ? 600 : 470) && (
              <Equaliser
                bars={18}
                width={Math.min(160, Math.round(size.w * 0.18))}
                playing={media.playing}
                height={Math.max(18, Math.min(34, Math.round(size.h * 0.2)))}
              />
            )}
            <Transport playing={media.playing} size={40} volume={volume} onVolume={opened.show} />
          </div>
        )}
        <SeekEdge elapsed={elapsed} duration={duration} canSeek={canSeek} onSeek={seek} />
      </div>
    );
  } else {
    const beside = volume && size.w >= VOLUME_BESIDE_FROM;
    inner = (
      <Pane
        label="NOW PLAYING"
        right={<span className="cc-mini" style={{ fontSize: 9 }}>{media.player.toUpperCase()}</span>}
      >
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', minWidth: 0 }}>
          {wantArt && <Cover src={art?.dataUrl ?? null} size={size.h > 300 ? 72 : 56} />}
          <Title media={media} size="md" />
        </div>

        {wantEq && size.h > 250 && (
          <div style={{ marginTop: 14 }}>
            <Equaliser bars={36} playing={media.playing} height={26} />
          </div>
        )}

        <SeekBar elapsed={elapsed} duration={duration} canSeek={canSeek} onSeek={seek} />

        <div style={{ flex: 1 }} />
        {beside ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <Transport playing={media.playing} size={46} />
            <span style={{ width: 1, height: 24, flex: 'none', background: 'var(--cc-line)' }} />
            <div style={{ flex: 1, maxWidth: 380, marginLeft: 'auto', display: 'flex' }}>
              <VolumeControls volume={volume} size={40} />
            </div>
          </div>
        ) : showVolume ? (
          <div style={{ display: 'flex' }}>
            <VolumeControls volume={volume} size={46} onTouch={opened.touch} onClose={opened.close} />
          </div>
        ) : (
          <Transport playing={media.playing} size={46} volume={volume} onVolume={opened.show} />
        )}
      </Pane>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--cc-pane)',
        overflow: 'hidden',
      }}
    >
      {inner}
    </div>
  );
}

export const mediaSpec: WidgetSpec = {
  title: 'Now playing',
  about: 'The track playing anywhere on this machine, with play, pause, skip and seek, and this machine’s volume.',
  min: [3, 2],
  topics: ['media:now_playing', 'media:art', 'media:volume'],
  component: NowPlaying,
};
