import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent, ReactNode } from 'react';
import { bus } from '../core/bus';
import { KIND_NAME, LIVE_DESC, LIVE_NAME, LIVE_OF, SCENE_GLYPHS, TOGGLE_DESC, TOGGLE_NAME, groupOf, keyOf, sceneLine } from '../core/dock';
import type { ButtonKind, DockButton, DockGroup, DockSettings, Live, Step, Toggle } from '../core/dock';
import { SURE_MS } from '../core/front';
import { withTileProp } from '../core/layout';
import type { DockAppsPayload, DockCommand, DockIconsPayload, DockPicked, DockTarget } from '../core/payloads';
import { PRESETS, findLayout, isPreset, useSettings } from '../core/settings';
import type { OptionsProps } from '../core/types';
import { useTopic } from '../core/useTopic';
import { useWindowShape } from '../core/useWindowShape';
import { Group, Row, Seg } from '../settings/controls';
import { Icon, startAt } from './Dock';

type Page =
  | { at: 'list' }
  | { at: 'add'; scene: string | null }
  | { at: 'app' | 'game' | 'link'; scene: string | null }
  | { at: 'toggle' }
  | { at: 'edit'; id: string };

const DAY = 86_400_000;
const STEP_LABEL: Record<Step['do'], string> = {
  open: 'Open',
  layout: 'Layout',
  focus: 'Focus timer',
  sound: 'Sound',
  mic: 'Mic',
  media: 'Music',
  brightness: 'Brightness',
};
const TOGGLE_SHORT: Record<Toggle, string> = {
  mic: 'mutes the mic for every app',
  sound: 'mutes the PC',
  focus: 'starts and pauses focus',
  media: 'plays and pauses',
};
const SOUND_LEVELS = [20, 40, 60, 80, 100];
const BRIGHTNESS_LEVELS = [20, 40, 60, 80, 100];

function ago(ms: number): string {
  if (!ms) return 'never played';
  const d = Math.floor((Date.now() - ms) / DAY);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : `${Math.floor(d / 7)} weeks ago`;
}

/** An id from a name, that no button (or group) has yet. */
function newId(taken: (id: string) => boolean, base: string, fallback: string): string {
  const stem =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || fallback;
  let id = stem;
  let n = 2;
  while (taken(id)) id = `${stem}-${n++}`;
  return id;
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Rows reordered by dragging their ⠿, with a finger or a mouse. The rows move
 * as it goes, and the order is kept when it is let go.
 */
function useReorder(count: number, onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const at = useRef<{ from: number; over: number; y0: number; h: number } | null>(null);
  const order = Array.from({ length: count }, (_, i) => i);
  if (drag && drag.from < count) {
    order.splice(drag.from, 1);
    order.splice(Math.min(drag.over, count - 1), 0, drag.from);
  }
  const handle = (i: number) => ({
    'data-hold': 'off',
    'aria-label': 'Drag to reorder',
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      const row = e.currentTarget.closest('[data-reorder]');
      if (!(row instanceof HTMLElement)) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      at.current = { from: i, over: i, y0: e.clientY, h: Math.max(24, row.getBoundingClientRect().height) };
      setDrag({ from: i, over: i });
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = at.current;
      if (!d) return;
      const over = Math.max(0, Math.min(count - 1, d.from + Math.round((e.clientY - d.y0) / d.h)));
      if (over !== d.over) {
        d.over = over;
        setDrag({ from: d.from, over });
      }
    },
    onPointerUp: () => {
      const d = at.current;
      at.current = null;
      setDrag(null);
      if (d && d.over !== d.from) onMove(d.from, d.over);
    },
    onPointerCancel: () => {
      at.current = null;
      setDrag(null);
    },
    onClick: (e: MouseEvent) => e.stopPropagation(),
    style: { touchAction: 'none', cursor: 'grab', color: 'var(--cc-dim)', fontSize: 14, padding: '8px 4px', flex: 'none' } as const,
  });
  return { order, handle, dragging: drag?.from ?? null };
}

/** The small icon a button has in these lists. */
function Mini({ b, icons }: { b: DockButton; icons: Record<string, string> }) {
  const box = (child: ReactNode) => (
    <span
      style={{
        width: 32,
        height: 32,
        flex: 'none',
        borderRadius: 8,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--cc-pane-2)',
        border: '1px solid var(--cc-line)',
        overflow: 'hidden',
      }}
    >
      {child}
    </span>
  );
  if ((b.kind === 'app' || b.kind === 'game') && b.target) {
    const src = icons[keyOf(b.target)];
    return box(
      src ? (
        <img src={src} alt="" data-art={keyOf(b.target)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span className="cc-mini">{b.name.slice(0, 2)}</span>
      )
    );
  }
  const glyph =
    b.kind === 'toggle'
      ? b.toggle === 'media'
        ? 'media'
        : (b.toggle ?? 'mic')
      : (b.glyph ?? (b.kind === 'scene' ? 'play' : b.target?.kind === 'path' ? (b.target.folder ? 'folder' : 'file') : 'link'));
  return box(<Icon glyph={glyph} size={18} />);
}

