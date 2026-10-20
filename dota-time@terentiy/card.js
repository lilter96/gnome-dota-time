// The popup: Roshan in his pit, today's time, today's heroes, the day / week /
// month chart and a few honest comparisons.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {heroName} from './heroes.js';
import {AGGRO_HOURS, dayStart, formatDuration, matchesWord, plural, weekday} from './ledger.js';
import {MOODS, Roshan, moodFor} from './roshan.js';
import {HeroView, animationsEnabled} from './ui.js';
import {Chart, MatchStrip, Segmented} from './widgets.js';

const CENTER = Clutter.ActorAlign.CENTER;
const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа',
    'сентября', 'октября', 'ноября', 'декабря'];
const MODES = ['day', 'week', 'month'];
// Dota is open, but the clock stands
const PAUSED = {
    background: 'Дота в фоне, время стоит',
    away: 'Ты отошёл, время стоит',
    demo: 'Пробный герой не в счёт',
    custom: 'Аркада не в счёт',
    practice: 'Тренировка не в счёт',
};
const PRACTICE = {demo: 'Пробный герой', custom: 'Аркада', practice: 'Тренировка'};
const esc = s => GLib.markup_escape_text(s, -1);

const dateLabel = key => {
    const [, m, d] = key.split('-').map(Number);
    return `${WEEKDAYS[weekday(key)]}, ${d} ${MONTHS[m - 1]}`;
};

// "3 ч 12 мин" with quieter units
function timeMarkup(seconds) {
    const m = Math.round(Math.max(seconds, 0) / 60);
    const h = Math.floor(m / 60), r = m % 60;
    const unit = u => `<span size="15360" alpha="55%" font_weight="500">${u}</span>`;
    if (!h)
        return `${r}${unit(' мин')}`;
    return r ? `${h}${unit(' ч ')}${r}${unit(' мин')}` : `${h}${unit(' ч')}`;
}

function percentChange(a, b) {
    if (!(b > 0))
        return null;
    return Math.round((a - b) / b * 100);
}

// A comparison tile: a small caption, a value, one quiet line.
function makeTile() {
    const box = new St.BoxLayout({vertical: true, style_class: 'dt-tile', x_expand: true});
    const label = new St.Label({style_class: 'dt-tile-label'});
    const value = new St.Label({style_class: 'dt-tile-value'});
    const sub = new St.Label({style_class: 'dt-tile-sub'});
    for (const a of [label, value, sub])
        box.add_child(a);
    const set = (l, v, s, tone = '') => {
        label.text = l;
        value.text = v;
        sub.text = s;
        value.style_class = `dt-tile-value ${tone ? `dt-tone-${tone}` : ''}`;
    };
    return {box, set};
}

