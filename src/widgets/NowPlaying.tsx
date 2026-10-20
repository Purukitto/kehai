import { useMemo } from 'react';
import { bus } from '../core/bus';
import { mmss } from '../core/format';
import { useTileSize } from '../core/TileSize';
import { useBreakpoint } from '../core/useBreakpoint';
import { useTopic } from '../core/useTopic';
import type { ArtPayload, MediaPayload } from '../core/payloads';
import type { WidgetProps, WidgetSpec } from '../core/types';
import { Pane } from './chrome';

const PREV = 'M13 3v10L5 8ZM3 3h1.6v10H3Z';
const PAUSE = 'M4.5 3h2.6v10H4.5ZM8.9 3h2.6v10H8.9Z';
const PLAY = 'M4.5 2.5 13 8 4.5 13.5Z';
const NEXT = 'M3 3v10l8-5ZM11.4 3H13v10h-1.6Z';

/** Below this the widget drops to a single row: art, progress and header go. */
const COMPACT_BELOW = 210;

function command(action: string) {
  bus.publish('media:command', 'widget.media', { action });
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

function Transport({ playing, size }: { playing: boolean; size: number }) {
  const buttons = [
    { d: PREV, action: 'previous', accent: false },
    { d: playing ? PAUSE : PLAY, action: 'playpause', accent: true },
    { d: NEXT, action: 'next', accent: false },
  ];

  return (
    <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
      {buttons.map((b) => (
        <button
          key={b.action}
          onClick={() => command(b.action)}
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

function NowPlaying({ props }: WidgetProps) {
  const size = useTileSize();
  const media = useTopic<MediaPayload>('media:now_playing');
  const art = useTopic<ArtPayload>('media:art');
  const wantArt = props.art !== false;
  const wantEq = props.equaliser !== 'off';

  const compact = useBreakpoint(size.h, COMPACT_BELOW);
  const progress = media ? (media.elapsedSec / media.durationSec) * 100 : 0;

  let inner: React.ReactNode;

  if (!media) {
    inner = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--cc-line-2)', padding: 18 }}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
          <path d="M6 12.4V3.2l7-1.4v9.2" />
          <circle cx="4" cy="12.4" r="2" />
          <path d="M2 14 14 2" />
        </svg>
        <span style={{ fontSize: 12 }}>nothing playing</span>
      </div>
    );
  } else if (compact) {
    // One row. Art, header and the timestamped scrubber are the first to go;
    // a hairline along the bottom keeps position without costing a row.
    inner = (
      <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px', minWidth: 0 }}>
        {wantArt && size.h > 90 && <Cover src={art?.dataUrl ?? null} size={Math.min(52, size.h - 34)} />}
        <Title media={media} size="sm" />
        {wantEq && size.w > 470 && (
          <Equaliser
            bars={18}
            width={Math.min(160, Math.round(size.w * 0.18))}
            playing={media.playing}
            height={Math.max(18, Math.min(34, Math.round(size.h * 0.2)))}
          />
        )}
        <Transport playing={media.playing} size={40} />
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: 'var(--cc-inset)' }}>
          <div style={{ height: '100%', width: progress + '%', background: 'var(--cc-accent-2)' }} />
        </div>
      </div>
    );
  } else {
    inner = (
      <Pane
        label="NOW PLAYING"
        topic="media:now_playing"
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <span className="cc-mini">{mmss(media.elapsedSec)}</span>
          <div style={{ flex: 1, height: 3, background: 'var(--cc-inset)' }}>
            <div style={{ height: '100%', width: progress + '%', background: 'var(--cc-accent-2)' }} />
          </div>
          <span className="cc-mini">{mmss(media.durationSec)}</span>
        </div>

        <div style={{ flex: 1 }} />
        <Transport playing={media.playing} size={46} />
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
  min: [3, 2],
  topics: ['media:now_playing', 'media:art'],
  component: NowPlaying,
};
