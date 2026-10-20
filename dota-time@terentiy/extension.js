import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Card} from './card.js';
import {GSI_PORT, GameState, fromOpenDota} from './gsi.js';
import {
    AFK_LIMIT, AGGRO_HOURS, Ledger, addDays, dayKey, formatClock, formatDuration, importHistory,
} from './ledger.js';
import {moodFor} from './roshan.js';
import {DotaWatcher, GsiServer, Portraits, Web, findSteam, installConfig} from './sources.js';
import {PanelGlyph, RollingLabel} from './ui.js';

const TICK = 5;                     // seconds
const SAVE_EVERY = 30;
const RECENT_STALE = 20 * 60;       // refetch OpenDota's last 20 matches after this
const BACKFILL_DAYS = 60;
const BACKFILL_AGAIN = 24 * 3600;
const BACKFILL_RETRY = 3600;
const REFRESH_EVERY = 30 * 60;      // ask OpenDota to look for new matches at most this often

const wallClock = () => Date.now() / 1000;
const cancelled = e => e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
const liveKind = live => live ? (live.practice ? 'practice' : 'match') : 'none';

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Dota Time');
        this.menu.actor.add_style_class_name('dt-menu');
        const box = new St.BoxLayout({style_class: 'dt-panel-box'});
        this.glyph = new PanelGlyph();
        this.time = new RollingLabel({style_class: 'dt-panel-time'});
        box.add_child(this.glyph);
        box.add_child(this.time);
        this.add_child(box);
    }

    appear() {
        this.opacity = 0;
        this.ease({opacity: 255, duration: 260, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this.glyph.pop();
    }
});

export default class DotaTimeExtension extends Extension {
    enable() {
        const stateDir = GLib.build_filenamev([GLib.get_user_state_dir(), 'dota-time']);
        this._statePath = GLib.build_filenamev([stateDir, 'state.json']);
        const saved = this._read(this._statePath);
        this._state = {
            token: saved?.token ?? GLib.uuid_string_random().replace(/-/g, ''),
            accountId: saved?.accountId ?? null,
            gsiSeen: saved?.gsiSeen ?? false,
            gsiFlag: saved?.gsiFlag ?? null,        // did Dota last start with -gamestateintegration
            notified: saved?.notified ?? null,      // the day the aggro notification went out
            od: {recentAt: 0, backfillAt: 0, backfillOk: 0, refreshAt: 0, ...saved?.od},
        };
        this._ledger = new Ledger(saved?.ledger);
        if (!saved)
            this._importOld(GLib.build_filenamev([stateDir, 'history.json']));

        this._game = new GameState(this._state.token);
        this._gsiMode = null;
        this._timers = new Map();
        this._odBusy = false;
        this._odError = false;
        this._sinceSave = 0;
        this._menuOpen = false;

        this._web = new Web();
        this._portraits = new Portraits(this._web, () => this._card?.portraitsChanged());

        this._indicator = new Indicator();
        this._card = new Card(this._portraits);
        const section = new PopupMenu.PopupMenuSection();
        section.box.add_child(this._card);
        this._indicator.menu.addMenuItem(section);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._indicator.appear();
        this._menuId = this._indicator.menu.connect('open-state-changed', (_m, open) => {
            this._menuOpen = open;
            if (open) {
                this._refresh();
                this._card.play();
                if (wallClock() - this._state.od.recentAt > RECENT_STALE)
                    this._syncRecent();
            } else {
                this._card.pause();
            }
        });

        this._watcher = new DotaWatcher(running => this._onRunning(running));
        this._indicator.glyph.stillWhen = () => this._watcher?.gaming ?? false;
        this._focusId = global.display.connect('notify::focus-window', () => {
            this._track();
            this._refresh();
        });
        this._checkFlag();

        try {
            this._gsi = new GsiServer(GSI_PORT, body => this._onPost(body));
        } catch (e) {
            this._gsi = null;
            console.warn(`[${this.uuid}] cannot listen on 127.0.0.1:${GSI_PORT}: ${e.message}`);
        }

        findSteam().then(steam => {
            if (!this._ledger)
                return;
            if (steam.accountId && !this._game.accountId)
                this._state.accountId = steam.accountId;
            if (steam.cfg) {
                installConfig(steam.cfg, GSI_PORT, this._state.token)
                    .catch(e => console.warn(`[${this.uuid}] cannot write the GSI config: ${e.message}`));
            }
            const od = this._state.od;
            const due = od.backfillOk ? od.backfillOk + BACKFILL_AGAIN : od.backfillAt + BACKFILL_RETRY;
            if (wallClock() >= due)
                this._later('backfill', 15, () => this._backfill());
            else if (wallClock() - od.recentAt > RECENT_STALE)
                this._later('recent', 20, () => this._syncRecent());
        }).catch(e => console.warn(`[${this.uuid}] Steam lookup failed: ${e.message}`));

        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, TICK, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
        this._track();
        this._refresh();
    }