function Back({ to, label, onBack }: { to: string; label: string; onBack: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
      <button className="cc-chip" style={{ padding: '4px 12px' }} onClick={onBack}>
        ‹ {to}
      </button>
      <span style={{ fontSize: 16 }}>{label}</span>
    </div>
  );
}

/** A row that leads somewhere: the whole row is the target. */
function Lead({
  label,
  desc,
  icon,
  onGo,
  data,
  lit = false,
}: {
  label: string;
  desc?: ReactNode;
  icon?: ReactNode;
  onGo: () => void;
  data?: string;
  lit?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-dock-row={data}
      data-reorder
      onClick={onGo}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onGo();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderBottom: '1px solid var(--cc-line)',
        cursor: 'pointer',
        minWidth: 0,
        background: lit ? 'var(--cc-pane-2)' : undefined,
      }}
    >
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        {desc && (
          <div
            style={{
              marginTop: 3,
              fontSize: 12,
              lineHeight: 1.45,
              color: 'var(--cc-muted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {desc}
          </div>
        )}
      </div>
      <span aria-hidden style={{ width: 20, textAlign: 'center', color: 'var(--cc-dim)', fontSize: 15 }}>
        ›
      </span>
    </div>
  );
}

/** Every layout, presets first, for a scene's Layout step. */
function useLayoutIds(): string[] {
  const { settings } = useSettings();
  return [...Object.keys(PRESETS), ...settings.layouts.map((l) => l.id)];
}

/**
 * The dock's buttons, the group this tile shows, and the pages that add and
 * change them, all inside the one sheet.
 */
