import { useState } from 'react';
import { GameSetup } from '../components/GameSetup';
import { bus } from '../core/bus';
import { withTileProp } from '../core/layout';
import type { GameCommand, GameSetupPayload } from '../core/payloads';
import { GAME_DEFAULTS, PRESET_ORDER, PRESETS, isPreset, useSettings } from '../core/settings';
import type { GameSettings } from '../core/settings';
import type { OptionsProps } from '../core/types';
import { useTopic } from '../core/useTopic';
import { useWindowShape } from '../core/useWindowShape';
import { Group, Row, Seg } from '../settings/controls';
import type { GameDescription } from './Game';

const send = (command: GameCommand) => bus.publish<GameCommand>('game:command', 'panel', command);

const MATCH_NAME: Record<GameSettings['onMatch'], string> = { stay: 'STAY', layout: 'A LAYOUT', full: 'FULL SCREEN' };
const MATCH_DESC: Record<GameSettings['onMatch'], string> = {
  stay: 'Stays as it is. Off until you choose.',
  layout: 'Shows the layout below while the match is live, and goes back when it ends or after 2 minutes in the menu. Picking another during the match keeps that one.',
  full: 'Shows this tile over the whole panel while the match is live, and goes back when it ends or after 2 minutes in the menu.',
};

/**
 * A game widget's options: which readings this tile shows, what happens when a
 * match goes live, and the file Kehai wrote for it.
 */
export function GameOptions({ tile, widget }: OptionsProps & { widget: GameDescription }) {
  const { settings, layout, editArrangement, setGame } = useSettings();
  const { shape } = useWindowShape();
  const setup = useTopic<GameSetupPayload>('game:setup');
  const [settingUp, setSettingUp] = useState(false);
  const g = widget.game;
  const short = g.source.short;
  const t = tile === null ? undefined : layout.shapes[shape].tiles[tile];
  const here = t?.widget === widget.id ? t : undefined;
  const chosen = (here?.props?.readings ?? {}) as Record<string, unknown>;
  const game = setup?.games.find((x) => x.widget === widget.id);
  const choice = settings.games[widget.id] ?? GAME_DEFAULTS;
  const layouts = [...PRESET_ORDER.map((id) => ({ id, name: PRESETS[id].name })), ...settings.layouts.map((l) => ({ id: l.id, name: l.name }))];
  // The first choice is a layout with this game on it, if there is one besides the one on screen.
  const withGame = settings.layouts.find(
    (l) => l.id !== settings.layoutId && Object.values(l.shapes).some((a) => a.tiles.some((x) => x.widget === widget.id))
  );

  const setReading = (id: string, on: boolean) => {
    if (tile === null) return;
    editArrangement(settings.layoutId, shape, (a) => withTileProp(a, tile, 'readings', { ...chosen, [id]: on }));
  };

  return (
    <>
      <Group label="READINGS" note={here ? `THIS TILE · ON ${layout.name.toUpperCase()} ONLY` : 'KEPT WITH EACH TILE'} />
      {!here ? (
        <div className="cc-mini" style={{ lineHeight: 1.6 }}>
          {g.source.game} is not on this layout. Which readings show is kept with each tile, so hold the tile once it is.
        </div>
      ) : (
        <>
          {isPreset(settings.layoutId) && (
            <div className="cc-mini" style={{ marginBottom: 6, lineHeight: 1.6 }}>
              {layout.name} is a preset, so a change here saves a copy of it under Yours.
            </div>
          )}
          {g.readings.map((r) => {
            const v = chosen[r.id];
            const on = typeof v === 'boolean' ? v : r.on;
            return (
              <Row key={r.id} label={r.name} desc={r.about}>
                <Seg options={['OFF', 'ON']} value={on ? 'ON' : 'OFF'} onPick={(p) => setReading(r.id, p === 'ON')} />
              </Row>
            );
          })}
          <div className="cc-mini" style={{ marginTop: 10, lineHeight: 1.6 }}>
            In this order of importance: a small tile drops the last ones first.
          </div>
        </>
      )}

      <Group label="WHEN A MATCH GOES LIVE" note="EVERY LAYOUT" />
      <Row label="The panel" desc={MATCH_DESC[choice.onMatch]}>
        <Seg<GameSettings['onMatch']>
          options={['stay', 'layout', 'full']}
          value={choice.onMatch}
          format={(v) => MATCH_NAME[v]}
          onPick={(onMatch) =>
            setGame(widget.id, {
              onMatch,
              switchTo: choice.switchTo ?? withGame?.id ?? layouts.find((l) => l.id !== settings.layoutId)?.id ?? settings.layoutId,
            })
          }
        />
      </Row>
      {choice.onMatch === 'layout' && choice.switchTo && (
        <Row label="Switch to">
          <Seg
            options={layouts.map((l) => l.id)}
            value={choice.switchTo}
            format={(id) => (layouts.find((l) => l.id === id)?.name ?? id).toUpperCase()}
            onPick={(id) => setGame(widget.id, { switchTo: id })}
          />
        </Row>
      )}
      <div className="cc-mini" style={{ marginTop: 10, lineHeight: 1.6 }}>
        A tap on the tile shows it full screen at any time, and another tap goes back.
      </div>

      <Group label="LOOK" note="EVERY LAYOUT" />
      <Row label="Colours" desc={choice.colours === 'game' ? `${short}’s own: each side’s colour, health green to red, money green.` : 'The theme’s, like every other tile.'}>
        <Seg<GameSettings['colours']>
          options={['game', 'theme']}
          value={choice.colours}
          format={(v) => (v === 'game' ? `${short}’S` : 'THEME’S')}
          onPick={(colours) => setGame(widget.id, { colours })}
        />
      </Row>
      <Row label="Lighting" desc="The tile’s edge in your side’s colour at buy time, red while the bomb is down or health is low, orange while burning; a flash and smoke wash over it. As RGB lighting does.">
        <Seg options={['OFF', 'ON']} value={choice.lighting ? 'ON' : 'OFF'} onPick={(v) => setGame(widget.id, { lighting: v === 'ON' })} />
      </Row>

      <Group label={`THE GAME`} note="THIS PC" />
      {game ? (
        <>
          <Row label={game.file.split(/[\\/]/).pop() ?? game.file} desc={game.file}>
            <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
              <button className="cc-chip" style={{ padding: '7px 13px' }} onClick={() => send({ action: 'open', widget: widget.id })}>
                OPEN FOLDER
              </button>
              <button
                className="cc-chip"
                style={{ padding: '7px 13px', color: 'var(--cc-danger)', borderColor: 'var(--cc-danger)' }}
                onClick={() => send({ action: 'remove', widget: widget.id })}
              >
                REMOVE
              </button>
            </div>
          </Row>
          <div className="cc-mini" style={{ marginTop: 10, lineHeight: 1.6 }}>
            REMOVE takes the file out. {short} stops sending the next time it starts.
          </div>
        </>
      ) : (
        <Row label="Not set up" desc={`${short} sends nothing until Kehai writes its file.`}>
          <button className="cc-chip" style={{ padding: '7px 13px', color: 'var(--cc-accent)', borderColor: 'var(--cc-accent)' }} onClick={() => setSettingUp(true)}>
            SET UP
          </button>
        </Row>
      )}
      <div className="cc-mini" style={{ marginTop: 14, lineHeight: 1.6 }}>
        Tablets show this tile as it is here.
      </div>
      {settingUp && <GameSetup widget={widget} onClose={() => setSettingUp(false)} />}
    </>
  );
}
