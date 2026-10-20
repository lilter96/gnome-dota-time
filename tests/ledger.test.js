import {
    AFK_LIMIT, Ledger, addDays, dayKey, dayStart, formatClock, formatDuration, importHistory, plural,
} from '../dota-time@terentiy/ledger.js';
import {assert, deepEqual, equal, near, test} from './harness.js';

// Local wall-clock time as epoch seconds, so the tests run in any time zone.
const at = (d, h, m = 0, s = 0) => new Date(2026, 9, d, h, m, s).getTime() / 1000;

function playFor(l, from, seconds, tick = 5) {
    for (let t = from; t <= from + seconds; t += tick)
        l.track(t, true);
    l.track(from + seconds + tick, false);
}

test('a game day starts at five in the morning', () => {
    equal(dayKey(at(20, 4, 59)), '2026-10-19');
    equal(dayKey(at(20, 5, 0)), '2026-10-20');
    equal(dayKey(at(20, 23, 30)), '2026-10-20');
    equal(dayStart('2026-10-20'), at(20, 5));
    equal(addDays('2026-10-31', 1), '2026-11-01');
    equal(addDays('2026-11-01', -1), '2026-10-31');
});

test('ticks while Dota runs add up into one segment', () => {
    const l = new Ledger();
    playFor(l, at(20, 18), 3600);
    equal(l.segs.length, 1);
    equal(l.tracked(at(20, 5), at(21, 5)), 3600);
});

test('a pause longer than a few ticks starts a new segment', () => {
    const l = new Ledger();
    l.track(at(20, 18), true);
    l.track(at(20, 18, 0, 5), true);
    l.track(at(20, 18, 5), true);   // five minutes later, e.g. after a suspend
    equal(l.segs.length, 2);
    equal(l.tracked(0, Infinity), 5);
});

test('going away takes the idle time back', () => {
    const l = new Ledger();
    // ticking on while you are away; the idle watch fires after AFK_LIMIT
    for (let t = at(20, 18); t <= at(20, 18, 40); t += 5)
        l.track(t, true);
    l.trim(at(20, 18, 40) - AFK_LIMIT);
    equal(l.tracked(0, Infinity), 1800);
});

test('a night session is one day, not two', () => {
    const l = new Ledger();
    playFor(l, at(20, 23), 3 * 3600);   // 23:00 → 02:00
    const d = l.day('2026-10-20');
    equal(d.total, 3 * 3600);
    equal(l.day('2026-10-21').total, 0);
});

test('matches the tracker did not see count with their own length', () => {
    const l = new Ledger();
    l.addMatch({id: '1', t: at(18, 15), d: 2400, h: 14, w: 1, src: 'od'});
    l.addMatch({id: '2', t: at(18, 16), d: 1800, h: 86, w: 0, src: 'od'});
    const d = l.day('2026-10-18');
    equal(d.tracked, 0);
    equal(d.unseen, 4200);
    equal(d.total, 4200);
    assert(d.estimated, 'a day known only from matches is marked');
    equal(d.wins, 1);
    equal(d.losses, 1);
});

test('matches inside tracked time are not counted twice', () => {
    const l = new Ledger();
    playFor(l, at(20, 18), 3600);
    l.addMatch({id: '3', t: at(20, 18, 10), d: 2400, w: 1, src: 'od'});
    // tracking started half-way through this one
    l.addMatch({id: '4', t: at(20, 17, 40), d: 2400, w: 0, src: 'od'});
    const d = l.day('2026-10-20');
    equal(d.unseen, 1200);
    equal(d.total, 3600 + 1200);
});

test('OpenDota fixes start and length, Dota fills the result first', () => {
    const l = new Ledger();
    assert(l.addMatch({id: '9', t: 1000, d: 2000, h: 14, w: 1, k: 10, src: 'gsi'}));
    assert(l.addMatch({id: '9', t: 900, d: 2050, h: 14, w: 1, k: 10, m: 22, src: 'od'}));
    deepEqual(l.matches.get('9'), {t: 900, d: 2050, h: 14, w: 1, k: 10, src: 'od', m: 22});
    // a late Dota post must not move it back
    l.addMatch({id: '9', t: 950, d: 1990, src: 'gsi'});
    equal(l.matches.get('9').t, 900);
    assert(!l.addMatch({id: '9', t: 900, d: 2050, src: 'od'}), 'nothing new');
});