export const Card = GObject.registerClass(
class Card extends St.BoxLayout {
    _init(portraits) {
        super._init({vertical: true, style_class: 'dt-card'});
        this.roshan = new Roshan({reducedMotion: !animationsEnabled()});
        this.hero = new HeroView(this.roshan);
        this.hero.onFrame = () => this._syncTime();
        this._model = null;
        this._mode = 1;
        this._chartHover = -1;
        this._stripHover = -1;

        this._time = new St.Label({style_class: 'dt-time', x_align: CENTER});
        this._status = new St.Label({style_class: 'dt-status', x_align: CENTER});

        this._live = new St.BoxLayout({style_class: 'dt-live', x_align: CENTER, visible: false});
        this._liveDot = new St.Widget({style_class: 'dt-live-dot', y_align: CENTER});
        this._liveText = new St.Label({style_class: 'dt-live-text', y_align: CENTER});
        this._live.add_child(this._liveDot);
        this._live.add_child(this._liveText);

        this._todayHead = new St.BoxLayout({style_class: 'dt-section-head'});
        this._todayTitle = new St.Label({style_class: 'dt-section-title', x_expand: true});
        this._todayRight = new St.Label({style_class: 'dt-section-right'});
        this._todayHead.add_child(this._todayTitle);
        this._todayHead.add_child(this._todayRight);
        this._strip = new MatchStrip(portraits);
        this._strip.onHover = i => {
            this._stripHover = i;
            this._syncToday();
        };
        this._todayBox = new St.BoxLayout({vertical: true, style_class: 'dt-today'});
        this._todayBox.add_child(this._todayHead);
        this._todayBox.add_child(this._strip);

        this._seg = new Segmented(['День', 'Неделя', 'Месяц']);
        this._seg.select(this._mode, true);
        this._seg.connect('changed', (_s, i) => {
            this._mode = i;
            this._chartHover = -1;
            this._syncChart(true);
        });

        this._chartCaption = new St.Label({style_class: 'dt-chart-caption'});
        this._chartValue = new St.Label({style_class: 'dt-chart-value'});
        this._chartChip = new St.Label({style_class: 'dt-chip', y_align: CENTER});
        const valueRow = new St.BoxLayout({style_class: 'dt-chart-value-row'});
        valueRow.add_child(this._chartValue);
        valueRow.add_child(new St.Widget({x_expand: true}));
        valueRow.add_child(this._chartChip);
        this._chart = new Chart();
        this._chart.onHover = i => {
            this._chartHover = i;
            this._syncChartHead();
        };
        const chartBox = new St.BoxLayout({vertical: true, style_class: 'dt-chart-box'});
        for (const a of [this._seg, this._chartCaption, valueRow, this._chart])
            chartBox.add_child(a);

        this._tiles = [0, 1, 2, 3].map(() => makeTile());
        const grid = new St.BoxLayout({vertical: true, style_class: 'dt-tiles'});
        for (const pair of [this._tiles.slice(0, 2), this._tiles.slice(2)]) {
            const row = new St.BoxLayout({style_class: 'dt-tiles-row'});
            row.layout_manager.homogeneous = true;
            pair.forEach(t => row.add_child(t.box));
            grid.add_child(row);
        }

        // set up live matches: one line and a button
        this._tip = new St.BoxLayout({style_class: 'dt-tip'});
        this._tipText = new St.Label({style_class: 'dt-tip-text', x_expand: true, y_align: CENTER});
        this._tipText.clutter_text.line_wrap = true;
        this._tipText.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._copy = new St.Button({style_class: 'dt-tip-btn', can_focus: true, y_align: CENTER});
        this._copy.connect('clicked', () => {
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, '-gamestateintegration');
            this._copy.label = 'Готово';
            this._copy.add_style_pseudo_class('checked');
        });
        this._tip.add_child(this._tipText);
        this._tip.add_child(this._copy);

        this._note = new St.Label({style_class: 'dt-note'});
        this._note.clutter_text.line_wrap = true;
        this._note.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        for (const a of [this.hero, this._time, this._status, this._live, this._todayBox, chartBox, grid, this._tip, this._note])
            this.add_child(a);
        this._playing = false;
        this._pending = null;
    }

    // The popup opened or closed.
    play() {
        this._playing = true;
        this.hero.play();
        // a match that ended while the popup was closed still gets its reaction
        const p = this._pending;
        this._pending = null;
        if (p && GLib.get_monotonic_time() / 1e6 - p.at < 15 * 60)
            this.roshan.react(p.kind);
        this._strip.resume();
        this._syncChart(true);
    }

    pause() {
        this._playing = false;
        this.hero.pause();
        this._strip.pause();
    }

    react(kind) {
        if (!this._playing) {
            this._pending = {kind, at: GLib.get_monotonic_time() / 1e6};
            return;
        }
        this.roshan.react(kind);
        this.hero.wake();
    }

    // The popup is closed: keep only Roshan's mood current.
    idle({hours, running, live}) {
        this.roshan.update({hours, awake: running, inMatch: !!live && !live.practice});
    }

    // A live update from Dota while the popup is open.
    setLive(live) {
        if (!this._model)
            return;
        this._model.live = live;
        this._syncLive();
    }

    portraitsChanged() {
        this._strip.queue_repaint();
    }

    // model: see DotaTimeExtension._model()
    update(model) {
        const old = this._model;
        this._model = model;
        const hours = model.today.total / 3600;
        this.roshan.update({hours, awake: model.running, inMatch: !!model.live && !model.live.practice});
        if (old && moodFor(old.today.total / 3600) !== moodFor(hours))
            this.hero.wake();
        if (old && old.running !== model.running)
            this.hero.wake();

        this._syncTime();
        this._syncStatus();
        this._syncLive();
        this._syncToday();
        this._syncChart(false);
        this._syncRows();
        this._syncNote();
    }

    _syncTime() {
        const m = this._model;
        if (!m)
            return;
        // count up with the ring while it sweeps in
        const goal = this.roshan.ringGoal;
        const progress = goal > 0 ? Math.min(this.roshan.s.ring.x / goal, 1) : 1;
        const shown = Math.round(m.today.total * Math.max(progress, 0) / 60) * 60;
        if (shown !== this._shownTime) {
            this._shownTime = shown;
            this._time.clutter_text.set_markup(timeMarkup(shown));
        }
    }

    _syncStatus() {
        const m = this._model;
        const total = m.today.total;
        const left = AGGRO_HOURS * 3600 - total;
        const mood = moodFor(total / 3600);
        let text;
        const rest = left > 0 ? `до агра ${formatDuration(left)}` : `+${formatDuration(-left)} сверх 4 ч`;
        if (!m.running) {
            text = total < 60 ? 'Рошан спит. Сегодня без Доты'
                : left > 0 ? `Рошан спит · до агра ${formatDuration(left)}`
                    : `Рошан спит · сегодня было +${formatDuration(-left)} сверх 4 ч`;
        } else if (m.paused) {
            text = `${PAUSED[m.paused]} · ${rest}`;
        } else if (mood === 3) {
            text = `Рошан в агре · ${rest}`;
        } else {
            text = `${mood === 2 ? 'Рошан ворчит' : 'Рошан следит'} · ${rest}`;
        }
        this._status.text = text;
        for (const [cls, on] of [['dt-status-aggro', mood === 3], ['dt-status-grumpy', mood === 2 && m.running]]) {
            if (on)
                this._status.add_style_class_name(cls);
            else
                this._status.remove_style_class_name(cls);
        }
    }

    _syncLive() {
        const live = this._model.live;
        this._live.visible = !!live;
        if (!live)
            return;
        if (live.practice)
            this._live.add_style_class_name('dt-live-practice');
        else
            this._live.remove_style_class_name('dt-live-practice');
        const parts = [live.practice ? PRACTICE[live.kind] : 'В матче'];
        if (live.hero)
            parts.push(heroName(live.hero));
        if (live.clock > 0) {
            const c = Math.floor(live.clock);
            parts.push(`${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`);
            parts.push(`${live.k}/${live.x}/${live.a}`);
        }
        this._liveText.text = parts.join(' · ');
    }

    _syncToday() {
        const m = this._model;
        if (!m)
            return;
        const list = m.today.matches.map(x => ({h: x.h, w: x.w, d: x.d, k: x.k, x: x.x, a: x.a}));
        if (m.live && !m.live.practice && !list.some(x => x.live) && !m.today.matches.some(x => x.id === m.live.id))
            list.push({h: m.live.hero, w: undefined, live: true});
        this._todayBox.visible = list.length > 0;
        this._strip.show(list);
        const h = this._stripHover >= 0 ? list[this._stripHover] : null;
        if (h) {
            const bits = [heroName(h.h) || 'Матч'];
            if (h.d)
                bits.push(formatDuration(h.d));
            if (h.k !== undefined)
                bits.push(`${h.k}/${h.x}/${h.a}`);
            this._todayTitle.text = bits.join(' · ');
            this._todayRight.text = h.live ? 'идёт' : h.w === 1 ? 'победа' : h.w === 0 ? 'поражение' : '';
        } else {
            const n = m.today.matches.length;
            this._todayTitle.text = 'Сегодня';
            const wl = m.today.wins + m.today.losses ? ` · ${m.today.wins}–${m.today.losses}` : '';
            this._todayRight.text = n ? `${n} ${matchesWord(n)}${wl}` : 'первый матч';
        }
    }

    // --- chart ---------------------------------------------------------------

    _barColor(hours) {
        return MOODS[moodFor(hours)].color;
    }

    _chartData() {
        const m = this._model, mode = MODES[this._mode];
        if (mode === 'day') {
            const bins = m.hourly;
            const color = this._barColor(m.today.total / 3600);
            const nowBin = Math.floor((m.now - dayStart(m.today.key)) / 3600);
            return {
                bars: bins.map((v, i) => ({v, color, strong: i === nowBin && m.running})),
                max: 60,
                ticks: [0, 6, 12, 18].map(i => ({i, label: String((i + 5) % 24)})),
                empty: m.today.total < 60 ? 'Сегодня ещё не играл' : '',
            };
        }
        const days = mode === 'week' ? m.week : m.month;
        const prev = mode === 'week' ? m.prevWeek : null;
        const hours = days.map(d => d.total / 3600);
        const sum = hours.reduce((a, b) => a + b, 0);
        const ticks = mode === 'week'
            ? days.map((d, i) => ({i, label: WEEKDAYS[weekday(d.key)]}))
            : days.map((d, i) => ({i, d})).filter(({i}) => (days.length - 1 - i) % 7 === 0)
                .map(({i, d}) => ({i, label: String(Number(d.key.slice(8)))}));
        const max = Math.max(AGGRO_HOURS * 1.25, ...hours, ...(prev ?? []).map(d => d.total / 3600)) * 1.05;
        return {
            bars: days.map((d, i) => ({
                v: hours[i],
                // a day seen whole against one known by its matches alone would look like growth
                ghost: prev && (prev[i].full || !d.full) ? prev[i].total / 3600 : 0,
                est: d.estimated,
                color: this._barColor(hours[i]),
                strong: i === days.length - 1,
            })),
            max,
            line: {v: AGGRO_HOURS, label: '4 ч'},
            avg: {v: sum / days.length, label: 'ср.'},
            ticks,
            empty: sum === 0 ? 'Пока пусто' : '',
        };
    }

    _syncChart(animate) {
        if (!this._model)
            return;
        this._chart.show(this._chartData(), animate && animationsEnabled());
        this._syncChartHead();
    }

    // Caption, value and a chip over the chart: the whole period, or the bar under the pointer.
    _syncChartHead() {
        const m = this._model, mode = MODES[this._mode];
        const i = this._chartHover;
        let caption, value, chip = '', tone = '';
        if (mode === 'day') {
            if (i >= 0) {
                const h = (i + 5) % 24;
                caption = `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;
                value = formatDuration(m.hourly[i] * 60);
            } else {
                caption = `Сегодня, ${dateLabel(m.today.key).toLowerCase()}`;
                value = formatDuration(m.today.total);
            }
        } else {
            const days = mode === 'week' ? m.week : m.month;
            if (i >= 0 && days[i]) {
                const d = days[i];
                const bits = [dateLabel(d.key)];
                const n = d.matches.length;
                if (n)
                    bits.push(`${n} ${matchesWord(n)}${d.wins + d.losses ? `, ${d.wins}–${d.losses}` : ''}`);
                if (d.estimated)
                    bits.push(d.tracked > 60 ? 'часть по матчам' : 'по матчам');
                caption = bits.join(' · ');
                value = formatDuration(d.total);
                if (d.total >= AGGRO_HOURS * 3600) {
                    chip = 'агр';
                    tone = 'red';
                }
            } else {
                const sum = days.reduce((a, d) => a + d.total, 0);
                caption = `${mode === 'week' ? 'За 7 дней' : 'За 30 дней'} · в среднем ${formatDuration(sum / days.length)} в день`;
                value = formatDuration(sum);
            }
        }
        this._chartCaption.text = caption;
        this._chartValue.text = value;
        this._chartChip.text = chip;
        this._chartChip.visible = !!chip;
        this._chartChip.style_class = `dt-chip ${tone ? `dt-chip-${tone}` : ''}`;
    }

    // --- comparisons -----------------------------------------------------------

    _syncRows() {
        const m = this._model, s = m.stats, [usual, week, aggro, fourth] = this._tiles;
        const signed = d => `${d > 0 ? '+' : '−'}${formatDuration(Math.abs(d))}`;

        // `by` matches: the days compared are known only by their match clocks,
        // so today is counted the same way
        const u = s.usual;
        if (u === null)
            usual.set('Обычный день', '—', 'нужно 3 игровых дня');
        else if (u.today < 60)
            usual.set(u.by === 'total' ? 'Обычный день' : 'Обычно в матчах', formatDuration(u.value), 'медиана игровых дней');
        else if (Math.abs(u.today - u.value) < 5 * 60)
            usual.set(u.by === 'total' ? 'К обычному дню' : 'День в матчах', 'как обычно', `обычно ${formatDuration(u.value)}`);
        else
            usual.set(u.by === 'total' ? 'К обычному дню' : 'День в матчах', signed(u.today - u.value),
                `обычно ${formatDuration(u.value)}`, u.today > u.value ? 'red' : 'green');

        const p = s.week.prevKnown ? percentChange(s.week.sum, s.week.prev) : null;
        const weekLabel = s.week.by === 'total' ? 'Неделя к прошлой' : 'Неделя в матчах';
        if (p === null)
            week.set(weekLabel, formatDuration(s.week.sum), 'прошлой ещё нет');
        else
            week.set(weekLabel, p === 0 ? 'так же' : `${p > 0 ? '↑' : '↓'} ${Math.abs(p)}%`,
                `было ${formatDuration(s.week.prev)}`, p > 5 ? 'red' : p < -5 ? 'green' : '');

        // a day known by its matches alone can only turn out longer: counts are a minimum
        const streak = s.calmStreak;
        let aggroSub;
        if (s.aggroWeekAtLeast)
            aggroSub = 'минимум: дни по матчам';
        else if (streak > 1)
            aggroSub = `спокойно ${streak} ${plural(streak, 'день', 'дня', 'дней')} подряд`;
        else
            aggroSub = `за 30 дней: ${s.aggroMonthAtLeast ? 'минимум ' : ''}${s.aggroMonth}`;
        aggro.set('Дни в агре', `${s.aggroWeek} из 7`, aggroSub, s.aggroWeek > 0 ? 'red' : 'green');

        const w = s.winrate;
        const pc = x => `${Math.round(x * 100)}%`;
        if (w?.enough && w.real) {
            const drop = w.late.rate - w.early.rate;
            fourth.set('Винрейт за день', `${pc(w.early.rate)} → ${pc(w.late.rate)}`, 'первые 3 игры → дальше',
                drop < 0 ? 'red' : 'green');
        } else if (w?.enough) {
            // the gap is what chance alone gives often enough: say so, no colour
            fourth.set('Винрейт за день', 'разницы нет', `${pc(w.early.rate)} → ${pc(w.late.rate)}, это шум`);
        } else {
            const ms = m.week.flatMap(d => d.matches);
            const wins = ms.filter(x => x.w === 1).length, losses = ms.filter(x => x.w === 0).length;
            fourth.set('Матчи за неделю', String(ms.length),
                wins + losses ? `${wins}–${losses}, побед ${Math.round(wins / (wins + losses) * 100)}%` : 'пока ни одного');
        }
    }

    _syncNote() {
        const m = this._model;
        // the flag is what Dota was last started with; a post settles it when the flag is unknown
        this._tip.visible = m.gsi.listening && (m.gsi.flag === false || (m.gsi.flag === null && !m.gsi.seen));
        if (this._tip.visible) {
            this._tipText.text = 'Живые матчи: добавь \u2011gamestateintegration в параметры запуска Dota 2';
            if (!this._copy.has_style_pseudo_class('checked'))
                this._copy.label = 'Копировать';
        }
        const notes = [];
        // about the whole month, so the popup keeps its height across the tabs
        if (m.month.some(d => d.estimated))
            notes.push('Бледные дни известны только по матчам из OpenDota: поиск и меню в них не попали.');
        if (m.odError)
            notes.push('OpenDota не отвечает, история подтянется позже.');
        this._note.text = notes.join(' ');
        this._note.visible = notes.length > 0;
    }
});

