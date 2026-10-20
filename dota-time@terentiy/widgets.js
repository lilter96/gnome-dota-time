// Popup widgets: the segmented control, the bar chart and the strip of
// today's heroes. Drawn with Cairo, moved by springs.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import St from 'gi://St';

import {Spring, WHITE, clamp, mix, roundRect, src} from './kit.js';
import {FrameLoop, animationsEnabled, followScale} from './ui.js';

const RED = [1, 0x45 / 255, 0x3a / 255];
const GREEN = [0x30 / 255, 0xd1 / 255, 0x58 / 255];
const GREY = [0.55, 0.56, 0.6];

function text(cr, str, x, y, {size = 10, weight = Pango.Weight.NORMAL, color = WHITE, alpha = 0.5, align = 'center'} = {}) {
    const layout = PangoCairo.create_layout(cr);
    const desc = Pango.FontDescription.from_string('Inter, Ubuntu Sans, sans');
    desc.set_absolute_size(size * Pango.SCALE);
    desc.set_weight(weight);
    layout.set_font_description(desc);
    layout.set_text(str, -1);
    const [, logical] = layout.get_pixel_extents();
    const dx = align === 'center' ? logical.width / 2 : align === 'right' ? logical.width : 0;
    src(cr, color, alpha);
    cr.moveTo(x - dx, y);
    PangoCairo.show_layout(cr, layout);
    return logical.width;
}

function dashed(cr, x0, x1, y, color, alpha, dash = [3, 3]) {
    cr.save();
    cr.setDash(dash, 0);
    cr.setLineWidth(1);
    src(cr, color, alpha);
    cr.newPath();
    cr.moveTo(x0, Math.round(y) + 0.5);
    cr.lineTo(x1, Math.round(y) + 0.5);
    cr.stroke();
    cr.restore();
}

// --- segmented control ---------------------------------------------------------

export const Segmented = GObject.registerClass({
    Signals: {'changed': {param_types: [GObject.TYPE_INT]}},
}, class Segmented extends St.Widget {
    _init(labels) {
        super._init({style_class: 'dt-seg', x_expand: true});
        this._pill = new St.Widget({style_class: 'dt-seg-pill'});
        this.add_child(this._pill);
        this._buttons = labels.map((label, i) => {
            const b = new St.Button({label, style_class: 'dt-seg-btn', can_focus: true});
            b.connect('clicked', () => this.select(i));
            this.add_child(b);
            return b;
        });
        this.index = 0;
        this._pos = new Spring(0, 0.4, 0.8);
        this._loop = new FrameLoop(this, dt => {
            this._pos.step(dt);
            this.queue_relayout();
            return !this._pos.resting;
        });
        this.connect('destroy', () => this._loop.destroy());
        this._mark();
    }

    select(i, quiet = false) {
        if (i === this.index)
            return;
        this.index = i;
        this._pos.to(i);
        if (animationsEnabled() && this.mapped)
            this._loop.start();
        else
            this._pos.snap(i);
        this.queue_relayout();
        this._mark();
        if (!quiet)
            this.emit('changed', i);
    }

    _mark() {
        this._buttons.forEach((b, i) => {
            if (i === this.index)
                b.add_style_pseudo_class('checked');
            else
                b.remove_style_pseudo_class('checked');
        });
    }

    vfunc_get_preferred_width(_forHeight) {
        let nat = 0;
        for (const b of this._buttons)
            nat += b.get_preferred_width(-1)[1];
        return this.get_theme_node().adjust_preferred_width(nat, nat);
    }

    vfunc_get_preferred_height(_forWidth) {
        const nat = Math.max(...this._buttons.map(b => b.get_preferred_height(-1)[1]));
        return this.get_theme_node().adjust_preferred_height(nat, nat);
    }

    vfunc_allocate(box) {
        this.set_allocation(box);
        const content = this.get_theme_node().get_content_box(box);
        const n = this._buttons.length;
        const w = (content.x2 - content.x1) / n;
        this._buttons.forEach((b, i) => {
            const x = content.x1 + i * w;
            b.allocate(new Clutter.ActorBox({x1: x, y1: content.y1, x2: x + w, y2: content.y2}));
        });
        const x = content.x1 + clamp(this._pos.x, -0.2, n - 0.8) * w;
        this._pill.allocate(new Clutter.ActorBox({x1: x, y1: content.y1, x2: x + w, y2: content.y2}));
    }
});

