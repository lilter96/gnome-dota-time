// Where the data comes from: the Dota window and process, Steam's files,
// OpenDota and the Steam CDN. Shell-side, everything here is asynchronous.

import Cairo from 'cairo';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {CFG_NAME, configText} from './gsi.js';
import {heroKey} from './heroes.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_async');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

const STEAM_ROOTS = ['.steam/steam', '.local/share/Steam', '.var/app/com.valvesoftware.Steam/.local/share/Steam'];
const DOTA_DIR = 'steamapps/common/dota 2 beta';
const STEAM_ID64_BASE = 76561197960265728n;
const OPENDOTA = 'https://api.opendota.com/api';
const PORTRAIT = key => `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${key}.png`;
const PROJECT = ['match_id', 'start_time', 'duration', 'radiant_win', 'player_slot', 'hero_id',
    'kills', 'deaths', 'assists', 'game_mode', 'lobby_type'].map(f => `project=${f}`).join('&');

const decoder = new TextDecoder();
const exists = p => GLib.file_test(p, GLib.FileTest.EXISTS);

async function readText(p) {
    try {
        const [bytes] = await Gio.File.new_for_path(p).load_contents_async(null);
        return decoder.decode(bytes);
    } catch {
        return null;
    }
}

// --- Dota itself -------------------------------------------------------------------

function commOf(pid) {
    if (!(pid > 0))
        return '';
    try {
        const [ok, bytes] = GLib.file_get_contents(`/proc/${pid}/comm`);
        return ok ? decoder.decode(bytes).trim() : '';
    } catch {
        return '';
    }
}

function isDota(win) {
    const cls = (win.get_wm_class() ?? '').toLowerCase();
    return cls === 'dota2' || cls === 'steam_app_570' || commOf(win.get_pid()) === 'dota2';
}

// Is Dota running? Its windows tell at once; its process covers the seconds
// before the first window and after the last one.
export class DotaWatcher {
    constructor(onChange) {
        this._onChange = onChange;
        this._windows = new Map();   // MetaWindow -> unmanaged handler id
        this._pid = 0;
        this._running = false;
        this._createdId = global.display.connect('window-created', (_d, win) => this._consider(win));
        for (const actor of global.get_window_actors())
            this._consider(actor.meta_window);
        this._cancellable = new Gio.Cancellable();
        this._probe();
    }