test('hourly bins follow the game day', () => {
    const l = new Ledger();
    playFor(l, at(20, 5, 30), 1800);
    l.addMatch({id: '5', t: at(21, 1), d: 1800, src: 'od'});
    const bins = l.hourly('2026-10-20');
    equal(bins.length, 24);
    near(bins[0], 30, 0.01, '05:00–06:00');
    near(bins[20], 30, 0.01, '01:00–02:00 of the next night');
});

test('today stops at now', () => {
    const l = new Ledger();
    l.track(at(20, 18), true);
    l.track(at(20, 18, 0, 20), true);
    equal(l.day('2026-10-20', at(20, 18, 0, 10)).tracked, 10);
});

test('stats: usual day, week against week, aggro days, calm streak', () => {
    const l = new Ledger();
    // two weeks: 2 h a day, except one 5-hour day
    for (let d = 5; d <= 18; d++)
        playFor(l, at(d, 18), d === 15 ? 5 * 3600 : 2 * 3600);
    playFor(l, at(20, 18), 3600);
    const s = l.stats(at(20, 20));
    equal(s.usual, 2 * 3600);
    equal(s.aggroWeek, 1);
    equal(s.calmStreak, 4, 'the 16th, 17th, 18th and the empty 19th');
    equal(s.today.total, 3600);
    assert(s.week.prevKnown);
    // this week: 14th..20th = 2+5+2+2+2+0+1 h; the one before: 7th..13th = 14 h
    equal(s.week.sum, 14 * 3600);
    equal(s.week.prev, 14 * 3600);
});

test('win rate of the first three matches against the rest is shrunk', () => {
    const l = new Ledger();
    let id = 1;
    for (let d = 1; d <= 6; d++) {
        for (let i = 0; i < 6; i++)
            l.addMatch({id: String(id++), t: at(d, 12 + i), d: 2400, w: i < 3 ? 1 : 0, src: 'od'});
    }
    const w = l.winrateByOrder();
    equal(w.n, 36);
    equal(w.early.n, 18);
    near(w.overall, 0.5, 1e-9);
    // raw 100% and 0%, pulled towards 50% by eight imaginary games
    near(w.early.rate, (18 + 4) / 26, 1e-9);
    near(w.late.rate, 4 / 26, 1e-9);
    assert(w.enough);
});

test('the ledger survives a round trip through JSON', () => {
    const l = new Ledger();
    playFor(l, at(20, 18), 600);
    l.addMatch({id: '7', t: at(20, 18), d: 600, w: 1, src: 'gsi'});
    l.imported['2026-10-19'] = 3235;
    const back = new Ledger(JSON.parse(JSON.stringify(l)));
    deepEqual(back.toJSON(), l.toJSON());
    equal(back.firstDay, '2026-10-19');
});

test('imported time is not counted twice with the matches it covered', () => {
    const l = new Ledger();
    l.imported['2026-10-19'] = 3000;
    l.addMatch({id: '1', t: at(19, 22), d: 2000, w: 1, src: 'od'});
    equal(l.day('2026-10-19').total, 3000);
    l.addMatch({id: '2', t: at(19, 23), d: 2000, w: 0, src: 'od'});
    equal(l.day('2026-10-19').total, 4000);
});

test('history from the old extension lands on the right game day', () => {
    const h = {days: {'2026-10-18': {seconds: 7200}, '2026-10-20': {seconds: 3235.4}, junk: {seconds: 5}}};
    // last written at 03:45 on the 20th: that night belongs to the 19th
    deepEqual(importHistory(h, at(20, 3, 45)), {'2026-10-18': 7200, '2026-10-19': 3235});
    deepEqual(importHistory(h, at(20, 18)), {'2026-10-18': 7200, '2026-10-20': 3235});
    deepEqual(importHistory(null, 0), {});
});

test('Russian durations and plurals', () => {
    equal(formatDuration(0), '0 мин');
    equal(formatDuration(59 * 60), '59 мин');
    equal(formatDuration(3600), '1 ч');
    equal(formatDuration(4 * 3600 + 7 * 60), '4 ч 7 мин');
    equal(formatClock(3 * 3600 + 5 * 60 + 59), '3:05');
    equal(plural(1, 'матч', 'матча', 'матчей'), 'матч');
    equal(plural(3, 'матч', 'матча', 'матчей'), 'матча');
    equal(plural(11, 'матч', 'матча', 'матчей'), 'матчей');
    equal(plural(22, 'матч', 'матча', 'матчей'), 'матча');
});
