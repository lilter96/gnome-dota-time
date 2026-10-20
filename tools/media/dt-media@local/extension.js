// Test and README media driver, see ../capture.sh. Runs inside an isolated
// headless gnome-shell next to dota-time and takes screenshots.
//   DT_MEDIA_MODE=smoke  the extension as it is: Steam lookup, OpenDota, a GSI post
//   DT_MEDIA_MODE=media  synthetic demo data for the README
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Ledger, addDays, dayKey, dayStart, formatClock} from '../dota-time@terentiy/ledger.js';
import {moodFor} from '../dota-time@terentiy/roshan.js';
import {GsiServer} from '../dota-time@terentiy/sources.js';

Gio._promisify(Shell.Screenshot.prototype, 'screenshot_area');
Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
const OUT = GLib.getenv('DT_MEDIA_OUT');
const MODE = GLib.getenv('DT_MEDIA_MODE') ?? 'smoke';
const UUID = 'dota-time@terentiy';
const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { r(); return GLib.SOURCE_REMOVE; }));
const log = m => console.log(`[dt-media] ${m}`);
const now_ = () => GLib.get_monotonic_time() / 1000;
const now = now_;
const meta = {};

// Nothing personal may show through the translucent popup.
function hideBehind() {
    global.window_group.hide();
    Main.layoutManager._backgroundGroup.hide();
}

async function shot(name, [x, y, w, h]) {
    hideBehind();
    const file = Gio.File.new_for_path(`${OUT}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    await new Shell.Screenshot().screenshot_area(Math.round(x), Math.round(y), Math.round(w), Math.round(h), stream);
    stream.close(null);
}

function rectOf(actor, pad = 0) {
    const r = actor.get_transformed_extents();
    return [r.origin.x - pad, r.origin.y - pad, r.size.width + 2 * pad, r.size.height + 2 * pad];
}

function hover(card, i) {
    const chart = card._chart;
    chart._hover = i;
    chart.onHover(i);
    chart.queue_repaint();
}

let gsiPort = 47570;

async function post(body) {
    const session = new Soup.Session();
    const msg = Soup.Message.new('POST', `http://127.0.0.1:${gsiPort}/`);
    msg.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(JSON.stringify(body))));
    await session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
    return msg.get_status();
}


// A window that looks like Dota to DotaWatcher: GTK 3 names its Wayland app id
// after the program.
const FAKE_DOTA = `
imports.gi.versions.Gtk = '3.0';
const {GLib, Gtk} = imports.gi;
GLib.set_prgname('dota2');
Gtk.init(null);
const w = new Gtk.Window({title: 'Dota 2', default_width: 200, default_height: 100});
w.show_all();
Gtk.main();
`;

// --- demo data -------------------------------------------------------------------

const HEROES = [74, 14, 8, 86, 19, 2, 44, 26, 5, 7, 35, 126, 129, 1, 11];

