// The ledger: when Dota was open, which matches were played, and everything
// the popup derives from that. Pure JavaScript, no Shell imports.
//
// Time is counted in segments of wall-clock seconds while Dota is running and
// you are at the computer. Matches come from Dota itself (Game State
// Integration) and from OpenDota. Days before the tracker existed only know
// their matches, so for them the match time is all there is.

export const DAY_START_HOUR = 5;     // a gaming night belongs to the day it started
export const AGGRO_HOURS = 4;
export const AFK_LIMIT = 10 * 60;    // seconds without input that do not count
const GAP = 30;                      // ticks further apart start a new segment
const LATE_AFTER = 3;                // matches of a day that count as "early"

const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function dayKey(ts) {
    const d = new Date(ts * 1000);
    if (d.getHours() < DAY_START_HOUR)
        d.setDate(d.getDate() - 1);
    return keyOf(d);
}

function parts(key) {
    return key.split('-').map(Number);
}

export function dayStart(key) {
    const [y, m, d] = parts(key);
    return new Date(y, m - 1, d, DAY_START_HOUR).getTime() / 1000;
}

export function addDays(key, n) {
    const [y, m, d] = parts(key);
    return keyOf(new Date(y, m - 1, d + n, 12));
}

export function weekday(key) {
    const [y, m, d] = parts(key);
    return new Date(y, m - 1, d, 12).getDay();
}

