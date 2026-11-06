/** The pieces every settings screen is built from, and each widget's options with them. */

export function Row({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: React.ReactNode;
  children?: React.ReactNode;
}) {
  // Where the control would squeeze the words into a column a few words wide,
  // it goes under them instead, on the right, and the words keep the row.
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 24,
        rowGap: 10,
        padding: '12px 0',
        borderBottom: '1px solid var(--cc-line)',
      }}
    >
      <div style={{ flex: `1 1 ${TEXT_MIN}px`, minWidth: 0 }}>
        <div style={{ fontSize: 14 }}>{label}</div>
        {desc && (
          <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5, color: 'var(--cc-muted)', maxWidth: '68ch' }}>
            {desc}
          </div>
        )}
      </div>
      {children && (
        <div style={{ flex: 'none', marginLeft: 'auto', maxWidth: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** The narrowest a row's words get before its control moves under them. */
const TEXT_MIN = 240;

/** One of a few, side by side in a single control, the chosen one raised. */
export function Seg<T extends string | number>({
  options,
  value,
  onPick,
  format,
}: {
  options: T[];
  value: T;
  onPick: (v: T) => void;
  format?: (v: T) => string;
}) {
  return (
    <div role="radiogroup" style={{ display: 'flex', flex: 'none', flexWrap: 'wrap', gap: 2, padding: 2, borderRadius: 999, background: 'var(--cc-inset)', border: '1px solid var(--cc-line)' }}>
      {options.map((o) => (
        <button
          key={String(o)}
          role="radio"
          aria-checked={o === value}
          onClick={() => onPick(o)}
          className={o === value ? 'cc-chip cc-chip-on' : 'cc-chip cc-bare'}
          style={{ padding: '4px 12px', color: o === value ? undefined : 'var(--cc-muted)' }}
        >
          {format ? format(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

export function Group({ label, note }: { label: string; note: string }) {
  return (
    // The name stays on one line, and its note goes under it when the two don't fit side by side.
    <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 12, rowGap: 2, marginTop: 32, marginBottom: 4 }}>
      <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
      <span className="cc-mini" style={{ flex: '0 1 auto', minWidth: 0 }}>
        {note}
      </span>
    </div>
  );
}
