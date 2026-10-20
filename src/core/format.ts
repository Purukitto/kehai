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

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function clockParts(d: Date, seconds: boolean) {
  const time = seconds
    ? p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds())
    : p2(d.getHours()) + ':' + p2(d.getMinutes());
  return {
    time,
    date: DAYS[d.getDay()] + ' ' + p2(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(),
  };
}

/** SVG path for a sparkline across w x h, scaled to its own max unless given one. */
export function sparkPath(values: number[], w: number, h: number, maxIn?: number): string {
  if (values.length < 2) return '';
  const max = (maxIn ?? Math.max(...values)) * 1.15 || 1;
  const step = w / (values.length - 1);
  return values
    .map(
      (v, i) =>
        (i === 0 ? 'M' : 'L') +
        (i * step).toFixed(1) +
        ' ' +
        (h - 3 - (v / max) * (h - 10)).toFixed(1)
    )
    .join(' ');
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