export function DockOptions({ tile }: OptionsProps) {
  const { settings, layout, editArrangement, setDock } = useSettings();
  const { shape } = useWindowShape();
  // The buttons' own, and the add sheet's list's once it has been asked for.
  const pinned = useTopic<DockIconsPayload>('dock:icons')?.icons;
  const listed = useTopic<DockAppsPayload>('dock:apps')?.icons;
  const icons = { ...listed, ...pinned };
  const [page, setPage] = useState<Page>(() => {
    const start = startAt.page;
    startAt.page = null;
    return start === 'add' ? { at: 'add', scene: null } : { at: 'list' };
  });
  const dock = settings.dock;
  const t = tile === null ? undefined : layout.shapes[shape].tiles[tile];
  const group = groupOf(dock, t?.widget === 'dock' ? t.props?.group : undefined);
  const layoutName = (id: string) => findLayout(settings, id)?.name ?? 'gone';

  const addButton = (b: Omit<DockButton, 'id'>) =>
    setDock((d) => {
      const id = newId((x) => x in d.buttons, b.name, 'button');
      return {
        buttons: { ...d.buttons, [id]: { ...b, id } },
        groups: d.groups.map((g) => (g.id === group.id ? { ...g, buttons: [...g.buttons, id] } : g)),
      };
    });
  const addStep = (scene: string, step: Step) =>
    setDock((d) => {
      const s = d.buttons[scene];
      return s ? { ...d, buttons: { ...d.buttons, [scene]: { ...s, steps: [...(s.steps ?? []), step] } } } : d;
    });
  const pick = (target: DockTarget, name: string, kind: ButtonKind, scene: string | null) => {
    if (scene) {
      addStep(scene, { do: 'open', target, name });
      setPage({ at: 'edit', id: scene });
    } else addButton({ kind, name, target });
  };

  if (page.at === 'add') {
    const scene = page.scene;
    const newScene = () => {
      const id = newId((x) => x in dock.buttons, 'scene', 'scene');
      setDock((d) => ({
        buttons: { ...d.buttons, [id]: { id, kind: 'scene', name: 'Scene', glyph: 'play', steps: [] } },
        groups: d.groups.map((g) => (g.id === group.id ? { ...g, buttons: [...g.buttons, id] } : g)),
      }));
      setPage({ at: 'edit', id });
    };
    return (
      <>
        <Back
          to={scene ? (dock.buttons[scene]?.name ?? 'Scene') : group.name}
          label={scene ? 'Add a step' : 'Add a button'}
          onBack={() => setPage(scene ? { at: 'edit', id: scene } : { at: 'list' })}
        />
        <Group label="Opens" note="Its window if it has one, else it starts" />
        <Lead
          data="add-app"
          label="An app"
          desc="From the Start menu · shows what Kehai knows about it"
          icon={<Mini b={{ id: '', kind: 'scene', name: '', glyph: 'work' }} icons={{}} />}
          onGo={() => setPage({ at: 'app', scene })}
        />
        <Lead
          data="add-game"
          label="A Steam game"
          desc="Your installed games, with Steam’s own art"
          icon={<Mini b={{ id: '', kind: 'scene', name: '', glyph: 'game' }} icons={{}} />}
          onGo={() => setPage({ at: 'game', scene })}
        />
        <Lead
          data="add-link"
          label="A link, a file or a folder"
          desc="A web page (https), or one you pick in Windows’ own picker"
          icon={<Mini b={{ id: '', kind: 'link', name: '' }} icons={{}} />}
          onGo={() => setPage({ at: 'link', scene })}
        />
        {!scene && (
          <>
            <Group label="Does" note="On this PC, at once" />
            <Lead
              data="add-toggle"
              label="A toggle"
              desc="Mic, sound, focus timer, play and pause"
              icon={<Mini b={{ id: '', kind: 'toggle', name: '', toggle: 'mic' }} icons={{}} />}
              onGo={() => setPage({ at: 'toggle' })}
            />
            <Lead
              data="add-scene"
              label="A scene"
              desc="Several of these in order, plus Kehai’s own settings"
              icon={<Mini b={{ id: '', kind: 'scene', name: '' }} icons={{}} />}
              onGo={newScene}
            />
          </>
        )}
        {scene && <SettingSteps scene={scene} addStep={addStep} onDone={() => setPage({ at: 'edit', id: scene })} />}
      </>
    );
  }

  const back = (scene: string | null) => () => setPage({ at: 'add', scene });
  if (page.at === 'app')
    return <AppPicker scene={page.scene} group={group} icons={icons} onBack={back(page.scene)} onPick={pick} />;
  if (page.at === 'game')
    return <GamePicker scene={page.scene} group={group} icons={icons} onBack={back(page.scene)} onPick={pick} />;
  if (page.at === 'link') return <LinkPicker scene={page.scene} onBack={back(page.scene)} onPick={pick} />;

  if (page.at === 'toggle') {
    const have = new Set(group.buttons.map((id) => dock.buttons[id]?.toggle).filter(Boolean));
    return (
      <>
        <Back to={group.name} label="Add a toggle" onBack={back(null)} />
        <Group label="Toggles" note="Each shows its own state" />
        {(Object.keys(TOGGLE_NAME) as Toggle[]).map((k) => (
          <Row key={k} label={TOGGLE_NAME[k]} desc={TOGGLE_DESC[k]}>
            <button
              className={have.has(k) ? 'cc-chip cc-chip-on' : 'cc-chip'}
              onClick={() => !have.has(k) && addButton({ kind: 'toggle', name: TOGGLE_NAME[k], toggle: k })}
            >
              {have.has(k) ? 'Added' : 'Add'}
            </button>
          </Row>
        ))}
      </>
    );
  }

  if (page.at === 'edit') {
    const b = dock.buttons[page.id];
    if (!b) return <Back to={group.name} label="Removed" onBack={() => setPage({ at: 'list' })} />;
    return (
      <Edit
        b={b}
        icons={icons}
        layoutName={layoutName}
        onBack={() => setPage({ at: 'list' })}
        onAddStep={() => setPage({ at: 'add', scene: b.id })}
      />
    );
  }

  const setGroup = (id: string) => tile !== null && editArrangement(settings.layoutId, shape, (a) => withTileProp(a, tile, 'group', id));
  return (
    <>
      {t?.widget === 'dock' && dock.groups.length > 1 && (
        <>
          <Group label="This tile" note={`On ${layout.name} only`} />
          {isPreset(settings.layoutId) && (
            <div className="cc-mini" style={{ marginBottom: 6, lineHeight: 1.6 }}>
              {layout.name} is a preset, so a change here saves a copy of it under Yours.
            </div>
          )}
          <Row label="Shows" desc="The group of buttons this tile holds.">
            <Seg
              options={dock.groups.map((g) => g.id)}
              value={group.id}
              format={(id) => dock.groups.find((g) => g.id === id)?.name ?? id}
              onPick={setGroup}
            />
          </Row>
        </>
      )}
      <ButtonList group={group} icons={icons} layoutName={layoutName} onEdit={(id) => setPage({ at: 'edit', id })} />
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="cc-chip cc-primary" data-dock-add-button onClick={() => setPage({ at: 'add', scene: null })}>
          Add a button
        </button>
      </div>
      <Groups current={group.id} />
    </>
  );
}

