import { bus } from './bus';
import type { GameCommand, GamePayload, GameSetupPayload, LocalWidgetsPayload } from './payloads';

/**
 * A CS2 match and the widgets folder, for building the game widgets in a
 * browser. SET UP is answered as the engine would, then a match plays out a
 * round every half minute: buy time, live, a bomb planted, a death and a
 * teammate watched, until the match ends and it starts again.
 *
 * `?game=live` starts with CS2 set up and a match on.
 */

const FOLDER = 'E:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive';
const FILE = `${FOLDER}\\game\\csgo\\cfg\\gamestate_integration_kehai_cs2.cfg`;

const LOCAL: LocalWidgetsPayload = {
  folder: 'C:\\Users\\you\\AppData\\Roaming\\dev.purukitto.kehai\\widgets',
  files: [
    {
      name: 'dota2.widget.json',
      error: null,
      text: JSON.stringify({
        kehai: 1,
        id: 'dota2',
        name: 'Dota 2',
        about: 'Your hero’s health, mana, gold and the clock, while you play.',
        min: [2, 1],
        source: {
          kind: 'valve-gsi',
          game: 'Dota 2',
          short: 'DOTA 2',
          steamApp: 570,
          cfgDir: 'game/dota/cfg/gamestate_integration',
          data: ['provider', 'map', 'player', 'hero'],
          asks: ['Your hero’s health and mana', 'Your gold, kills and deaths', 'The clock'],
          never: ['Other players', 'Where anyone is'],
        },
        match: { in: 'map.clock_time', title: '{map.name}', phase: 'map.game_state', over: ['DOTA_GAMERULES_STATE_POST_GAME'] },
        readings: [
          {
            id: 'vitals',
            display: 'meters',
            name: 'Health and mana',
            about: 'Your hero’s.',
            items: [
              { label: 'HEALTH', value: 'hero.health_percent', max: 100, low: 30 },
              { label: 'MANA', value: 'hero.mana_percent', max: 100 },
            ],
          },
          { id: 'gold', display: 'numbers', name: 'Gold', about: 'To spend.', items: [{ label: 'GOLD', value: 'player.gold' }] },
        ],
      }),
    },
    {
      name: 'lap-timer.widget.json',
      error: null,
      text: JSON.stringify({ kehai: 1, id: 'lap-timer', name: 'Lap timer', about: 'Laps, from the game’s telemetry.', min: [2, 1], source: { kind: 'udp', port: 20777 } }),
    },
    { name: 'my-widget.widget.json', error: null, text: '{\n  "kehai": 1,\n  "id": "my-widget",\n  "name": "Mine",\n  "fields": [\n' },
  ],
};

const WEAPONS = ['weapon_m4a1_silencer', 'weapon_ak47', 'weapon_awp', 'weapon_usp_silencer'];

function cs2(t: number, n: number) {
  // A round every 30 ticks of a second; the match is 24 rounds, then a pause.
  const round = Math.floor(t / 30) % 26;
  const at = t % 30;
  if (round >= 24) {
    return round === 24 ? { over: true, round: 23 } : null;
  }
  const phase = at < 6 ? 'freezetime' : at < 27 ? 'live' : 'over';
  const bomb = at >= 16 && at < 27 && round % 3 === 1 ? 'planted' : undefined;
  const dead = at >= 20 && at < 27 && round % 4 === 2;
  const wins: Record<string, string> = {};
  for (let i = 1; i <= round; i++) wins[String(i)] = (i * 7 + n) % 5 < 3 ? 'ct_win_elimination' : 't_win_bomb';
  const ct = Object.values(wins).filter((v) => v.startsWith('ct')).length;
  const health = phase === 'freezetime' ? 100 : Math.max(dead ? 0 : 8, 100 - (at - 6) * 4);
  return {
    over: false,
    round,
    data: {
      provider: { name: 'Counter-Strike 2', appid: 730, version: 14082, steamid: '76561198000000001', timestamp: Math.floor(Date.now() / 1000) },
      map: {
        mode: 'competitive',
        name: 'de_mirage',
        phase: 'live',
        round,
        team_ct: { score: ct },
        team_t: { score: round - ct },
        round_wins: wins,
      },
      round: { phase, ...(bomb ? { bomb } : {}), ...(phase === 'over' ? { win_team: round % 2 ? 'CT' : 'T' } : {}) },
      player: {
        steamid: dead ? '76561198000000002' : '76561198000000001',
        name: dead ? 'ropz' : 'you',
        team: 'CT',
        activity: 'playing',
        state: {
          health: dead ? 41 : health,
          armor: phase === 'freezetime' ? 100 : Math.max(0, 100 - (at - 6) * 3),
          helmet: true,
          money: 800 + ((round * 1350) % 9000),
          // A flash at 10 s that fades, smoke from 13 s, and fire late in some rounds.
          flashed: at >= 10 && at < 13 ? Math.round(255 * (1 - (at - 10) / 3)) : 0,
          smoked: at >= 13 && at < 16 ? 180 : 0,
          burning: at >= 23 && at < 26 && round % 2 === 0 ? 255 : 0,
          round_kills: Math.floor(at / 9),
          round_killhs: Math.floor(at / 18),
          equip_value: 5650,
        },
        weapons: {
          weapon_0: { name: 'weapon_knife', type: 'Knife', state: 'holstered' },
          weapon_1: {
            name: WEAPONS[round % WEAPONS.length],
            type: 'Rifle',
            ammo_clip: Math.max(0, 30 - (at % 12) * 2),
            ammo_clip_max: 30,
            ammo_reserve: 90,
            state: 'active',
          },
        },
        match_stats: { kills: round + Math.floor(at / 9), assists: Math.floor(round / 3), deaths: Math.floor(round / 2), mvps: Math.floor(round / 5), score: round * 3 },
      },
    },
  };
}

