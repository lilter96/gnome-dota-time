import {GameState, configText, fromOpenDota} from '../dota-time@terentiy/gsi.js';
import {heroId, heroKey, heroName} from '../dota-time@terentiy/heroes.js';
import {assert, deepEqual, equal, test} from './harness.js';

const TOKEN = 'secret';

const post = (state, extra = {}) => ({
    auth: {token: TOKEN},
    provider: {name: 'Dota 2', appid: 570},
    map: {matchid: '8123456789', game_state: state, clock_time: 0, win_team: 'none', customgamename: '', ...extra.map},
    player: {accountid: '123456789', team_name: 'dire', kills: 0, deaths: 0, assists: 0, ...extra.player},
    hero: {id: 14, name: 'npc_dota_hero_pudge', ...extra.hero},
});

test('posts without our token are ignored', () => {
    const g = new GameState(TOKEN);
    equal(g.feed({...post('DOTA_GAMERULES_STATE_GAME_IN_PROGRESS'), auth: {token: 'x'}}, 100), null);
    equal(g.live, null);
});

test('a match starts once, ends once, with the right result', () => {
    const g = new GameState(TOKEN);
    deepEqual(g.feed(post('DOTA_GAMERULES_STATE_HERO_SELECTION', {hero: {id: 0, name: ''}}), 100),
        [{type: 'start', id: '8123456789'}]);
    deepEqual(g.feed(post('DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', {map: {clock_time: 600}}), 800), []);
    assert(g.inMatch(800));
    equal(g.live.hero, 14);
    equal(g.accountId, 123456789);
    const end = g.feed(post('DOTA_GAMERULES_STATE_POST_GAME',
        {map: {clock_time: 2400, win_team: 'dire'}, player: {kills: 9, deaths: 2, assists: 11}}), 3000);
    deepEqual(end, [{type: 'end', match: {id: '8123456789', t: 600, d: 2400, h: 14, w: 1, k: 9, x: 2, a: 11, src: 'gsi'}}]);
    // Dota keeps posting the post-game screen: no second result
    deepEqual(g.feed(post('DOTA_GAMERULES_STATE_POST_GAME', {map: {clock_time: 2400, win_team: 'dire'}}), 3010), []);
    assert(!g.inMatch(3010), 'the post-game screen is not a match');
});

test('a loss is a loss', () => {
    const g = new GameState(TOKEN);
    g.feed(post('DOTA_GAMERULES_STATE_GAME_IN_PROGRESS'), 0);
    const [e] = g.feed(post('DOTA_GAMERULES_STATE_POST_GAME', {map: {clock_time: 1800, win_team: 'radiant'}}), 1900);
    equal(e.match.w, 0);
});

test('spectating, the menu and custom games are not matches', () => {
    const g = new GameState(TOKEN);
    deepEqual(g.feed({auth: {token: TOKEN}, player: {activity: 'menu'}}, 10), []);
    equal(g.live, null);
    deepEqual(g.feed(post('DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', {player: {team_name: undefined}}), 20), []);
    deepEqual(g.feed(post('DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', {map: {customgamename: 'overthrow'}}), 30), []);
    assert(!g.inMatch(30));
    assert(g.connected(30), 'but Dota is talking to us');
    assert(!g.connected(100));
});

test('in-game Roshan falling is an event', () => {
    const g = new GameState(TOKEN);
    g.feed(post('DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', {map: {roshan_state: 'alive'}}), 0);
    deepEqual(g.feed(post('DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', {map: {roshan_state: 'respawn_base'}}), 1),
        [{type: 'roshan'}]);
});

test('the cfg names the port and the token', () => {
    const cfg = configText(47570, 'abc');
    assert(cfg.includes('"uri"           "http://127.0.0.1:47570/"'));
    assert(cfg.includes('"token"     "abc"'));
});

test('OpenDota rows become matches', () => {
    const m = fromOpenDota({match_id: 8012, start_time: 1000, duration: 2500, hero_id: 19,
        player_slot: 130, radiant_win: false, kills: 9, deaths: 9, assists: 15, game_mode: 22, lobby_type: 7});
    deepEqual(m, {id: '8012', t: 1000, d: 2500, h: 19, w: 1, k: 9, x: 9, a: 15, m: 22, l: 7, src: 'od'});
    equal(fromOpenDota({match_id: 1, start_time: 5, player_slot: 1, radiant_win: false}).w, 0);
    equal(fromOpenDota({}), null);
});

test('heroes by id and by GSI name', () => {
    equal(heroId('npc_dota_hero_pudge'), 14);
    equal(heroId(86), 86);
    equal(heroKey(86), 'rubick');
    equal(heroName(19), 'Tiny');
    equal(heroId('npc_dota_hero_someone_new'), 0);
});