function rng(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// A month of evenings. Days before the "install" are known only from matches.
// today: [[start hour, minutes], ...] sessions, matches inside them.
function demoLedger(now, today) {
    const R = rng(7);
    const L = new Ledger();
    const key = dayKey(now);
    const installed = addDays(key, -11);
    let id = 8000000000;
    const hoursFor = [1.4, 2.6, 0, 3.2, 4.7, 2.1, 0.9, 2.4, 3.6, 0, 1.8, 2.9, 4.3, 1.1, 2.2,
        0, 3.0, 2.5, 1.6, 0, 3.4, 2.7, 4.4, 1.9, 0.8, 2.3, 3.1, 0, 2.0, 1.5];
    const play = (d, start, minutes, tracked) => {
        const a = dayStart(d) + (start - 5) * 3600;
        if (tracked)
            L.segs.push([a, a + minutes * 60]);
        // matches of ~35-50 min with a few minutes of queue between them
        let t = a + 4 * 60;
        while (t + 30 * 60 < a + minutes * 60) {
            const dur = Math.round((32 + R() * 18) * 60);
            if (t + dur > a + minutes * 60 && tracked)
                break;
            L.addMatch({id: String(id++), t, d: dur, h: HEROES[Math.floor(R() * HEROES.length)],
                w: R() < 0.52 ? 1 : 0, k: Math.floor(R() * 14), x: Math.floor(R() * 9), a: Math.floor(R() * 18),
                src: tracked ? 'gsi' : 'od'});
            t += dur + Math.round((3 + R() * 6) * 60);
        }
    };
    for (let i = 29; i >= 1; i--) {
        const d = addDays(key, -i);
        const h = hoursFor[i];
        if (!h)
            continue;
        const tracked = d >= installed;
        const first = Math.min(h, 1 + R() * 1.5);
        play(d, 18.5 + R(), first * 60, tracked);
        if (h > first)
            play(d, 20.6 + R() * 0.6, (h - first) * 60, tracked);
    }
    for (const [start, minutes] of today)
        play(key, start, minutes, true);
    L.segs.sort((a, b) => a[0] - b[0]);
    return L;
}

function demoModel(L, now, {running, live}) {
    const key = dayKey(now);
    const stats = L.stats(now);
    return {
        now, running, live,
        today: stats.today,
        hourly: L.hourly(key, now),
        week: L.series(key, 7, now),
        prevWeek: L.series(addDays(key, -7), 7),
        month: L.series(key, 30, now),
        stats,
        gsi: {seen: true, listening: true},
        odError: false,
    };
}

export default class Media extends Extension {
    enable() {
        this._run().catch(e => { log(`FAILED ${e}\n${e.stack}`); global.context.terminate(); });
    }

    disable() {}

    async _run() {
        await sleep(3000);
        Main.overview.hide();
        await sleep(1000);
        hideBehind();
        const ext = Main.extensionManager.lookup(UUID);
        log(`state=${ext.state} error=${ext.error ?? ''}`);
        const me = ext.stateObj;
        const ind = Main.panel.statusArea[UUID];
        if (MODE === 'smoke')
            await this._smoke(me, ind);
        else
            await this._media(me, ind);
        GLib.file_set_contents(`${OUT}/meta.json`, JSON.stringify(meta, null, 1));
        log('done');
        await sleep(300);
        global.context.terminate();
    }

    async _media(me, ind) {
        me._refresh = () => {};
        const card = me._card;
        const box = () => rectOf(ind.menu.box);
        // late evening, whatever the real clock says
        const now = dayStart(dayKey(Date.now() / 1000)) + 18.2 * 3600;
        const SCENES = {
            asleep: {today: [], running: false, mode: 2},
            calm: {today: [[19.1, 72]], running: true, mode: 1},
            live: {today: [[18.4, 62], [19.6, 125]], running: true, mode: 0,
                live: {id: 'live', hero: 74, clock: 23 * 60 + 41, k: 9, x: 3, a: 14, state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS'}},
            aggro: {today: [[17.2, 96], [18.9, 165]], running: true, mode: 1},
        };
        const models = {};
        for (const [k, sc] of Object.entries(SCENES)) {
            const L = demoLedger(now, sc.today);
            models[k] = demoModel(L, now, sc);
            log(`${k}: today=${formatClock(models[k].today.total)} matches=${models[k].today.matches.length} ` +
                `week=${formatClock(models[k].stats.week.sum)} usual=${formatClock(models[k].stats.usual ?? 0)}`);
        }
        // fetch the portraits first
        for (const id of HEROES)
            me._portraits.get(id);
        await sleep(4000);

        const show = k => {
            const m = models[k];
            card._seg.select(SCENES[k].mode, true);
            card._mode = SCENES[k].mode;
            card.update(m);
            const mood = moodFor(m.today.total / 3600);
            ind.glyph.set({mood, awake: m.running});
            ind.time.set(m.today.total >= 60 ? formatClock(m.today.total) : '', 0);
            ind.time.visible = m.today.total >= 60;
            if (mood === 3)
                ind.time.add_style_class_name('dt-panel-aggro');
            else
                ind.time.remove_style_class_name('dt-panel-aggro');
        };

        for (const k of ['asleep', 'calm', 'live', 'aggro']) {
            show(k);
            await sleep(2000);
            await shot(`panel_${k}`, rectOf(ind, 10));
        }

        for (const k of ['calm', 'live', 'aggro']) {
            show(k);
            await sleep(300);
            ind.menu.open();
            await sleep(2600);
            for (let i = 0; i < 8; i++) {
                await shot(`card_${k}_${i}`, box());
                await sleep(500);
            }
            meta[`card_${k}`] = box();
            ind.menu.close();
            await sleep(900);
        }

        // the GIF: open in aggro, then the month, then a walk over the bars
        show('aggro');
        await sleep(1000);
        const frames = [];
        const t0 = now_();
        ind.menu.open();
        const plan = [[3600, () => card._seg.select(2)], [5600, () => hover(card, 25)], [6000, () => hover(card, 26)],
            [6400, () => hover(card, 27)], [6800, () => hover(card, 28)], [7600, () => hover(card, -1)]];
        while (now_() - t0 < 8600) {
            const t = now_() - t0;
            while (plan.length && plan[0][0] <= t)
                plan.shift()[1]();
            const name = `gif_${String(frames.length).padStart(4, '0')}`;
            await shot(name, box());
            frames.push([name, Math.round(t)]);
        }
        meta.frames = frames;
        log(`gif: ${frames.length} frames in ${Math.round(now_() - t0)} ms`);
        ind.menu.close();
        await sleep(500);
    }

    async _smoke(me, ind) {
        const box = () => rectOf(ind.menu.box);
        log(`account=${me._state.accountId} gsi=${!!me._gsi}`);
        // your own dota-time holds 47570: talk to ours elsewhere, never to yours
        if (!me._gsi) {
            gsiPort = 47571;
            me._gsi = new GsiServer(gsiPort, b => me._onPost(b));
        }
        // OpenDota backfill starts 15 s after enable
        const t0 = now();
        while (!me._state.od.backfillOk && now() - t0 < 60000)
            await sleep(1000);
        log(`backfill ok=${!!me._state.od.backfillOk} after ${Math.round((now() - t0) / 1000)} s, ` +
            `matches=${me._ledger.matches.size} odError=${me._odError}`);
        await shot('panel', rectOf(ind, 10));
        ind.menu.open();
        await sleep(2500);
        await shot('smoke_week', box());
        meta.card = box();
        me._card._seg.select(2);
        await sleep(1500);
        await shot('smoke_month', box());
        me._card._seg.select(1);
        await sleep(1500);
        const chart = me._card._chart;
        chart._hover = 5;
        chart.onHover(5);
        chart.queue_repaint();
        await sleep(400);
        await shot('smoke_week_hover', box());
        chart._hover = -1;
        chart.onHover(-1);
        me._card._seg.select(0);
        await sleep(1500);
        await shot('smoke_day', box());

        // Dota reports a match through GSI
        const token = me._state.token;
        const body = (state, extra = {}) => ({
            auth: {token},
            provider: {name: 'Dota 2', appid: 570},
            map: {matchid: '1234', game_state: state, clock_time: 754, win_team: 'none', customgamename: '', ...extra.map},
            player: {accountid: String(me._state.accountId ?? 1), team_name: 'radiant', kills: 7, deaths: 2, assists: 9},
            hero: {id: 86, name: 'npc_dota_hero_rubick'},
        });
        log(`gsi bad token -> ${await post({auth: {token: 'nope'}})}`);
        const demo = {map: {matchid: '0', customgamename: 'hero_demo', clock_time: 193}};
        log(`gsi demo hero -> ${await post(body('DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', demo))}`);
        await sleep(1500);
        log(`practice live=${JSON.stringify(me._live(Date.now() / 1000))} mode=${me._game.mode}`);
        await shot('smoke_practice', box());
        log(`gsi in progress -> ${await post(body('DOTA_GAMERULES_STATE_GAME_IN_PROGRESS'))}`);
        await sleep(1500);
        log(`live=${JSON.stringify(me._live(Date.now() / 1000))} seen=${me._state.gsiSeen}`);
        await shot('smoke_live', box());
        log(`gsi post game -> ${await post(body('DOTA_GAMERULES_STATE_POST_GAME', {map: {clock_time: 2101, win_team: 'radiant'}}))}`);
        await sleep(1200);
        await shot('smoke_win', box());
        const m = me._ledger.matches.get('1234');
        log(`match=${JSON.stringify(m)}`);
        ind.menu.close();
        await sleep(500);

        // Dota running, then ten minutes away from the keyboard
        Object.defineProperty(me._watcher, 'running', {get: () => true, configurable: true});
        me._game.lastPost = 0;
        const monitor = global.backend.get_core_idle_monitor();
        log(`idle now ${monitor.get_idletime()} ms`);
        const segs = () => JSON.stringify(me._ledger.segs.slice(-2).map(([a, b]) => [Math.round(a % 10000), Math.round(b % 10000)]));
        me._track();
        await sleep(2000);
        me._track();
        log(`running: open=${me._ledger.open} segs=${segs()}`);
        monitor.get_idletime = () => 700 * 1000;
        me._track();
        log(`afk: open=${me._ledger.open} segs=${segs()}`);
        delete monitor.get_idletime;
        me._track();
        log(`back: open=${me._ledger.open} segs=${segs()}`);
        delete me._watcher.running;

        // Dota already open when the extension starts: a lock screen, a shell restart
        const fake = Gio.Subprocess.new(['gjs', '-c', FAKE_DOTA], Gio.SubprocessFlags.NONE);
        let win = null;
        for (let i = 0; i < 100 && !win; i++) {
            await sleep(100);
            win = global.get_window_actors().map(a => a.meta_window).find(w => w.get_wm_class() === 'dota2');
        }
        log(`fake dota window: ${win ? win.get_wm_class() : 'none'}`);
        const ext = Main.extensionManager.lookup(UUID);
        await Main.extensionManager._callExtensionDisable(UUID);
        log(`disabled: state=${ext.state}`);
        await Main.extensionManager._callExtensionEnable(UUID);
        const again = ext.stateObj;
        log(`re-enabled with dota open: state=${ext.state} error=${ext.error ?? ''} ` +
            `running=${again._watcher?.running} ledgerOpen=${again._ledger?.open}`);
        fake.force_exit();
        await sleep(1500);
        again._watcher?.poll();
        log(`fake dota closed: running=${again._watcher?.running}`);
    }
}