export function startMockGame(pub: <T>(topic: string, src: string, data: T) => void): () => void {
  const setup: GameSetupPayload = { supported: true, port: null, listening: false, error: null, games: [], found: null };
  let state: 'none' | 'waiting' | 'set' = 'none';
  let started = 0;
  let last: Record<string, unknown> | null = null;
  const live = new URLSearchParams(location.search).get('game') === 'live';
  if (live) {
    state = 'set';
    setup.port = 41730;
    setup.listening = true;
    setup.games = [{ widget: 'cs2', name: 'Counter-Strike 2', folder: FOLDER, file: FILE, writtenMs: Date.now() - 60_000 }];
  }

  const pubSetup = () => pub<GameSetupPayload>('game:setup', 'mock.game', { ...setup });
  const pubGame = () => {
    if (state === 'none') {
      pub<GamePayload>('game:cs2', 'mock.game', { setup: 'none', heardMs: null, live: false, data: null });
      return;
    }
    if (state === 'waiting') {
      pub<GamePayload>('game:cs2', 'mock.game', { setup: 'waiting', heardMs: null, live: false, data: null });
      return;
    }
    const t = Math.floor((Date.now() - started) / 1000);
    const m = cs2(t, 1);
    if (m && !m.over && m.data) last = m.data;
    const data = m === null ? { provider: last?.provider } : m.over && last ? { ...last, map: { ...(last.map as object), phase: 'gameover' } } : (m?.data ?? null);
    pub<GamePayload>('game:cs2', 'mock.game', { setup: 'set', heardMs: Date.now(), live: true, data });
  };

  const stop = bus.subscribe('game:command', (e) => {
    const c = e.data as GameCommand;
    if (c.action === 'find' || c.action === 'choose') {
      setup.found = {
        widget: c.widget,
        folder: c.widget === 'cs2' ? FOLDER : null,
        by: c.action === 'find' ? 'steam' : 'chosen',
        file: c.widget === 'cs2' ? FILE : null,
        others: c.widget === 'cs2' ? ['gamestate_integration_ow_native.cfg'] : [],
        reason: c.widget === 'cs2' ? null : 'Steam doesn’t list this game as installed.',
      };
    }
    if (c.action === 'setup' && c.widget === 'cs2') {
      setup.port = 41730;
      setup.listening = true;
      setup.games = [{ widget: 'cs2', name: c.name, folder: c.folder, file: FILE, writtenMs: Date.now() }];
      setup.found = null;
      state = 'waiting';
      window.setTimeout(() => {
        state = 'set';
        started = Date.now();
      }, 4000);
    }
    if (c.action === 'remove') {
      setup.games = setup.games.filter((g) => g.widget !== c.widget);
      setup.listening = setup.games.length > 0;
      if (c.widget === 'cs2') state = 'none';
    }
    pubSetup();
    pubGame();
  });

  started = Date.now();
  pub<LocalWidgetsPayload>('widgets:local', 'mock.widgets', LOCAL);
  pubSetup();
  pubGame();
  const id = window.setInterval(pubGame, 1000);
  return () => {
    stop();
    window.clearInterval(id);
  };
}