const median = xs => {
    if (!xs.length)
        return null;
    const s = [...xs].sort((a, b) => a - b);
    const h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

export class Ledger {
    constructor(data = {}) {
        this.segs = (data.segs ?? [])
            .filter(s => Array.isArray(s) && s[1] >= s[0])
            .map(([s, e]) => [s, e])
            .sort((a, b) => a[0] - b[0]);
        this.imported = {...data.imported};
        this.matches = new Map(Object.entries(data.matches ?? {}));
        // The first game day known in full. From it on a day is all your time
        // in Dota; before it, only the match clocks OpenDota knows.
        this.since = typeof data.since === 'string' ? data.since : null;
        this.open = false;
    }

    toJSON() {
        return {
            segs: this.segs,
            imported: this.imported,
            matches: Object.fromEntries(this.matches),
            since: this.since,
        };
    }

    // --- tracking ---------------------------------------------------------

    // Called on every tick: `active` while Dota runs and you are not away.
    track(now, active) {
        const last = this.segs[this.segs.length - 1];
        if (!active) {
            this.open = false;
            return;
        }
        if (last && now < last[1])
            return;     // the clock went back; wait until it catches up
        if (this.open && last && now - last[1] <= GAP)
            last[1] = now;
        else
            this.segs.push([now, now]);
        this.open = true;
    }

    // You have been away since `at`: take that time back and stop counting.
    trim(at) {
        const last = this.segs[this.segs.length - 1];
        this.open = false;
        if (!last || last[1] <= at)
            return;
        last[1] = Math.max(last[0], at);
        if (last[1] - last[0] < 1)
            this.segs.pop();
    }

    // Seconds of tracked time in [a, b).
    tracked(a, b) {
        let sum = 0;
        for (const [s, e] of this.segs) {
            if (s >= b)
                break;
            if (e > a)
                sum += Math.min(e, b) - Math.max(s, a);
        }
        return sum;
    }

    get firstTracked() {
        return this.segs[0]?.[0] ?? null;
    }

    // --- matches ------------------------------------------------------------

    // m: {id, t, d, h, w, k, x, a, m, l, src}. Returns true if anything changed.
    addMatch(m) {
        const id = String(m.id);
        if (!id || id === '0')
            return false;
        const old = this.matches.get(id);
        const next = {...old};
        for (const [k, v] of Object.entries(m)) {
            if (k === 'id' || v === undefined || v === null)
                continue;
            // OpenDota knows the real start and length; Dota's own report
            // only fills what is missing
            if (old && m.src === 'gsi' && (k === 't' || k === 'd') && old.src === 'od')
                continue;
            next[k] = v;
        }
        if (old?.src === 'od')
            next.src = 'od';
        const changed = !old || JSON.stringify(old) !== JSON.stringify(next);
        if (changed)
            this.matches.set(id, next);
        return changed;
    }

    matchesIn(a, b) {
        const out = [];
        for (const [id, m] of this.matches) {
            if (m.t >= a && m.t < b)
                out.push({id, ...m});
        }
        return out.sort((x, y) => x.t - y.t);
    }

    // --- days ---------------------------------------------------------------

    // One game day. `total` is tracked time plus the parts of matches the
    // tracker did not see (before it existed, or while the Shell was off).
    day(key, now = Infinity) {
        const a = dayStart(key), b = Math.min(dayStart(addDays(key, 1)), now);
        const matches = this.matchesIn(a, dayStart(addDays(key, 1)));
        const imported = this.imported[key] ?? 0;
        const tracked = (b > a ? this.tracked(a, b) : 0) + imported;
        let unseen = 0;
        for (const m of matches) {
            const d = m.d ?? 0;
            unseen += Math.max(0, d - this.tracked(m.t, m.t + d));
        }
        // imported time has no clock: assume it covered these matches first
        unseen = Math.max(0, unseen - imported);
        const wins = matches.filter(m => m.w === 1).length;
        const losses = matches.filter(m => m.w === 0).length;
        return {
            key,
            tracked,
            unseen,
            total: tracked + unseen,
            // the game clock only, from the horn: what every day has, old or new
            matchTime: matches.reduce((sum, m) => sum + (m.d ?? 0), 0),
            full: this.since !== null && key >= this.since,
            estimated: unseen > 60,
            matches,
            wins,
            losses,
        };
    }

    series(endKey, n, now = Infinity) {
        const out = [];
        for (let i = n - 1; i >= 0; i--)
            out.push(this.day(addDays(endKey, -i), now));
        return out;
    }

    // Minutes per clock hour of the day, in the order the day runs (05:00 first).
    hourly(key, now = Infinity) {
        const a = dayStart(key);
        const bins = [];
        const day = this.day(key, now);
        for (let i = 0; i < 24; i++) {
            const h0 = a + i * 3600, h1 = Math.min(h0 + 3600, now);
            let s = h1 > h0 ? this.tracked(h0, h1) : 0;
            for (const m of day.matches) {
                const d = m.d ?? 0;
                const lo = Math.max(m.t, h0), hi = Math.min(m.t + d, h0 + 3600);
                if (hi > lo)
                    s += Math.max(0, hi - lo - this.tracked(lo, hi));
            }
            bins.push(s / 60);
        }
        return bins;
    }

    // --- comparisons ----------------------------------------------------------

    // Comparisons put like against like: whole days once enough of them are
    // known in full, the match clock on both sides until then. `by` says which.
    stats(now) {
        const today = dayKey(now);
        const t = this.day(today, now);
        const past = this.series(addDays(today, -1), 56);

        let usual = null;
        const fullDays = past.filter(d => d.full && d.total >= 60).slice(-28);
        const matchDays = past.filter(d => d.matchTime >= 60).slice(-28);
        if (t.full && fullDays.length >= 3)
            usual = {by: 'total', value: median(fullDays.map(d => d.total)), today: t.total};
        else if (matchDays.length >= 3)
            usual = {by: 'matches', value: median(matchDays.map(d => d.matchTime)), today: t.matchTime};

        const week = this.series(today, 7, now);
        const prevWeek = this.series(addDays(today, -7), 7);
        const by = prevWeek.every(d => d.full) ? 'total' : 'matches';
        const sum = xs => xs.reduce((s, d) => s + (by === 'total' ? d.total : d.matchTime), 0);
        const knownSince = this.firstDay;

        const month = this.series(today, 30, now);
        const aggro = d => d.total >= AGGRO_HOURS * 3600;

        // Days in a row under four hours. Only full days can say so: one known by
        // its matches alone may have had four hours of Dota around them.
        let calm = 0;
        for (let i = past.length - 1; i >= 0 && past[i].full && !aggro(past[i]); i--)
            calm++;

        return {
            today: t,
            usual,
            week: {by, sum: sum(week), prev: sum(prevWeek), prevKnown: knownSince !== null && knownSince <= prevWeek[0].key},
            // days known by their matches alone are a lower bound: counts can only grow
            aggroWeek: week.filter(aggro).length,
            aggroWeekAtLeast: week.some(d => !d.full && !aggro(d)),
            aggroMonth: month.filter(aggro).length,
            aggroMonthAtLeast: month.some(d => !d.full && !aggro(d)),
            calmStreak: aggro(t) ? 0 : calm,
            winrate: this.winrateByOrder(),
        };
    }

    // The first day anything is known about.
    get firstDay() {
        let first = null;
        if (this.segs.length)
            first = dayKey(this.segs[0][0]);
        for (const k of Object.keys(this.imported)) {
            if (!first || k < first)
                first = k;
        }
        for (const m of this.matches.values()) {
            const k = dayKey(m.t);
            if (!first || k < first)
                first = k;
        }
        return first;
    }

    // Win rate of the first three matches of a day against the rest, and how
    // likely a gap this size is by chance alone (Fisher's exact test).
    winrateByOrder(minEach = 8) {
        const byDay = new Map();
        for (const m of this.matches.values()) {
            if (m.w !== 0 && m.w !== 1)
                continue;
            const k = dayKey(m.t);
            if (!byDay.has(k))
                byDay.set(k, []);
            byDay.get(k).push(m);
        }
        const early = {n: 0, w: 0}, late = {n: 0, w: 0};
        for (const list of byDay.values()) {
            list.sort((a, b) => a.t - b.t);
            list.forEach((m, i) => {
                const g = i < LATE_AFTER ? early : late;
                g.n++;
                g.w += m.w;
            });
        }
        const n = early.n + late.n;
        if (!n)
            return null;
        const rate = g => g.n ? g.w / g.n : null;
        const p = fisher(early.w, early.n, late.w, late.n);
        return {
            n,
            overall: (early.w + late.w) / n,
            early: {...early, rate: rate(early)},
            late: {...late, rate: rate(late)},
            p,
            real: p < 0.05,
            enough: early.n >= minEach && late.n >= minEach,
        };
    }
}

// Two-sided Fisher's exact test: the chance that wins split between a group of
// `an` games and one of `bn` at least as unevenly as aw/an against bw/bn, if
// both groups win equally often.
export function fisher(aw, an, bw, bn) {
    const n = an + bn, w = aw + bw;
    if (!an || !bn)
        return 1;
    const lf = [0];
    for (let i = 1; i <= n; i++)
        lf.push(lf[i - 1] + Math.log(i));
    // P(the first group won k), the totals fixed
    const prob = k => Math.exp(lf[w] - lf[k] - lf[w - k] + lf[n - w] - lf[an - k] - lf[bn - w + k] -
        lf[n] + lf[an] + lf[bn]);
    const seen = prob(aw);
    let p = 0;
    for (let k = Math.max(0, w - bn); k <= Math.min(an, w); k++) {
        const pk = prob(k);
        if (pk <= seen * (1 + 1e-7))
            p += pk;
    }
    return Math.min(1, p);
}

// --- formatting -----------------------------------------------------------------

export function plural(n, one, few, many) {
    const d = n % 10, h = n % 100;
    if (d === 1 && h !== 11)
        return one;
    if (d >= 2 && d <= 4 && (h < 12 || h > 14))
        return few;
    return many;
}

export function formatDuration(seconds) {
    const m = Math.round(Math.max(seconds, 0) / 60);
    const h = Math.floor(m / 60), r = m % 60;
    if (!h)
        return `${r} мин`;
    return r ? `${h} ч ${r} мин` : `${h} ч`;
}

export function formatClock(seconds) {
    const m = Math.floor(Math.max(seconds, 0) / 60);
    return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}

export function matchesWord(n) {
    return plural(n, 'матч', 'матча', 'матчей');
}

// Days from the earlier dota-time extension (~/.local/state/dota-time/history.json):
// calendar days with no clock times. The last one was written at `mtime`; if
// that was before 05:00 of that date, all of it belongs to the game day before.
export function importHistory(history, mtime) {
    const out = {};
    const days = Object.entries(history?.days ?? {})
        .filter(([k, v]) => /^\d{4}-\d{2}-\d{2}$/.test(k) && v?.seconds > 0)
        .sort(([a], [b]) => (a < b ? -1 : 1));
    days.forEach(([k, v], i) => {
        let key = k;
        if (i === days.length - 1 && mtime && dayKey(mtime) < k)
            key = addDays(k, -1);
        out[key] = (out[key] ?? 0) + Math.round(v.seconds);
    });
    return out;
}
