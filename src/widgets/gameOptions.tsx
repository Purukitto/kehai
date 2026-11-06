import { useState } from 'react';
import { GameSetup } from '../components/GameSetup';
import { bus } from '../core/bus';
import { forgetMatches, useMatches } from '../core/gameSession';
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

const MATCH_NAME: Record<GameSettings['onMatch'], string> = { still: 'Goes still', stay: 'Stays', layout: 'Another layout' };
const MATCH_DESC: Record<GameSettings['onMatch'], string> = {
  still:
    'Goes dark and still while you’re in a round, and keeps what comes in until you’re out of it: when you die, at half time, after the match. A touch opens it sooner.',
  stay: 'Stays as it is, moving and lighting up as usual, the whole match.',
  layout: 'Shows the layout below while the match is live, and goes back when it ends or after 2 minutes in the menu. Picking another during the match keeps that one.',
};

/**
 * A game widget's options: what the panel does while you play, which readings
 * this tile shows, the matches it keeps, and the file Kehai wrote for it.
 */
export function GameOptions({ tile, widget }: OptionsProps & { widget: GameDescription }) {
  const { settings, layout, editArrangement, setGame } = useSettings();
  const { shape } = useWindowShape();
  const setup = useTopic<GameSetupPayload>('game:setup');
  const matches = useMatches(widget.id);
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
  const hasSides = g.readings.some((r) => r.display === 'teams' && r.sides.some((s) => s.hex));

  const setReading = (id: string, on: boolean) => {
    if (tile === null) return;
    editArrangement(settings.layoutId, shape, (a) => withTileProp(a, tile, 'readings', { ...chosen, [id]: on }));
  };

  return (
    <>
      <Group label="While you play" note="Every layout" />
      <Row label="The panel" desc={MATCH_DESC[choice.onMatch]}>
        <Seg<GameSettings['onMatch']>
          options={['still', 'stay', 'layout']}
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
            format={(id) => layouts.find((l) => l.id === id)?.name ?? id}
            onPick={(id) => setGame(widget.id, { switchTo: id })}
          />
        </Row>
      )}

      <Group label="Readings" note={here ? `This tile, on ${layout.name} only` : 'Kept with each tile'} />
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
                <Seg options={['Off', 'On']} value={on ? 'On' : 'Off'} onPick={(p) => setReading(r.id, p === 'On')} />
              </Row>
            );
          })}
        </>
      )}
      {hasSides && (
        <Row label="Colours" desc={choice.colours === 'game' ? `${short}’s own for each side.` : 'The theme’s, like every other tile.'}>
          <Seg<GameSettings['colours']>
            options={['game', 'theme']}
            value={choice.colours}
            format={(v) => (v === 'game' ? `${short}’s` : 'Theme’s')}
            onPick={(colours) => setGame(widget.id, { colours })}
          />
        </Row>
      )}

      <Group label="Matches kept" note="This panel" />
      <Row
        label={matches.length ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : 'None yet'}
        desc={`How each match ended and your own figures, for tonight’s list on the tile. Only what ${short} sent while you played, kept here and nowhere else.`}
      >
        <button className="cc-chip" disabled={!matches.length} onClick={() => forgetMatches(widget.id)}>
          Forget them
        </button>
      </Row>

      <Group label="The game" note="This PC" />
      {game ? (
        <>
          <Row label={game.file.split(/[\\/]/).pop() ?? game.file} desc={<span className="cc-code">{game.file}</span>}>
            <div style={{ display: 'flex', gap: 8, flex: 'none' }}>
              <button className="cc-chip" onClick={() => send({ action: 'open', widget: widget.id })}>
                Open folder
              </button>
              <button className="cc-chip cc-danger" onClick={() => send({ action: 'remove', widget: widget.id })}>
                Remove
              </button>
            </div>
          </Row>
          <div className="cc-mini" style={{ marginTop: 10, lineHeight: 1.6 }}>
            Remove takes the file out. {short} stops sending the next time it starts.
          </div>
        </>
      ) : (
        <Row label="Not set up" desc={`${short} sends nothing until Kehai writes its file.`}>
          <button className="cc-chip cc-primary" onClick={() => setSettingUp(true)}>
            Set up
          </button>
        </Row>
      )}
      <div className="cc-mini" style={{ marginTop: 16, lineHeight: 1.6 }}>
        Tablets show this tile as it is here.
      </div>
      {settingUp && <GameSetup widget={widget} onClose={() => setSettingUp(false)} />}
    </>
  );
}
