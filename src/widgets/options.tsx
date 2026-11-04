import { useEffect, useRef, useState } from 'react';
import { p2 } from '../core/format';
import { withTileProp } from '../core/layout';
import type { NotifyPayload, NotifyRemote, NotifyRule } from '../core/payloads';
import { isPreset, useSettings } from '../core/settings';
import type { OptionsProps } from '../core/types';
import { useTopic } from '../core/useTopic';
import { useWindowShape } from '../core/useWindowShape';
import { Group, Row, Seg } from '../settings/controls';

const RULE_NAME: Record<NotifyRule, string> = { show: 'Show', name: 'Name only', hide: 'Hide' };
const REMOTE_NAME: Record<NotifyRemote, string> = { same: 'Same as here', name: 'Name only', nothing: 'Nothing' };
const REMOTE_DESC: Record<NotifyRemote, string> = {
  same: 'Tablets and browsers see what this panel does, text and all.',
  name: 'Each app and how many, never what they say.',
  nothing: 'No notifications at all. The tile there says they stay on this PC.',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The time today, yesterday, or the date. */
function when(ms: number): string {
  if (!ms) return '--';
  const d = new Date(ms);
  const day = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(d)) / 86_400_000);
  if (days <= 0) return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  if (days === 1) return 'yesterday';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * Each app's rule, the quiet times and what remote panels get. Every app Kehai
 * has seen is listed, newest first, including ones with nothing in the list now.
 */
function NotifyOptions(_: OptionsProps) {
  const { settings, setAppRule, setNotify, seenApps } = useSettings();
  const feed = useTopic<NotifyPayload>('sys:notify');
  const { apps, remote, quietFocus } = settings.notify;

  // What was new when these opened stays marked while they are open; by the
  // next time, nothing in them is.
  const [fresh] = useState(() => new Set(Object.keys(apps).filter((id) => apps[id].fresh)));
  const seen = useRef(seenApps);
  seen.current = seenApps;
  useEffect(() => seen.current(), []);

  const inList = new Map((feed?.apps ?? []).map((a) => [a.id, a.count]));
  const listed = Object.entries(apps).sort(([, a], [, b]) => b.lastMs - a.lastMs);
  const reading = feed?.available === true;

  return (
    <>
      {!reading && (
        <div className="cc-mini" style={{ marginTop: 14, lineHeight: 1.6, color: 'var(--cc-accent)' }}>
          {feed?.pending ? 'Kehai reads none of them until you allow it under Settings → Sources.' : 'Kehai cannot read them at the moment. Settings → Sources says why.'}
        </div>
      )}

      <Group label="Apps" note="For this PC and every tablet · newest first" />
      {listed.length === 0 ? (
        <div className="cc-mini" style={{ lineHeight: 1.6 }}>
          None yet. An app joins this list with its first notification, and starts at Show.
        </div>
      ) : (
        listed.map(([id, app]) => {
          const n = inList.get(id) ?? 0;
          return (
            <Row
              key={id}
              label={app.name}
              desc={
                <>
                  {fresh.has(id) && <span style={{ color: 'var(--cc-accent-2)' }}>New · </span>}
                  {n ? `${n} in the Windows list` : 'None in the list'} · last {when(app.lastMs)}
                </>
              }
            >
              <Seg<NotifyRule>
                options={['show', 'name', 'hide']}
                value={app.rule}
                format={(r) => RULE_NAME[r]}
                onPick={(rule) => setAppRule(id, rule)}
              />
            </Row>
          );
        })
      )}
      <div className="cc-mini" style={{ marginTop: 10, lineHeight: 1.6 }}>
        Name only shows the app and how many. Hide shows nothing, here or on a tablet. The Windows list itself is left as it
        is.
      </div>

      <Group label="Quiet" note="A count, never who or what" />
      <Row label="During a focus block" desc="Only how many, until the break.">
        <Seg options={['Off', 'On']} value={quietFocus ? 'On' : 'Off'} onPick={(v) => setNotify({ quietFocus: v === 'On' })} />
      </Row>
      <div className="cc-mini" style={{ marginTop: 10, lineHeight: 1.6 }}>
        While you are away, as Settings → Appearance says.
      </div>

      <Group label="On tablets" note="And browsers on other machines" />
      <Row label="Remote panels see" desc={REMOTE_DESC[remote]}>
        <Seg<NotifyRemote>
          options={['same', 'name', 'nothing']}
          value={remote}
          format={(r) => REMOTE_NAME[r]}
          onPick={(next) => setNotify({ remote: next })}
        />
      </Row>
    </>
  );
}

/** Kept with each Now playing tile, so two can differ. */
function MediaOptions({ tile }: OptionsProps) {
  const { settings, layout, editArrangement } = useSettings();
  const { shape } = useWindowShape();
  const t = tile === null ? undefined : layout.shapes[shape].tiles[tile];

  if (tile === null || t?.widget !== 'media') {
    return (
      <div style={{ padding: '24px 0', fontSize: 13, lineHeight: 1.6, color: 'var(--cc-muted)' }}>
        Now playing is not on this layout. Its options are kept with each tile, so hold the tile once it is.
      </div>
    );
  }

  const set = (key: string, value: unknown) => editArrangement(settings.layoutId, shape, (a) => withTileProp(a, tile, key, value));
  return (
    <>
      <Group label="This tile" note={`On ${layout.name} only`} />
      {isPreset(settings.layoutId) && (
        <div className="cc-mini" style={{ marginBottom: 6, lineHeight: 1.6 }}>
          {layout.name} is a preset, so a change here saves a copy of it under Yours.
        </div>
      )}
      <Row label="Album art" desc="Shown beside the track when the player provides one.">
        <Seg options={['Off', 'On']} value={t.props?.art === false ? 'Off' : 'On'} onPick={(v) => set('art', v === 'On')} />
      </Row>
    </>
  );
}

function StageOptions(_: OptionsProps) {
  const { settings, setFollowAttention } = useSettings();
  return (
    <>
      <Group label="Every layout" note="One setting for the whole panel" />
      <Row
        label="Follows attention"
        desc="Shows Agents while one waits on you, and goes back to your tab once none does. Picking a tab yourself keeps it until another agent starts waiting."
      >
        <Seg
          options={['Off', 'On']}
          value={settings.followAttention ? 'On' : 'Off'}
          onPick={(v) => setFollowAttention(v === 'On')}
        />
      </Row>
    </>
  );
}

/** By widget id. A widget not here has nothing to set, and its sheet says so. */
export const OPTIONS = {
  media: MediaOptions,
  notify: NotifyOptions,
  stage: StageOptions,
};
