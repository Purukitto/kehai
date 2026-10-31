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
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '12px 0',
        borderBottom: '1px solid var(--cc-line)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12 }}>{label}</div>
        {desc && (
          <div className="cc-mini" style={{ marginTop: 4, lineHeight: 1.5 }}>
            {desc}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

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
    <div style={{ display: 'flex', flex: 'none' }}>
      {options.map((o) => (
        <button
          key={String(o)}
          onClick={() => onPick(o)}
          className={o === value ? 'cc-chip cc-chip-on' : 'cc-chip'}
          style={{ padding: '7px 13px', marginLeft: -1 }}
        >
          {format ? format(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

export function Group({ label, note }: { label: string; note: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 22, marginBottom: 8 }}>
      <span className="cc-label">{label}</span>
      <span className="cc-mini">{note}</span>
    </div>
  );
}