    disable() {
        GLib.source_remove(this._tickId);
        for (const id of this._timers.values())
            GLib.source_remove(id);
        this._timers.clear();
        this._track();
        this._save();
        this._indicator.menu.disconnect(this._menuId);
        global.display.disconnect(this._focusId);
        this._watcher.destroy();
        this._gsi?.destroy();
        this._web.destroy();
        this._indicator.destroy();
        this._indicator = this._card = this._watcher = this._gsi = this._web = null;
        this._portraits = this._game = this._ledger = this._state = null;
    }

    // --- tracking --------------------------------------------------------------

    // Does now count, and if not while Dota runs, why. A match always counts,
    // alt-tabbed too; the menu only with Dota in front of you; the demo hero
    // and practice never.
    _counting(now) {
        if (!this._running(now))
            return {on: false, why: null};
        if (this._game.inMatch(now))
            return {on: true, why: null};
        const live = this._game.current(now);
        if (live?.practice)
            return {on: false, why: live.kind};
        if (!this._watcher.focused)
            return {on: false, why: 'background'};
        return {on: true, why: null};
    }

    // Ten minutes without input outside a match are taken back.
    _track() {
        const now = wallClock();
        let {on, why} = this._counting(now);
        if (on && !this._game.inMatch(now)) {
            const idle = global.backend.get_core_idle_monitor().get_idletime() / 1000;
            if (idle >= AFK_LIMIT) {
                if (this._ledger.open)
                    this._ledger.trim(now - idle);
                on = false;
                why = 'away';
            }
        }
        this._paused = why;
        this._ledger.track(now, on);
    }

    _tick() {
        this._watcher.poll();
        this._checkFlag();
        this._track();
        this._sinceSave += TICK;
        if (this._sinceSave >= SAVE_EVERY && this._watcher.running)
            this._save();
        this._refresh();
    }

    _checkFlag() {
        const flag = this._watcher.gsiFlag;
        if (flag === null || flag === this._state.gsiFlag)
            return;
        this._state.gsiFlag = flag;
        this._save();
        this._refresh();
    }

    _onRunning(running) {
        this._checkFlag();
        this._track();
        this._refresh();
        if (!running) {
            this._save();
            // the last match shows up on OpenDota a little later
            this._later('recent', 120, () => this._syncRecent(true));
        }
    }

    // A post from Dota's Game State Integration.
    _onPost(body) {
        if (!this._game)
            return;
        const now = wallClock();
        const was = liveKind(this._live(now));
        const events = this._game.feed(body, now);
        if (events === null)
            return;
        if (this._game.mode !== this._gsiMode) {
            this._gsiMode = this._game.mode;
            console.log(`[${this.uuid}] GSI: ${this._gsiMode}`);
        }
        if (!this._state.gsiSeen) {
            this._state.gsiSeen = true;
            this._save();
        }
        if (this._game.accountId)
            this._state.accountId = this._game.accountId;
        let changed = was !== liveKind(this._live(now));
        for (const e of events) {
            if (e.type === 'end') {
                this._ledger.addMatch(e.match);
                this._card.react(e.match.w === 1 ? 'win' : 'loss');
                this._save();
                this._later('recent', 180, () => this._syncRecent(true));
            }
            changed = true;
        }
        if (changed)
            this._refresh();
        else if (this._menuOpen)
            this._card.setLive(this._live(now));
    }

    // Dota's own posts count too: they come before any window shows up.
    _running(now) {
        return this._watcher.running || this._game.connected(now);
    }

    _live(now) {
        return this._game.current(now);
    }

    // --- OpenDota --------------------------------------------------------------

    _later(name, seconds, fn) {
        if (this._timers.has(name))
            GLib.source_remove(this._timers.get(name));
        this._timers.set(name, GLib.timeout_add_seconds(GLib.PRIORITY_LOW, seconds, () => {
            this._timers.delete(name);
            fn();
            return GLib.SOURCE_REMOVE;
        }));
    }

    _addRows(rows) {
        let changed = false;
        for (const row of rows ?? []) {
            const m = fromOpenDota(row);
            if (m && this._ledger.addMatch(m))
                changed = true;
        }
        return changed;
    }

    async _openDota(what, fn) {
        const id = this._state?.accountId;
        if (!id || this._odBusy)
            return;
        this._odBusy = true;
        try {
            const changed = this._addRows(await fn(id));
            if (!this._ledger)
                return;
            this._odError = false;
            if (changed)
                this._save();
            this._refresh();
        } catch (e) {
            if (cancelled(e) || !this._ledger)
                return;
            this._odError = true;
            console.warn(`[${this.uuid}] OpenDota ${what}: ${e.message}`);
            this._refresh();
        } finally {
            this._odBusy = false;
        }
    }

