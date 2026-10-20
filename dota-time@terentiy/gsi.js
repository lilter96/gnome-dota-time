// Dota 2 Game State Integration: Dota posts its state to a local HTTP server
// named in a cfg file. This module only interprets the posts and builds the
// cfg; the server itself lives in the extension. Pure JavaScript.
//
// Dota reads the cfg at start-up and only when launched with
// -gamestateintegration.

import {heroId} from './heroes.js';

export const GSI_PORT = 47570;
export const CFG_NAME = 'gamestate_integration_dota_time.cfg';

// Game states during which you are in a match (picking counts).
const IN_MATCH = new Set([
    'DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD',
    'DOTA_GAMERULES_STATE_HERO_SELECTION',
    'DOTA_GAMERULES_STATE_PLAYER_DRAFT',
    'DOTA_GAMERULES_STATE_STRATEGY_TIME',
    'DOTA_GAMERULES_STATE_TEAM_SHOWCASE',
    'DOTA_GAMERULES_STATE_WAIT_FOR_MAP_TO_LOAD',
    'DOTA_GAMERULES_STATE_PRE_GAME',
    'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
]);
const POST_GAME = 'DOTA_GAMERULES_STATE_POST_GAME';
const FRESH = 45;   // seconds; Dota sends a heartbeat every 30

export function configText(port, token) {
    return `"Dota Time"
{
    "uri"           "http://127.0.0.1:${port}/"
    "timeout"       "5.0"
    "buffer"        "0.5"
    "throttle"      "1.0"
    "heartbeat"     "30.0"
    "data"
    {
        "provider"  "1"
        "map"       "1"
        "player"    "1"
        "hero"      "1"
    }
    "auth"
    {
        "token"     "${token}"
    }
}
`;
}

export class GameState {
    constructor(token) {
        this.token = token;
        this.live = null;       // the match you are in right now
        this.lastPost = 0;
        this.accountId = null;
        this._ended = new Set();
        this._roshan = null;
        this.mode = 'none';     // for the log: Dota's fields differ between modes
    }

    // A post from Dota. Returns a list of events:
    //   {type: 'start', id} | {type: 'end', match} | {type: 'roshan'}
    // or null if the post is not ours.
    feed(body, now) {
        if (!body || body.auth?.token !== this.token)
            return null;
        this.lastPost = now;
        const events = [];
        const map = body.map, player = body.player ?? {}, hero = body.hero ?? {};
        if (player.accountid && /^\d+$/.test(String(player.accountid)))
            this.accountId = Number(player.accountid);

        const id = map?.matchid ? String(map.matchid) : null;
        const team = player.team_name;
        const playing = !!id && id !== '0' && (team === 'radiant' || team === 'dire') &&
            !map.customgamename;
        const state = map?.game_state;
        const hid = heroId(hero.id > 0 ? hero.id : hero.name);
        if (!playing) {
            this._roshan = null;
            // the demo hero, bots, custom games: shown, never counted as a match
            this.live = map && hid && state !== POST_GAME ? {
                id: null,
                practice: true,
                state,
                hero: hid,
                clock: map.clock_time ?? 0,
                k: player.kills ?? 0,
                x: player.deaths ?? 0,
                a: player.assists ?? 0,
                at: now,
            } : null;
            this.mode = `${this.live ? 'practice' : 'idle'} (${describe(map, team, hid)})`;
            return events;
        }
        this.mode = 'match';

        if (this.live?.id !== id && IN_MATCH.has(state))
            events.push({type: 'start', id});
        this.live = IN_MATCH.has(state) || state === POST_GAME ? {
            id,
            state,
            hero: hid,
            team,
            clock: map.clock_time ?? 0,
            k: player.kills ?? 0,
            x: player.deaths ?? 0,
            a: player.assists ?? 0,
            at: now,
        } : null;

        // in-game Roshan just fell
        const rs = map.roshan_state;
        if (rs && this._roshan === 'alive' && rs !== 'alive')
            events.push({type: 'roshan'});
        this._roshan = rs ?? null;

        if (state === POST_GAME && (map.win_team === 'radiant' || map.win_team === 'dire') &&
            !this._ended.has(id)) {
            this._ended.add(id);
            const d = Math.max(0, map.clock_time ?? 0);
            events.push({
                type: 'end',
                match: {
                    id,
                    t: Math.round(now - d),
                    d,
                    h: hid || undefined,
                    w: map.win_team === team ? 1 : 0,
                    k: player.kills,
                    x: player.deaths,
                    a: player.assists,
                    src: 'gsi',
                },
            });
        }
        return events;
    }

    // In a real match according to a recent post.
    inMatch(now) {
        return !!this.live && !this.live.practice && IN_MATCH.has(this.live.state) &&
            now - this.lastPost < FRESH;
    }

    // What to show as going on right now: a match or practice, or null.
    current(now) {
        if (!this.live || now - this.lastPost >= FRESH)
            return null;
        return this.live.practice || IN_MATCH.has(this.live.state) ? this.live : null;
    }

    // Dota has talked to us lately (it is running with the launch option).
    connected(now) {
        return now - this.lastPost < FRESH;
    }
}

function describe(map, team, hid) {
    if (!map)
        return 'menu';
    const id = map.matchid && String(map.matchid) !== '0' ? 'set' : 'none';
    return `map ${map.name ?? '?'}, custom ${map.customgamename || 'none'}, match id ${id}, ` +
        `team ${team ?? 'none'}, hero ${hid ? 'set' : 'none'}, ${map.game_state ?? '?'}`;
}

// A match row from OpenDota's /players/{id}/recentMatches or /matches.
export function fromOpenDota(r) {
    if (!r?.match_id || !r.start_time)
        return null;
    const radiant = r.player_slot < 128;
    return {
        id: String(r.match_id),
        t: r.start_time,
        d: r.duration ?? 0,
        h: r.hero_id || undefined,
        w: r.radiant_win === undefined || r.radiant_win === null ? undefined : (radiant === r.radiant_win ? 1 : 0),
        k: r.kills,
        x: r.deaths,
        a: r.assists,
        m: r.game_mode,
        l: r.lobby_type,
        src: 'od',
    };
}
