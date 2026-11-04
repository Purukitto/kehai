export const p2 = (n: number): string => (n < 10 ? '0' : '') + n;

export function mmss(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return p2(Math.floor(s / 60)) + ':' + p2(s % 60);
}

export function humanDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? h + 'h ' + p2(m) + 'm' : m + 'm';
}

export function compact(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return String(n);
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function clockParts(d: Date, seconds: boolean) {
  const time = seconds
    ? p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds())
    : p2(d.getHours()) + ':' + p2(d.getMinutes());
  return {
    time,
    // A desk clock has no business with the year.
    date: DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()],
  };
}

/**
 * SVG path for a sparkline across w x h, scaled to its own max unless given
 * one. A smooth curve through every point, each control point kept within the
 * height of its two neighbours, so it never overshoots into a value that was
 * not there.
 */
export function sparkPath(values: number[], w: number, h: number, maxIn?: number): string {
  if (values.length < 2) return '';
  const max = (maxIn ?? Math.max(...values)) * 1.15 || 1;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - 3 - (v / max) * (h - 10)] as const);
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const prev = pts[i - 2] ?? pts[i - 1];
    const next = pts[i + 1] ?? pts[i];
    const lo = Math.min(y0, y1);
    const hi = Math.max(y0, y1);
    const c1 = Math.min(hi, Math.max(lo, y0 + (y1 - prev[1]) / 6));
    const c2 = Math.min(hi, Math.max(lo, y1 - (next[1] - y0) / 6));
    d += ` C${f(x0 + step / 3)} ${f(c1)} ${f(x1 - step / 3)} ${f(c2)} ${f(x1)} ${f(y1)}`;
  }
  return d;
}

const UNITS = ['B', 'K', 'M', 'G', 'T'];

export function bytes(n: number, digits = 1): string {
  let v = Math.max(0, n);
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  return (i === 0 ? Math.round(v).toString() : v.toFixed(digits)) + UNITS[i];
}

export function rate(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return Math.round(bytesPerSec) + ' B/s';
  if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(0) + ' KB/s';
  return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
}