function ButtonList({
  group,
  icons,
  layoutName,
  onEdit,
}: {
  group: DockGroup;
  icons: Record<string, string>;
  layoutName: (id: string) => string;
  onEdit: (id: string) => void;
}) {
  const { settings, setDock } = useSettings();
  const dock = settings.dock;
  const ids = group.buttons.filter((id) => dock.buttons[id]);
  const { order, handle, dragging } = useReorder(ids.length, (from, to) =>
    setDock((d) => ({
      ...d,
      groups: d.groups.map((g) => (g.id === group.id ? { ...g, buttons: move(g.buttons.filter((id) => d.buttons[id]), from, to) } : g)),
    }))
  );

  const desc = (b: DockButton) => {
    const shows = (k: 'app' | 'game') => {
      const off = LIVE_OF[k].filter((l) => b.off?.includes(l)).length;
      return off ? ` · shows ${LIVE_OF[k].length - off} of ${LIVE_OF[k].length}` : '';
    };
    switch (b.kind) {
      case 'scene':
        return `Scene · ${sceneLine(b.steps ?? [], layoutName)}`;
      case 'toggle':
        return `Toggle · ${TOGGLE_SHORT[b.toggle ?? 'mic']}`;
      case 'link':
        return `${b.target?.kind === 'path' ? (b.target.folder ? 'Folder' : 'File') : 'Link'} · ${
          b.target?.kind === 'link' ? b.target.url.replace(/^https:\/\//, '') : b.target?.kind === 'path' ? b.target.path : ''
        }`;
      case 'game':
        return `Game · through Steam${shows('game')}`;
      case 'app':
        return `App · from the Start menu${shows('app')}`;
    }
  };

  return (
    <>
      <Group label={group.name} note={`${ids.length} buttons · every tile showing ${group.name}`} />
      {ids.length === 0 && (
        <div className="cc-mini" style={{ padding: '10px 0', lineHeight: 1.6 }}>
          None yet.
        </div>
      )}
      {order.map((i) => {
        const b = dock.buttons[ids[i]];
        return (
          <Lead
            key={b.id}
            data={`btn-${b.id}`}
            label={b.name}
            desc={desc(b)}
            lit={dragging === i}
            icon={
              <>
                <span {...handle(i)}>⠿</span>
                <Mini b={b} icons={icons} />
              </>
            }
            onGo={() => onEdit(b.id)}
          />
        );
      })}
    </>
  );
}

/** The groups: named, renamed, added and removed. */
function Groups({ current }: { current: string }) {
  const { settings, setDock } = useSettings();
  const groups = settings.dock.groups;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sure, setSure] = useState<string | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const rename = (id: string, name: string) =>
    setDock((d) => ({ ...d, groups: d.groups.map((g) => (g.id === id ? { ...g, name: name.trim() || g.name } : g)) }));
  // Buttons in no other group go with it.
  const remove = (id: string) =>
    setDock((d) => {
      const groups = d.groups.filter((g) => g.id !== id);
      const kept = new Set(groups.flatMap((g) => g.buttons));
      return { groups, buttons: Object.fromEntries(Object.entries(d.buttons).filter(([b]) => kept.has(b))) };
    });
  const add = () =>
    setDock((d) => {
      const id = newId((x) => d.groups.some((g) => g.id === x), `group ${d.groups.length + 1}`, 'group');
      return { ...d, groups: [...d.groups, { id, name: `Group ${d.groups.length + 1}`, buttons: [] }] };
    });

  return (
    <>
      <Group label="Groups" note="Each Dock tile shows one · a button can be in several" />
      {groups.map((g) =>
        renaming === g.id ? (
          <div key={g.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--cc-line)' }}>
            <input
              className="cc-field"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  rename(g.id, draft);
                  setRenaming(null);
                }
              }}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              className="cc-chip"
              onClick={() => {
                rename(g.id, draft);
                setRenaming(null);
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <Row key={g.id} label={g.name} desc={`${g.buttons.length} buttons${g.id === current ? ' · this tile' : ''}`}>
            <button
              className="cc-chip"
              onClick={() => {
                setDraft(g.name);
                setRenaming(g.id);
              }}
            >
              Rename
            </button>
            {groups.length > 1 && (
              <button
                className="cc-chip cc-danger"
                onClick={() => {
                  if (sure === g.id) {
                    setSure(null);
                    remove(g.id);
                    return;
                  }
                  setSure(g.id);
                  window.clearTimeout(timer.current);
                  timer.current = window.setTimeout(() => setSure(null), SURE_MS);
                }}
              >
                {sure === g.id ? 'Tap again' : 'Remove'}
              </button>
            )}
          </Row>
        )
      )}
      <div className="cc-mini" style={{ marginTop: 10, lineHeight: 1.6 }}>
        Removing a group keeps its buttons that are in another group too. A tile showing it shows the first group instead.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="cc-chip" onClick={add}>
          New group
        </button>
      </div>
    </>
  );
}