    // The last 20 matches. After a game, first ask OpenDota to look for it.
    async _syncRecent(fresh = false) {
        const od = this._state.od;
        const now = wallClock();
        if (fresh && now - od.refreshAt > REFRESH_EVERY && this._state.accountId) {
            od.refreshAt = now;
            try {
                await this._web.refresh(this._state.accountId);
            } catch (e) {
                if (cancelled(e))
                    return;
            }
            this._later('recent', 60, () => this._syncRecent());
            return;
        }
        od.recentAt = now;
        await this._openDota('recent matches', id => this._web.recentMatches(id));
    }

    // Two months of history, so the charts are not empty on day one.
    async _backfill() {
        const od = this._state.od;
        od.backfillAt = wallClock();
        await this._openDota('history', async id => {
            const rows = await this._web.matches(id, BACKFILL_DAYS);
            od.backfillOk = wallClock();
            od.recentAt = od.backfillOk;
            return rows;
        });
        if (this._state && od.backfillOk < od.backfillAt)
            this._later('backfill', BACKFILL_RETRY, () => this._backfill());
    }

    // --- UI ----------------------------------------------------------------------

    _model(now) {
        const key = dayKey(now);
        const stats = this._ledger.stats(now);
        const running = this._running(now);
        return {
            now,
            running,
            live: this._live(now),
            paused: running ? this._paused : null,
            today: stats.today,
            hourly: this._ledger.hourly(key, now),
            week: this._ledger.series(key, 7, now),
            prevWeek: this._ledger.series(addDays(key, -7), 7),
            month: this._ledger.series(key, 30, now),
            stats,
            gsi: {seen: this._state.gsiSeen, flag: this._state.gsiFlag, listening: !!this._gsi},
            odError: this._odError,
        };
    }

    _refresh() {
        if (!this._indicator)
            return;
        const now = wallClock();
        const running = this._running(now);
        const today = this._ledger.day(dayKey(now), now);
        const hours = today.total / 3600;
        const mood = moodFor(hours);

        const ind = this._indicator;
        ind.glyph.set({mood, awake: running});
        const clock = today.total >= 60 || running ? formatClock(today.total) : '';
        if (clock !== ind.time.text) {
            const dir = this._shown === undefined ? 0 : Math.sign(today.total - this._shown);
            ind.time.set(clock, dir);
        }
        this._shown = today.total;
        ind.time.visible = clock !== '';
        ind.time.opacity = running && this._paused ? 130 : 255;
        if (mood === 3)
            ind.time.add_style_class_name('dt-panel-aggro');
        else
            ind.time.remove_style_class_name('dt-panel-aggro');
        ind.accessible_name = `Dota 2 сегодня: ${formatDuration(today.total)}`;

        if (this._menuOpen)
            this._card.update(this._model(now));
        else
            this._card.idle({hours, running, live: this._live(now)});

        if (hours >= AGGRO_HOURS && this._state.notified !== today.key)
            this._notify(today);
    }

    _notify(today) {
        this._state.notified = today.key;
        this._save();
        const source = new MessageTray.Source({
            title: 'Dota Time',
            icon: Gio.FileIcon.new(this.dir.get_child('icons').get_child('roshan.png')),
        });
        Main.messageTray.add(source);
        // normal urgency: no banner over a fullscreen game, it waits in the list
        source.addNotification(new MessageTray.Notification({
            source,
            title: 'Рошан в агре',
            body: `Сегодня в Доте уже ${formatDuration(today.total)}. Это больше четырёх часов.`,
            urgency: MessageTray.Urgency.NORMAL,
        }));
    }

    // --- state ---------------------------------------------------------------------

    _read(path) {
        try {
            const [, bytes] = GLib.file_get_contents(path);
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch {
            return null;
        }
    }

    // The first version of this extension kept calendar-day totals in history.json.
    _importOld(path) {
        const old = this._read(path);
        if (!old)
            return;
        let mtime = 0;
        try {
            mtime = Gio.File.new_for_path(path).query_info('time::modified', 0, null)
                .get_modification_date_time().to_unix();
        } catch {}
        Object.assign(this._ledger.imported, importHistory(old, mtime));
    }

    _save() {
        if (!this._ledger)
            return;
        this._sinceSave = 0;
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(this._statePath), 0o755);
            GLib.file_set_contents(this._statePath, JSON.stringify({
                version: 2,
                ...this._state,
                ledger: this._ledger,
            }));
        } catch (e) {
            console.error(`[${this.uuid}] cannot save state: ${e.message}`);
        }
    }
}
