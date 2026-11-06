import { useEffect, useRef, useState } from 'react';
import { p2 } from '../core/format';
import { gpuModel } from '../core/gpu';
import { withTileProp } from '../core/layout';
import type { GpuPayload, NotifyPayload, NotifyRemote, NotifyRule } from '../core/payloads';
import { isPreset, useSettings } from '../core/settings';
import type { OptionsProps } from '../core/types';
import { useTopic } from '../core/useTopic';
import { useWindowShape } from '../core/useWindowShape';
import { Group, Row, Seg } from '../settings/controls';
import { STAGE_TABS, TAB_NAMES } from './Stage';
import { VITALS_DEFAULT, VITALS_NAMES, VITALS_READINGS } from './Vitals';

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

/**
 * A list kept with one tile, switched item by item: the strip's readings,
 * Stage's tabs. Items stay in the widget's own order whatever order they were
 * switched on in, and the last one can't be switched off.
 */
function TileList({
  tile,
  widget,
  propKey,
  all,
  fallback,
  names,
  descs,
}: {
  tile: number;
  widget: string;
  propKey: string;
  all: readonly string[];
  fallback: string[];
  names: Record<string, string>;
  descs: Record<string, string>;
}) {
  const { settings, layout, editArrangement } = useSettings();
  const { shape } = useWindowShape();
  const t = layout.shapes[shape].tiles[tile];
  if (t?.widget !== widget) return null;
  const on = new Set((t.props?.[propKey] as string[] | undefined) ?? fallback);
  const flip = (key: string, want: boolean) => {
    const next = all.filter((k) => (k === key ? want : on.has(k)));
    if (next.length === 0) return;
    editArrangement(settings.layoutId, shape, (a) => withTileProp(a, tile, propKey, next));
  };
  return (
    <>
      <Group label="This tile" note={`On ${layout.name} only`} />
      {isPreset(settings.layoutId) && (
        <div className="cc-mini" style={{ marginBottom: 6, lineHeight: 1.6 }}>
          {layout.name} is a preset, so a change here saves a copy of it under Yours.
        </div>
      )}
      {all.map((key) => (
        <Row key={key} label={names[key] ?? key} desc={descs[key]}>
          <Seg options={['Off', 'On']} value={on.has(key) ? 'On' : 'Off'} onPick={(v) => flip(key, v === 'On')} />
        </Row>
      ))}
    </>
  );
}

function NotOnLayout({ name }: { name: string }) {
  return (
    <div style={{ padding: '24px 0', fontSize: 13, lineHeight: 1.6, color: 'var(--cc-muted)' }}>
      {name} is not on this layout. Its options are kept with each tile, so hold the tile once it is.
    </div>
  );
}

/** Which readings this strip shows. */
function VitalsOptions({ tile }: OptionsProps) {
  const gpu = useTopic<GpuPayload>('telemetry:gpu');
  const noCard = gpu?.available === false ? 'No graphics card reports on this PC, so it stays hidden.' : undefined;
  const noSensor = gpu?.available === true && gpu.tempC === null ? 'This card’s driver reports no temperature, so it stays hidden.' : undefined;
  if (tile === null) return <NotOnLayout name="The status strip" />;
  return (
    <>
      <TileList
        tile={tile}
        widget="vitals"
        propKey="show"
        all={VITALS_READINGS}
        fallback={VITALS_DEFAULT}
        names={VITALS_NAMES}
        descs={{
          cpu: 'The processor’s load.',
          gpu: noCard ?? 'The graphics card’s load, on its busiest engine.',
          gputemp: noCard ?? noSensor ?? 'Turns red at the warning point the card’s driver gives.',
          mem: 'Memory in use.',
          net: 'Download speed.',
          unread: 'Notifications waiting.',
          agents: 'Agent sessions. Lit while one waits on you.',
        }}
      />
      <GpuCardChoice group />
    </>
  );
}

/**
 * Which graphics card the readings follow, on a PC where more than one
 * reports. One setting for every layout: the card is the PC's, not the
 * tile's. Nothing at all with a single card.
 */
function GpuCardChoice({ group }: { group: boolean }) {
  const gpu = useTopic<GpuPayload>('telemetry:gpu');
  const { settings, setGpuCard } = useSettings();
  const cards = gpu?.available ? gpu.cards : [];
  if (cards.length < 2) return null;
  // Two of the same model are told apart by their place in the list.
  const names = cards.map((c, i) => {
    const model = gpuModel(c.name);
    return cards.filter((d) => gpuModel(d.name) === model).length > 1 ? `${model} ${i + 1}` : model;
  });
  const chosen = cards.findIndex((c) => c.id === settings.gpuCard);
  return (
    <>
      {group && <Group label="Every layout" note="One setting for the whole panel" />}
      <Row
        label="Graphics card"
        desc="Which card the GPU readings follow. Automatic picks the one with the most memory of its own."
      >
        <Seg
          options={[AUTOMATIC, ...names]}
          value={chosen < 0 ? AUTOMATIC : names[chosen]}
          onPick={(v) => setGpuCard(v === AUTOMATIC ? null : (cards[names.indexOf(v)]?.id ?? null))}
        />
      </Row>
    </>
  );
}

const AUTOMATIC = 'Automatic';

/** The Machine tile: only the card, where there is a choice. */
function TelemetryOptions(_: OptionsProps) {
  const gpu = useTopic<GpuPayload>('telemetry:gpu');
  if (gpu?.available && gpu.cards.length > 1) return <GpuCardChoice group />;
  return (
    <div style={{ padding: '24px 0', fontSize: 13, lineHeight: 1.6, color: 'var(--cc-muted)' }}>
      Nothing to set here. On a PC with two graphics cards, this is where you choose the one it shows.
    </div>
  );
}

function StageOptions({ tile }: OptionsProps) {
  const { settings, setFollowAttention } = useSettings();
  return (
    <>
      {tile !== null && (
        <TileList
          tile={tile}
          widget="stage"
          propKey="tabs"
          all={STAGE_TABS}
          fallback={[...STAGE_TABS]}
          names={TAB_NAMES}
          descs={{
            quota: 'Agent tokens in the 5-hour block.',
            agents: 'Agent sessions, and which wait on you.',
            machine: 'The processor, and the graphics card beside it when the PC has one.',
            sprint: 'The focus timer.',
          }}
        />
      )}
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
      <GpuCardChoice group={false} />
    </>
  );
}

/** By widget id. A widget not here has nothing to set, and its sheet says so. */
export const OPTIONS = {
  media: MediaOptions,
  notify: NotifyOptions,
  stage: StageOptions,
  telemetry: TelemetryOptions,
  vitals: VitalsOptions,
};