/** The steps that change Kehai or the PC rather than open something. */
function SettingSteps({ scene, addStep, onDone }: { scene: string; addStep: (scene: string, s: Step) => void; onDone: () => void }) {
  const { settings } = useSettings();
  const add = (s: Step) => {
    addStep(scene, s);
    onDone();
  };
  return (
    <>
      <Group label="Sets" note="Kehai’s own, and this PC’s sound" />
      <Row label="Switch layout" desc="Puts a layout on this panel.">
        <button className="cc-chip" onClick={() => add({ do: 'layout', layout: settings.layoutId })}>
          Add
        </button>
      </Row>
      <Row label="Focus timer" desc="Starts or pauses it.">
        <button className="cc-chip" onClick={() => add({ do: 'focus', on: true })}>
          Add
        </button>
      </Row>
      <Row label="Sound" desc="A level, or muted, for this PC.">
        <button className="cc-chip" onClick={() => add({ do: 'sound', level: 40, muted: false })}>
          Add
        </button>
      </Row>
      <Row label="Mic" desc="Muted or on, for every app.">
        <button className="cc-chip" onClick={() => add({ do: 'mic', muted: true })}>
          Add
        </button>
      </Row>
      <Row label="Music" desc="Plays or pauses what Now playing shows.">
        <button className="cc-chip" onClick={() => add({ do: 'media', playing: true })}>
          Add
        </button>
      </Row>
      <Row label="Brightness" desc="This display’s, the level it comes back to by day.">
        <button className="cc-chip" onClick={() => add({ do: 'brightness', level: 60 })}>
          Add
        </button>
      </Row>
    </>
  );
}

/** The Start menu and Steam's games, asked for once the sheet needs them. */
function useApps(): DockAppsPayload | undefined {
  const apps = useTopic<DockAppsPayload>('dock:apps');
  useEffect(() => bus.publish<DockCommand>('dock:command', 'widget.dock', { action: 'list' }), []);
  return apps;
}

type Pick = (target: DockTarget, name: string, kind: ButtonKind, scene: string | null) => void;

/** What a group already holds, by kind and id, so the pickers can say Added. */
function holds(dock: DockSettings, group: DockGroup, kind: 'app' | 'game'): Set<string> {
  const out = new Set<string>();
  for (const id of group.buttons) {
    const t = dock.buttons[id]?.target;
    if (t?.kind === kind) out.add(t.id);
  }
  return out;
}

function AppPicker({
  scene,
  group,
  icons,
  onBack,
  onPick,
}: {
  scene: string | null;
  group: DockGroup;
  icons: Record<string, string>;
  onBack: () => void;
  onPick: Pick;
}) {
  const { settings } = useSettings();
  const list = useApps();
  const [q, setQ] = useState('');
  const here = holds(settings.dock, group, 'app');
  const notified = (id: string) => settings.notify.apps[id]?.lastMs ?? 0;
  const apps = (list?.apps ?? []).filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase()));
  const row = (a: { id: string; name: string }, desc: string) => {
    const added = !scene && here.has(a.id);
    const src = icons[`app:${a.id}`];
    return (
      <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--cc-line)', minWidth: 0 }}>
        <span style={{ width: 28, height: 28, flex: 'none', display: 'inline-flex' }}>
          {src && <img src={src} alt="" width={28} height={28} style={{ borderRadius: 6 }} />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</div>
          <div className="cc-mini">{desc}</div>
        </div>
        <button
          className={added ? 'cc-chip cc-chip-on' : 'cc-chip'}
          onClick={() => !added && onPick({ kind: 'app', id: a.id }, a.name, 'app', scene)}
        >
          {added ? 'Added' : 'Add'}
        </button>
      </div>
    );
  };
  const running = apps.filter((a) => a.running);
  const lately = apps.filter((a) => !a.running && notified(a.id) > 0).sort((a, b) => notified(b.id) - notified(a.id));
  const rest = apps.filter((a) => !a.running && !notified(a.id));
  return (
    <>
      <Back to={scene ? 'Steps' : 'Add'} label={scene ? 'Open an app' : 'Add an app'} onBack={onBack} />
      <input
        className="cc-field"
        placeholder="Search the Start menu"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: '100%', marginTop: 14 }}
      />
      {!list && (
        <div className="cc-mini" style={{ marginTop: 12 }}>
          Reading the Start menu…
        </div>
      )}
      {running.length > 0 && <Group label="Open now" note="Apps with a window" />}
      {running.map((a) => row(a, 'Open now'))}
      {lately.length > 0 && <Group label="Notified you lately" note="Newest first" />}
      {lately.map((a) => row(a, `Last notification ${ago(notified(a.id)).replace('never played', 'never')}`))}
      {list && <Group label="Every app" note={`${list.apps.length} in the Start menu · A to Z`} />}
      {rest.map((a) => row(a, 'Start menu'))}
    </>
  );
}

