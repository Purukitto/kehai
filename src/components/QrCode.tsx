import { useMemo } from 'react';
import { encode } from 'uqr';

/**
 * A code a phone camera can scan, for `text`. Dark on the theme's light ink
 * with a four-module margin in every theme: many cameras cannot read a code
 * drawn light on dark, or one without its quiet zone. Modules are whole pixels
 * so none come out thinner than the rest; the frame keeps its size.
 */
export function QrCode({ text, size }: { text: string; size: number }) {
  const { d, n } = useMemo(() => {
    const qr = encode(text, { ecc: 'M', border: 4 });
    let path = '';
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) path += `M${x} ${y}h1v1h-1z`;
      })
    );
    return { d: path, n: qr.size };
  }, [text]);
  const px = Math.max(1, Math.floor(size / n)) * n;

  return (
    <div
      style={{
        width: size,
        height: size,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--cc-text)',
      }}
    >
      <svg width={px} height={px} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="Code to scan">
        <path d={d} fill="var(--cc-bg)" />
      </svg>
    </div>
  );
}