    async _probe() {
        try {
            const proc = Gio.Subprocess.new(['pgrep', '-x', '-u', String(GLib.get_user_name()), 'dota2'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            const [out] = await proc.communicate_utf8_async(null, this._cancellable);
            const pid = parseInt(out ?? '', 10);
            if (pid > 0 && !this._pid) {
                this._pid = pid;
                this._changed();
            }
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.debug(`dota-time: pgrep failed: ${e.message}`);
        }
    }

    _consider(win) {
        if (!win || this._windows.has(win) || !isDota(win))
            return;
        const id = win.connect('unmanaged', () => {
            this._windows.delete(win);
            this._changed();
        });
        this._windows.set(win, id);
        this._pid ||= win.get_pid();
        this._changed();
    }

    get running() {
        if (this._windows.size)
            return true;
        if (this._pid && !exists(`/proc/${this._pid}`))
            this._pid = 0;
        return this._pid > 0;
    }

    // Dota fullscreen and focused: nobody sees the panel, keep it still.
    get gaming() {
        for (const win of this._windows.keys()) {
            if (win.has_focus() && win.is_fullscreen())
                return true;
        }
        return false;
    }

    poll() {
        this._changed();
    }

    _changed() {
        const r = this.running;
        if (r === this._running)
            return;
        this._running = r;
        this._onChange(r);
    }

    destroy() {
        this._cancellable.cancel();
        global.display.disconnect(this._createdId);
        for (const [win, id] of this._windows)
            win.disconnect(id);
        this._windows.clear();
    }
}

// --- Steam ---------------------------------------------------------------------------

// Finds Dota's cfg directory and the Steam account that logged in last.
export async function findSteam() {
    const home = GLib.get_home_dir();
    const out = {cfg: null, accountId: null};
    for (const rel of STEAM_ROOTS) {
        const root = GLib.build_filenamev([home, rel]);
        if (!exists(root))
            continue;
        const libs = [root];
        const vdf = await readText(GLib.build_filenamev([root, 'steamapps', 'libraryfolders.vdf']));
        for (const m of vdf?.matchAll(/"path"\s+"([^"]+)"/g) ?? [])
            libs.push(m[1].replace(/\\\\/g, '\\'));
        for (const lib of libs) {
            const cfg = GLib.build_filenamev([lib, DOTA_DIR, 'game', 'dota', 'cfg']);
            if (!out.cfg && exists(cfg))
                out.cfg = cfg;
        }
        const users = await readText(GLib.build_filenamev([root, 'config', 'loginusers.vdf']));
        for (const m of users?.matchAll(/"(\d{17})"\s*\{([^}]*)\}/g) ?? []) {
            if (/"MostRecent"\s+"1"/.test(m[2]) || out.accountId === null)
                out.accountId = Number(BigInt(m[1]) - STEAM_ID64_BASE);
        }
        if (out.cfg)
            break;
    }
    return out;
}

// Writes the GSI cfg if it is missing or different. Returns its path.
export async function installConfig(cfgDir, port, token) {
    const dir = Gio.File.new_for_path(GLib.build_filenamev([cfgDir, 'gamestate_integration']));
    try {
        dir.make_directory_with_parents(null);
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            throw e;
    }
    const file = dir.get_child(CFG_NAME);
    const text = configText(port, token);
    if (await readText(file.get_path()) !== text) {
        await file.replace_contents_async(new TextEncoder().encode(text), null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    }
    return file.get_path();
}

// --- the web ---------------------------------------------------------------------------

export class Web {
    constructor() {
        this.session = new Soup.Session({timeout: 60, user_agent: 'dota-time-gnome/1'});
        this._cancellable = new Gio.Cancellable();
    }

    async get(url) {
        const msg = Soup.Message.new('GET', url);
        const bytes = await this.session.send_and_read_async(msg, GLib.PRIORITY_LOW, this._cancellable);
        if (msg.get_status() !== Soup.Status.OK)
            throw new Error(`${url}: HTTP ${msg.get_status()}`);
        return bytes.get_data();
    }

    async json(url) {
        return JSON.parse(decoder.decode(await this.get(url)));
    }

    // The last 20 matches; quick even when OpenDota is busy.
    recentMatches(account) {
        return this.json(`${OPENDOTA}/players/${account}/recentMatches`);
    }

    matches(account, days) {
        return this.json(`${OPENDOTA}/players/${account}/matches?date=${days}&${PROJECT}`);
    }

    // Asks OpenDota to pull the newest matches from Steam (its Refresh button).
    async refresh(account) {
        const msg = Soup.Message.new('POST', `${OPENDOTA}/players/${account}/refresh`);
        await this.session.send_and_read_async(msg, GLib.PRIORITY_LOW, this._cancellable);
        return msg.get_status() === Soup.Status.OK;
    }

    destroy() {
        this._cancellable.cancel();
        this.session.abort();
    }
}

// Hero portraits from the Steam CDN, cached on disk, loaded once per session.
export class Portraits {
    constructor(web, onLoaded) {
        this._web = web;
        this._onLoaded = onLoaded;
        this._dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'dota-time', 'heroes']);
        this._surfaces = new Map();
        this._pending = new Set();
        this._retryAt = new Map();
    }

    get(id) {
        const key = heroKey(id);
        if (!key)
            return null;
        if (this._surfaces.has(key))
            return this._surfaces.get(key);
        const file = GLib.build_filenamev([this._dir, `${key}.png`]);
        if (exists(file)) {
            let surf = null;
            try {
                surf = Cairo.ImageSurface.createFromPNG(file);
            } catch (e) {
                console.debug(`dota-time: bad portrait ${file}: ${e.message}`);
            }
            this._surfaces.set(key, surf);
            return surf;
        }
        this._fetch(key, file);
        return null;
    }

    async _fetch(key, file) {
        const now = GLib.get_monotonic_time() / 1e6;
        if (this._pending.has(key) || (this._retryAt.get(key) ?? 0) > now)
            return;
        this._pending.add(key);
        try {
            const data = await this._web.get(PORTRAIT(key));
            GLib.mkdir_with_parents(this._dir, 0o755);
            await Gio.File.new_for_path(file).replace_contents_async(data, null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            this._onLoaded();
        } catch (e) {
            this._retryAt.set(key, now + 600);
            console.debug(`dota-time: portrait ${key}: ${e.message}`);
        } finally {
            this._pending.delete(key);
        }
    }
}

// --- Dota's own reports ----------------------------------------------------------

// Listens on 127.0.0.1 for Game State Integration posts and hands each parsed
// body to `onPost`.
export class GsiServer {
    constructor(port, onPost) {
        this._server = new Soup.Server();
        this._server.add_handler('/', (_server, msg) => {
            let body = null;
            try {
                if (msg.get_method() === 'POST')
                    body = JSON.parse(decoder.decode(msg.get_request_body().flatten().get_data()));
            } catch (e) {
                console.debug(`dota-time: bad GSI post: ${e.message}`);
            }
            msg.set_status(200, null);
            msg.set_response('text/plain', Soup.MemoryUse.COPY, new Uint8Array(0));
            if (body)
                onPost(body);
        });
        this._server.listen_local(port, Soup.ServerListenOptions.IPV4_ONLY);
    }

    destroy() {
        this._server.disconnect();
        this._server = null;
    }
}