function GamePicker({
  scene,
  group,
  icons,
  onBack,
  onPick,
}: {
  scene: string | null;
  group: DockGroup;
  icons: Record<string, string>;
  onBack: () => void;
  onPick: Pick;
}) {
  const { settings } = useSettings();
  const list = useApps();
  const here = holds(settings.dock, group, 'game');
  const games = [...(list?.games ?? [])].sort((a, b) => b.playedMs - a.playedMs);
  return (
    <>
      <Back to={scene ? 'Steps' : 'Add'} label={scene ? 'Open a game' : 'Add a game'} onBack={onBack} />
      <Group
        label="Steam"
        note={!list ? 'Reading Steam’s library…' : list.steam ? `${games.length} installed · last played first` : 'Not found on this PC'}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(116px, 1fr))', gap: 12, marginTop: 8 }}>
        {games.map((g) => {
          const added = !scene && here.has(g.id);
          const src = icons[`game:${g.id}`];
          return (
            <button
              key={g.id}
              data-dock-game={g.id}
              onClick={() => !added && onPick({ kind: 'game', id: g.id }, g.name, 'game', scene)}
              style={{
                font: 'inherit',
                color: 'var(--cc-text)',
                background: 'transparent',
                border: 0,
                padding: 0,
                textAlign: 'left',
                cursor: 'pointer',
                minWidth: 0,
              }}
            >
              <div
                style={{
                  position: 'relative',
                  aspectRatio: '2 / 3',
                  borderRadius: 12,
                  overflow: 'hidden',
                  border: added ? '2px solid var(--cc-accent)' : '1px solid var(--cc-line)',
                  background: 'var(--cc-pane-2)',
                }}
              >
                {src && (
                  <img src={src} alt="" data-art={`game:${g.id}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                )}
                {added && (
                  <span
                    className="cc-mini"
                    style={{ position: 'absolute', left: 6, top: 6, padding: '2px 8px', borderRadius: 999, background: 'var(--cc-accent)', color: 'var(--cc-bg)' }}
                  >
                    Added
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</div>
              <div className="cc-mini">{g.running ? 'Playing now' : ago(g.playedMs)}</div>
            </button>
          );
        })}
      </div>
      <div className="cc-mini" style={{ marginTop: 14, lineHeight: 1.6 }}>
        A tap starts the game through Steam, as Steam’s own shortcuts do. The covers are Steam’s, from this PC; nothing is downloaded.
      </div>
    </>
  );
}

function LinkPicker({ scene, onBack, onPick }: { scene: string | null; onBack: () => void; onPick: Pick }) {
  const [url, setUrl] = useState('https://');
  const [added, setAdded] = useState<string | null>(null);
  // Only what was picked after asking: the bus hands back the last one on subscribe.
  const asked = useRef(0);
  const ok = /^https:\/\/[^\s/"<>`]+\.[^\s"<>`]+$/.test(url);
  useEffect(
    () =>
      bus.subscribe('dock:picked', (e) => {
        if (!asked.current || e.ts < asked.current) return;
        asked.current = 0;
        const p = e.data as DockPicked;
        onPick({ kind: 'path', path: p.path, folder: p.folder }, p.name, 'link', scene);
        setAdded(p.name);
      }),
    // `onPick` changes every render; what it does doesn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scene]
  );
  const choose = (folder: boolean) => {
    asked.current = Date.now();
    bus.publish<DockCommand>('dock:command', 'widget.dock', { action: 'pick', folder });
  };
  return (
    <>
      <Back to={scene ? 'Steps' : 'Add'} label="A link, a file or a folder" onBack={onBack} />
      <Group label="Web page" note="Opens in your browser" />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input className="cc-field" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        <button
          className="cc-chip"
          disabled={!ok}
          onClick={() => {
            if (!ok) return;
            const name = new URL(url).host.replace(/^www\./, '');
            onPick({ kind: 'link', url }, name, 'link', scene);
            setAdded(name);
            setUrl('https://');
          }}
        >
          Add
        </button>
      </div>
      <div className="cc-mini" style={{ marginTop: 8, lineHeight: 1.6 }}>
        Only https links. Kehai hands it to Windows, which opens it in your browser.
      </div>
      <Group label="File or folder" note="Opens as File Explorer would open it" />
      <Row label="A file" desc="Chosen in Windows’ own picker, on this PC.">
        <button className="cc-chip" onClick={() => choose(false)}>
          Choose…
        </button>
      </Row>
      <Row label="A folder" desc="Opens in File Explorer.">
        <button className="cc-chip" onClick={() => choose(true)}>
          Choose…
        </button>
      </Row>
      {added && !scene && (
        <div className="cc-mini" style={{ marginTop: 10, color: 'var(--cc-accent)' }}>
          Added {added}.
        </div>
      )}
    </>
  );
}

function Edit({
  b,
  icons,
  layoutName,
  onBack,
  onAddStep,
}: {
  b: DockButton;
  icons: Record<string, string>;
  layoutName: (id: string) => string;
  onBack: () => void;
  onAddStep: () => void;
}) {
  const { settings, setDock } = useSettings();
  const dock = settings.dock;
  const layouts = useLayoutIds();
  const [choosing, setChoosing] = useState<number | null>(null);
  const [sure, setSure] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const change = (next: Partial<DockButton>) =>
    setDock((d) => (d.buttons[b.id] ? { ...d, buttons: { ...d.buttons, [b.id]: { ...d.buttons[b.id], ...next } } } : d));
  const groupsIn = dock.groups.filter((g) => g.buttons.includes(b.id));
  // A button stays in one group at least, or nothing would show it.
  const flipGroup = (gid: string) =>
    setDock((d) => {
      const g = d.groups.find((x) => x.id === gid);
      if (!g) return d;
      const inIt = g.buttons.includes(b.id);
      if (inIt && d.groups.filter((x) => x.buttons.includes(b.id)).length === 1) return d;
      return {
        ...d,
        groups: d.groups.map((x) => (x.id !== gid ? x : inIt ? { ...x, buttons: x.buttons.filter((id) => id !== b.id) } : { ...x, buttons: [...x.buttons, b.id] })),
      };
    });
  const remove = () =>
    setDock((d) => ({
      buttons: Object.fromEntries(Object.entries(d.buttons).filter(([id]) => id !== b.id)),
      groups: d.groups.map((g) => ({ ...g, buttons: g.buttons.filter((id) => id !== b.id) })),
    }));
  const steps = b.steps ?? [];
  const setStep = (i: number, s: Step | null) => {
    change({ steps: s ? steps.map((x, j) => (j === i ? s : x)) : steps.filter((_, j) => j !== i) });
    if (!s) setChoosing(null);
  };
  const { order, handle, dragging } = useReorder(steps.length, (from, to) => {
    change({ steps: move(steps, from, to) });
    setChoosing(null);
  });
  const opens =
    b.target?.kind === 'link'
      ? b.target.url
      : b.target?.kind === 'path'
        ? b.target.path
        : b.kind === 'app'
          ? 'Its window, or it starts from the Start menu.'
          : b.kind === 'game'
            ? 'The game’s window, or Steam starts it.'
            : null;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, minWidth: 0 }}>
        <button className="cc-chip" style={{ padding: '4px 12px' }} onClick={onBack}>
          ‹ Buttons
        </button>
        <Mini b={b} icons={icons} />
        <span style={{ fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{b.name}</span>
        <span className="cc-mini" style={{ flex: 'none' }}>
          {b.target?.kind === 'path' ? (b.target.folder ? 'Folder' : 'File') : KIND_NAME[b.kind]}
        </span>
      </div>
      <Row label="Name" desc="Under its icon on the tile.">
        <input className="cc-field" value={b.name} maxLength={40} onChange={(e) => change({ name: e.target.value })} style={{ width: 180 }} />
      </Row>
      {opens && <Row label="A tap opens" desc={opens} />}

      {(b.kind === 'scene' || b.kind === 'link') && (
        <Row label="Mark">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {SCENE_GLYPHS.map((g) => (
              <button
                key={g}
                className={g === (b.glyph ?? (b.kind === 'scene' ? 'play' : 'link')) ? 'cc-chip cc-chip-on' : 'cc-chip cc-bare'}
                style={{ padding: 0, width: 32, height: 32 }}
                onClick={() => change({ glyph: g })}
                aria-label={g}
              >
                <Icon glyph={g} size={16} />
              </button>
            ))}
          </div>
        </Row>
      )}

      {(b.kind === 'app' || b.kind === 'game') && (
        <>
          <Group label="Shows" note="What Kehai knows about it" />
          {LIVE_OF[b.kind].map((l: Live) => (
            <Row key={l} label={LIVE_NAME[l]} desc={LIVE_DESC[l]}>
              <Seg
                options={['Off', 'On']}
                value={b.off?.includes(l) ? 'Off' : 'On'}
                onPick={(v) => change({ off: v === 'On' ? (b.off ?? []).filter((x) => x !== l) : [...(b.off ?? []), l] })}
              />
            </Row>
          ))}
        </>
      )}

      {b.kind === 'toggle' && <Row label="A tap" desc={TOGGLE_DESC[b.toggle ?? 'mic']} />}

      {b.kind === 'scene' && (
        <>
          <Group label="Steps" note="In order, one tap · nothing is ever closed" />
          {steps.length === 0 && (
            <div className="cc-mini" style={{ padding: '10px 0' }}>
              No steps yet.
            </div>
          )}
          {order.map((i) => {
            const s = steps[i];
            return (
              <div key={i} data-reorder data-dock-step={i} style={{ borderBottom: '1px solid var(--cc-line)', background: dragging === i ? 'var(--cc-pane-2)' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', minWidth: 0 }}>
                  <span {...handle(i)}>⠿</span>
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      flex: 'none',
                      borderRadius: 11,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      background: 'var(--cc-pane-2)',
                      color: 'var(--cc-muted)',
                    }}
                  >
                    {order.indexOf(i) + 1}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.do === 'open' ? (
                      <>
                        <span style={{ color: 'var(--cc-muted)' }}>Open </span>
                        {s.name}
                      </>
                    ) : (
                      STEP_LABEL[s.do]
                    )}
                  </span>
                  <StepControl s={s} layoutName={layoutName} open={choosing === i} onOpen={() => setChoosing(choosing === i ? null : i)} onChange={(n) => setStep(i, n)} />
                  <button className="cc-dismiss" style={{ opacity: 0.6 }} aria-label="Remove this step" onClick={() => setStep(i, null)}>
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
                {choosing === i && (
                  <div style={{ padding: '0 0 10px 52px' }}>
                    <Choices
                      s={s}
                      layouts={layouts}
                      layoutName={layoutName}
                      onChange={(n) => {
                        setStep(i, n);
                        setChoosing(null);
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="cc-chip" data-dock-add-step onClick={onAddStep}>
              Add a step
            </button>
          </div>
          <div className="cc-mini" style={{ marginTop: 10, lineHeight: 1.6 }}>
            A step that opens something brings it forward if it is already open. If one fails the rest still run, and the button says which.
          </div>
        </>
      )}

      <Group label="In groups" note="On every tile showing them" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {dock.groups.map((g) => {
          const on = g.buttons.includes(b.id);
          return (
            <button key={g.id} className={on ? 'cc-chip cc-chip-on' : 'cc-chip'} onClick={() => flipGroup(g.id)}>
              {on ? '✓ ' : ''}
              {g.name}
            </button>
          );
        })}
      </div>
      {groupsIn.length === 1 && dock.groups.length > 1 && (
        <div className="cc-mini" style={{ marginTop: 8 }}>
          A button stays in one group at least.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 28 }}>
        <button
          className="cc-chip cc-danger"
          onClick={() => {
            if (sure) {
              remove();
              onBack();
              return;
            }
            setSure(true);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setSure(false), SURE_MS);
          }}
        >
          {sure ? 'Tap again to remove it' : 'Remove from the dock'}
        </button>
      </div>
    </>
  );
}

/** A value that opens its choices under the step. */
function Choose({ label, open, onOpen }: { label: string; open: boolean; onOpen: () => void }) {
  return (
    <button className={open ? 'cc-chip cc-chip-on' : 'cc-chip'} style={{ padding: '4px 12px', gap: 8 }} onClick={onOpen}>
      {label}
      <span aria-hidden style={{ color: 'var(--cc-dim)', fontSize: 10 }}>
        {open ? '▴' : '▾'}
      </span>
    </button>
  );
}

function StepControl({
  s,
  layoutName,
  open,
  onOpen,
  onChange,
}: {
  s: Step;
  layoutName: (id: string) => string;
  open: boolean;
  onOpen: () => void;
  onChange: (s: Step) => void;
}) {
  switch (s.do) {
    case 'layout':
      return <Choose label={layoutName(s.layout)} open={open} onOpen={onOpen} />;
    case 'sound':
      return <Choose label={s.muted ? 'Muted' : `${s.level ?? 40}%`} open={open} onOpen={onOpen} />;
    case 'brightness':
      return <Choose label={`${s.level}%`} open={open} onOpen={onOpen} />;
    case 'focus':
      return <Seg options={['Start', 'Pause']} value={s.on ? 'Start' : 'Pause'} onPick={(v) => onChange({ ...s, on: v === 'Start' })} />;
    case 'mic':
      return <Seg options={['Mute', 'On']} value={s.muted ? 'Mute' : 'On'} onPick={(v) => onChange({ ...s, muted: v === 'Mute' })} />;
    case 'media':
      return <Seg options={['Play', 'Pause']} value={s.playing ? 'Play' : 'Pause'} onPick={(v) => onChange({ ...s, playing: v === 'Play' })} />;
    case 'open':
      return (
        <span className="cc-mini" style={{ flex: 'none' }}>
          {s.target.kind === 'game' ? 'Steam' : s.target.kind === 'app' ? 'App' : s.target.kind === 'link' ? 'Link' : s.target.folder ? 'Folder' : 'File'}
        </span>
      );
  }
}

/** The choices a step's value opens to. */
function Choices({ s, layouts, layoutName, onChange }: { s: Step; layouts: string[]; layoutName: (id: string) => string; onChange: (s: Step) => void }) {
  switch (s.do) {
    case 'layout':
      return <Seg options={layouts} value={s.layout} format={layoutName} onPick={(layout) => onChange({ ...s, layout })} />;
    case 'sound':
      return (
        <Seg<string>
          options={['Mute', ...SOUND_LEVELS.map((l) => `${l}%`)]}
          value={s.muted ? 'Mute' : `${s.level ?? 40}%`}
          onPick={(v) => onChange(v === 'Mute' ? { ...s, muted: true } : { ...s, muted: false, level: Number(v.replace('%', '')) })}
        />
      );
    case 'brightness':
      return (
        <Seg<string>
          options={BRIGHTNESS_LEVELS.map((l) => `${l}%`)}
          value={`${s.level}%`}
          onPick={(v) => onChange({ ...s, level: Number(v.replace('%', '')) })}
        />
      );
    default:
      return null;
  }
}