// --- bar chart -----------------------------------------------------------------------
//
// data: {bars: [{v, ghost, est, color, strong}], max, line: {v, label},
//        avg: {v, label}, ticks: [{i, label}], empty}
// v, ghost, max, line and avg share one unit (hours or minutes). Days known
// only from their matches (est) are drawn lighter.

const CH = {h: 112, top: 12, bottom: 86, labels: 91, right: 30};

export const Chart = GObject.registerClass(
class Chart extends St.DrawingArea {
    _init() {
        super._init({style_class: 'dt-chart', reactive: true, x_expand: true});
        this._data = {bars: [], max: 1};
        this._bars = [];        // per bar: {h: Spring, delay}
        this._fade = new Spring(1, 0.3);
        this._hover = -1;
        this.onHover = null;
        followScale(this, f => {
            this._k = f;
            this.set_height(CH.h * f);
        });
        this._loop = new FrameLoop(this, dt => this._frame(dt));
        this.connect('destroy', () => this._loop.destroy());
    }

    // animate: grow the bars from zero (popup opened, period switched)
    show(data, animate = false) {
        const n = data.bars.length;
        const reuse = !animate && this._bars.length === n;
        const old = this._bars;
        this._bars = data.bars.map((b, i) => {
            const sp = reuse ? old[i].h : new Spring(animate ? 0 : b.v, 0.62, 0.78);
            sp.to(b.v);
            return {h: sp, delay: animate ? 0.28 * i / Math.max(n - 1, 1) : 0};
        });
        this._data = data;
        if (this._hover >= n)
            this._hover = -1;
        if (animate && animationsEnabled()) {
            this._fade.from(0.2).to(1);
            this._loop.start();
        } else if (reuse && animationsEnabled() && this.mapped) {
            this._loop.start();
        } else {
            this._bars.forEach(b => b.h.snap(b.h.target));
            this._fade.snap(1);
        }
        this.queue_repaint();
    }

    _frame(dt) {
        let moving = false;
        for (const b of this._bars) {
            if (b.delay > 0) {
                b.delay -= dt;
                moving = true;
                continue;
            }
            b.h.step(dt);
            moving ||= !b.h.resting;
        }
        this._fade.step(dt);
        this.queue_repaint();
        return moving || !this._fade.resting;
    }

    _geometry() {
        const w = this.get_width() / this._k;
        const n = Math.max(this._bars.length, 1);
        const plot = w - CH.right;
        const slot = plot / n;
        const bw = Math.max(2, Math.min(slot * (n > 12 ? 0.58 : 0.56), 26));
        return {w, plot, slot, bw};
    }

    _indexAt(x) {
        const {plot, slot} = this._geometry();
        if (x < 0 || x > plot)
            return -1;
        return clamp(Math.floor(x / slot), 0, this._bars.length - 1);
    }

    vfunc_motion_event(event) {
        const [x, y] = event.get_coords();
        const [ok, lx] = this.transform_stage_point(x, y);
        const i = ok ? this._indexAt(lx / this._k) : -1;
        if (i !== this._hover) {
            this._hover = i;
            this.queue_repaint();
            this.onHover?.(i);
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_leave_event(event) {
        if (this._hover !== -1) {
            this._hover = -1;
            this.queue_repaint();
            this.onHover?.(-1);
        }
        return super.vfunc_leave_event(event);
    }

    vfunc_repaint() {
        const cr = this.get_context();
        cr.scale(this._k, this._k);
        const {w, plot, slot, bw} = this._geometry();
        const data = this._data;
        const max = Math.max(data.max, 1e-6);
        const y = v => CH.bottom - (CH.bottom - CH.top) * clamp(v / max, 0, 1.08);
        const fade = clamp(this._fade.x, 0, 1);

        // baseline
        src(cr, WHITE, 0.1);
        cr.rectangle(0, CH.bottom, plot, 1);
        cr.fill();

        const hovering = this._hover >= 0;
        data.bars.forEach((b, i) => {
            const cx = slot * (i + 0.5);
            const x = cx - bw / 2;
            const r = Math.min(bw / 2, 4.5);
            // last period, behind
            if (b.ghost > 0) {
                const gy = y(b.ghost);
                cr.newPath();
                roundRect(cr, x - 2, gy, bw + 4, CH.bottom - gy, r + 1);
                src(cr, WHITE, 0.07 * fade);
                cr.fill();
            }
            const v = Math.max(this._bars[i]?.h.x ?? b.v, 0);
            if (b.v > 0 && v > 0) {
                const top = Math.min(y(v), CH.bottom - 2.5);
                const dim = hovering && i !== this._hover ? 0.42 : 1;
                cr.newPath();
                roundRect(cr, x, top, bw, CH.bottom - top, r);
                src(cr, b.est ? mix(b.color, GREY, 0.25) : b.color, (b.est ? 0.62 : 1) * dim * fade);
                cr.fill();
                if (i === this._hover) {
                    cr.newPath();
                    roundRect(cr, x - 1.5, top - 1.5, bw + 3, CH.bottom - top + 3, r + 1.5);
                    src(cr, WHITE, 0.5);
                    cr.setLineWidth(1);
                    cr.stroke();
                }
            }
        });

        // the four-hour line and the period's average
        if (data.line) {
            const ly = y(data.line.v);
            dashed(cr, 0, plot + 2, ly, RED, 0.75);
            text(cr, data.line.label, w, ly - 7, {size: 10, color: RED, alpha: 0.95, align: 'right',
                weight: Pango.Weight.SEMIBOLD});
        }
        if (data.avg?.v > 0) {
            const ay = y(data.avg.v);
            dashed(cr, 0, plot + 2, ay, WHITE, 0.35, [1.5, 3]);
            if (!data.line || Math.abs(ay - y(data.line.v)) > 12)
                text(cr, data.avg.label, w, ay - 7, {size: 10, alpha: 0.55, align: 'right'});
        }
        if (data.empty)
            text(cr, data.empty, plot / 2, CH.bottom / 2 - 4, {size: 12, alpha: 0.4 * fade});

        // labels
        for (const t of data.ticks ?? []) {
            const b = data.bars[t.i];
            const strong = b?.strong || t.i === this._hover;
            text(cr, t.label, slot * (t.i + 0.5), CH.labels, {
                size: 10,
                alpha: strong ? 0.95 : 0.45,
                weight: strong ? Pango.Weight.SEMIBOLD : Pango.Weight.NORMAL,
                color: b?.strong ? b.color : WHITE,
            });
        }
        cr.$dispose();
    }
});

// --- today's heroes --------------------------------------------------------------------

const TILE = {w: 46, h: 26, gap: 6, bar: 3, r: 6};

export const MatchStrip = GObject.registerClass(
class MatchStrip extends St.DrawingArea {
    _init(portraits) {
        super._init({style_class: 'dt-strip', reactive: true, x_expand: true});
        this._portraits = portraits;
        this._matches = [];
        this._hover = -1;
        this._pulse = 0;
        this.onHover = null;
        followScale(this, f => {
            this._k = f;
            this.set_height((TILE.h + TILE.bar + 3) * f);
        });
        this._loop = new FrameLoop(this, dt => {
            this._pulse += dt;
            this.queue_repaint();
            return this._matches.some(m => m.live) && animationsEnabled();
        });
        this.connect('destroy', () => this._loop.destroy());
    }

    // matches: [{h, w, live}] in the order played
    show(matches) {
        this._matches = matches;
        if (matches.some(m => m.live) && this.mapped)
            this._loop.start();
        this.queue_repaint();
    }

    pause() {
        this._loop.stop();
    }

    resume() {
        if (this._matches.some(m => m.live))
            this._loop.start();
    }

    get _fit() {
        return Math.max(1, Math.floor((this.get_width() / this._k + TILE.gap) / (TILE.w + TILE.gap)));
    }

    // the tiles shown: the latest ones, with a "+N" in front if they do not fit
    _layout() {
        const fit = this._fit;
        const all = this._matches;
        if (all.length <= fit)
            return {more: 0, list: all.map((m, i) => [m, i])};
        const list = all.slice(all.length - (fit - 1)).map((m, i) => [m, all.length - (fit - 1) + i]);
        return {more: all.length - (fit - 1), list};
    }

    vfunc_motion_event(event) {
        const [x, y] = event.get_coords();
        const [ok, lx] = this.transform_stage_point(x, y);
        const {more, list} = this._layout();
        let i = -1;
        if (ok) {
            const slot = Math.floor((lx / this._k) / (TILE.w + TILE.gap)) - (more ? 1 : 0);
            if (slot >= 0 && slot < list.length)
                i = list[slot][1];
        }
        if (i !== this._hover) {
            this._hover = i;
            this.queue_repaint();
            this.onHover?.(i);
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_leave_event(event) {
        if (this._hover !== -1) {
            this._hover = -1;
            this.queue_repaint();
            this.onHover?.(-1);
        }
        return super.vfunc_leave_event(event);
    }

    vfunc_repaint() {
        const cr = this.get_context();
        cr.scale(this._k, this._k);
        const {more, list} = this._layout();
        let x = 0;
        if (more) {
            cr.newPath();
            roundRect(cr, x, 0, TILE.w, TILE.h, TILE.r);
            src(cr, WHITE, 0.08);
            cr.fill();
            text(cr, `+${more}`, x + TILE.w / 2, 5, {size: 12, alpha: 0.6, weight: Pango.Weight.SEMIBOLD});
            x += TILE.w + TILE.gap;
        }
        for (const [m, i] of list) {
            this._tile(cr, x, m, i === this._hover);
            x += TILE.w + TILE.gap;
        }
        cr.$dispose();
    }

    _tile(cr, x, m, hover) {
        const surf = this._portraits.get(m.h);
        const dim = this._hover >= 0 && !hover ? 0.55 : 1;
        cr.save();
        cr.newPath();
        roundRect(cr, x, 0, TILE.w, TILE.h, TILE.r);
        cr.clip();
        if (surf) {
            const s = Math.max(TILE.w / surf.getWidth(), TILE.h / surf.getHeight());
            cr.save();
            cr.translate(x, 0);
            cr.scale(s, s);
            cr.setSourceSurface(surf, 0, 0);
            cr.paintWithAlpha(dim);
            cr.restore();
            if (m.w === 0) {
                src(cr, [0, 0, 0], 0.35);
                cr.paint();
            }
        } else {
            src(cr, WHITE, 0.1 * dim);
            cr.paint();
        }
        cr.restore();

        // a hairline so dark portraits keep their shape
        cr.newPath();
        roundRect(cr, x + 0.5, 0.5, TILE.w - 1, TILE.h - 1, TILE.r - 0.5);
        src(cr, WHITE, hover ? 0.6 : 0.12);
        cr.setLineWidth(1);
        cr.stroke();

        if (m.live) {
            const a = 0.55 + 0.45 * Math.sin(this._pulse * 4);
            cr.newPath();
            roundRect(cr, x - 1, -1, TILE.w + 2, TILE.h + 2, TILE.r + 1);
            src(cr, GREEN, a);
            cr.setLineWidth(2);
            cr.stroke();
        }
        const c = m.live ? GREEN : m.w === 1 ? GREEN : m.w === 0 ? RED : GREY;
        cr.newPath();
        roundRect(cr, x + 8, TILE.h + 3, TILE.w - 16, TILE.bar, TILE.bar / 2);
        src(cr, c, m.live ? 0.5 : 0.95 * dim);
        cr.fill();
    }
});
