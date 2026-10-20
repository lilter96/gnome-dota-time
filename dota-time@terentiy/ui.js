// Shell widgets for Roshan: the animated hero, the panel glyph and the
// rolling labels. All motion is driven by springs from kit.js.

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

import {ColorSpring, Spring, clamp, pivotOf} from './kit.js';
import {GLYPH, HERO, MOODS, SCENE, drawGlyph, drawParticle, particleBox, particleXf} from './roshan.js';

const DEG = 180 / Math.PI;
const now = () => GLib.get_monotonic_time() / 1e6;

export const animationsEnabled = () => St.Settings.get().enable_animations;

// Sizes are in logical pixels; St wants physical ones on HiDPI screens.
const theme = () => St.ThemeContext.get_for_stage(global.stage);

export function followScale(actor, callback) {
    const ctx = theme();
    const id = ctx.connect('notify::scale-factor', () => callback(ctx.scale_factor));
    actor.connect('destroy', () => ctx.disconnect(id));
    callback(ctx.scale_factor);
}

// Calls back on every frame of the actor's monitor until stopped or the
// callback returns false.
export class FrameLoop {
    constructor(actor, callback) {
        this._timeline = new Clutter.Timeline({actor, duration: 1000, repeat_count: -1});
        this._timeline.connect('new-frame', () => {
            const t = now();
            const dt = Math.min(t - this._last, 0.05);
            this._last = t;
            if (callback(dt) === false)
                this._timeline.stop();
        });
    }

    start() {
        if (this._timeline.is_playing())
            return;
        this._last = now();
        this._timeline.start();
    }

    stop() {
        this._timeline?.stop();
    }

    get playing() {
        return this._timeline?.is_playing() ?? false;
    }

    destroy() {
        this.stop();
        this._timeline = null;
    }
}

function applyXf(actor, cache, xf, k) {
    const tx = (xf.tx ?? 0) * k, ty = (xf.ty ?? 0) * k;
    const rot = (xf.rot ?? 0) * DEG;
    const sx = xf.sx ?? xf.s ?? 1, sy = xf.sy ?? xf.s ?? 1;
    const op = Math.round(clamp(xf.alpha ?? 1, 0, 1) * 255);
    if (cache.tx !== tx || cache.ty !== ty) {
        actor.set_translation(tx, ty, 0);
        cache.tx = tx;
        cache.ty = ty;
    }
    if (cache.rot !== rot) {
        actor.rotation_angle_z = rot;
        cache.rot = rot;
    }
    if (cache.sx !== sx || cache.sy !== sy) {
        actor.set_scale(sx, sy);
        cache.sx = sx;
        cache.sy = sy;
    }
    if (cache.op !== op) {
        actor.opacity = op;
        actor.visible = op > 0;
        cache.op = op;
    }
}

export function paintArea(area, box, k, draw) {
    const cr = area.get_context();
    cr.save();
    cr.setOperator(Cairo.Operator.CLEAR);
    cr.paint();
    cr.restore();
    cr.scale(k, k);
    cr.translate(-box[0], -box[1]);
    draw(cr);
    cr.$dispose();
}

// The scene from roshan.js as a tree of Clutter actors. Each layer is a
// texture that is redrawn only when its key changes; the rest is transforms.
export const HeroView = GObject.registerClass(
class HeroView extends St.Widget {
    _init(roshan) {
        super._init({reactive: true, x_align: Clutter.ActorAlign.CENTER});
        this.roshan = roshan;
        this.onFrame = null;
        this._pose = roshan.pose;
        this._layers = [];
        this._particles = new Map();
        this._loop = new FrameLoop(this, dt => this._frame(dt));
        this.connect('destroy', () => this._loop.destroy());
        followScale(this, f => this._rebuild(f));
    }

    // Textures are drawn at the final pixel size, so a new scale means new actors.
    _rebuild(factor) {
        this.destroy_all_children();
        this._layers = [];
        this._particles.clear();
        this._k = HERO.scale * factor;
        this.set_size(HERO.w * this._k, HERO.h * this._k);
        this._build(SCENE, this, HERO.x0, HERO.y0);
        this._sync();
    }

    _build(layers, parent, ox, oy) {
        const k = this._k;
        for (const l of layers) {
            const [bx, by, bw, bh] = l.box;
            const actor = l.draw
                ? new St.DrawingArea({width: bw * k, height: bh * k})
                : new St.Widget({width: bw * k, height: bh * k});
            actor.set_position((bx - ox) * k, (by - oy) * k);
            const [px, py] = pivotOf(l);
            actor.pivot_point = new Graphene.Point({x: (px - bx) / bw, y: (py - by) / bh});
            if (l.draw)
                actor.connect('repaint', area => paintArea(area, l.box, k, cr => l.draw(cr, this._pose)));
            parent.add_child(actor);
            this._layers.push({l, actor, key: undefined, cache: {}});
            if (l.children)
                this._build(l.children, actor, bx, by);
        }
    }

    _sync() {
        const p = this._pose = this.roshan.pose;
        for (const r of this._layers) {
            if (r.l.key) {
                const key = r.l.key(p);
                if (key !== r.key) {
                    r.key = key;
                    r.actor.queue_repaint();
                }
            }
            if (r.l.xf)
                applyXf(r.actor, r.cache, r.l.xf(p), this._k);
        }

        const alive = new Set(p.particles);
        for (const [q, actor] of this._particles) {
            if (!alive.has(q)) {
                actor.destroy();
                this._particles.delete(q);
            }
        }
        for (const q of p.particles) {
            let actor = this._particles.get(q);
            if (!actor) {
                const box = particleBox(q.kind);
                const [bx, by, bw, bh] = box;
                const k = this._k;
                actor = new St.DrawingArea({width: bw * k, height: bh * k});
                actor.set_position((bx - HERO.x0) * k, (by - HERO.y0) * k);
                actor.pivot_point = new Graphene.Point({x: -bx / bw, y: -by / bh});
                actor.connect('repaint', area => paintArea(area, box, k, cr => drawParticle(cr, q.kind)));
                actor._cache = {};
                this.add_child(actor);
                this._particles.set(q, actor);
            }
            applyXf(actor, actor._cache, particleXf(q), this._k);
        }
        this.onFrame?.();
    }

    _frame(dt) {
        this.roshan.step(dt);
        this._sync();
        return this.roshan.moving;
    }

    // The popup opened.
    play() {
        this.roshan.reduced = !animationsEnabled();
        this.roshan.intro();
        this._sync();
        this._loop.start();
    }

    pause() {
        this._loop.stop();
        this.roshan.pointer(null);
    }

    // Something happened while the popup is open (a reaction, a mood change).
    wake() {
        if (this.mapped)
            this._loop.start();
    }

    vfunc_motion_event(event) {
        const [x, y] = event.get_coords();
        const [ok, lx, ly] = this.transform_stage_point(x, y);
        if (ok)
            this.roshan.pointer([lx / this._k + HERO.x0, ly / this._k + HERO.y0]);
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_leave_event(event) {
        this.roshan.pointer(null);
        return super.vfunc_leave_event(event);
    }

    vfunc_button_press_event() {
        return Clutter.EVENT_STOP;
    }

    vfunc_button_release_event() {
        this.roshan.poke();
        this._loop.start();
        return Clutter.EVENT_STOP;
    }
});

// Roshan's head in the panel. It moves only when something changes: it pops
// in, wakes up when Dota starts, and shakes once when the aggro begins.
export const PanelGlyph = GObject.registerClass(
class PanelGlyph extends St.DrawingArea {
    _init() {
        super._init({y_align: Clutter.ActorAlign.CENTER});
        followScale(this, f => {
            this._k = f;
            this.set_size(GLYPH.w * f, GLYPH.h * f);
        });
        this._s = {
            scale: new Spring(1, 0.5, 0.55),
            roll: new Spring(0, 0.42, 0.3),
            dy: new Spring(0, 0.3, 0.45),
            dx: new Spring(0, 0.12, 0.12),
            open: new Spring(1, 0.6),
            brow: new Spring(0, 0.5),
            glow: new Spring(0, 0.8),
        };
        this._eye = new ColorSpring(MOODS[0].eye);
        this._mood = 0;
        this._awake = false;
        this._still = () => false;
        this._loop = new FrameLoop(this, dt => this._frame(dt));
        this.connect('destroy', () => this._loop.destroy());
    }

    // still(): true while nobody can see the panel (fullscreen Dota)
    set stillWhen(fn) {
        this._still = fn;
    }

    set({mood, awake}) {
        if (mood === this._mood && awake === this._awake)
            return;
        const s = this._s;
        this._eye.to(MOODS[mood].eye);
        s.open.tune(awake ? 0.35 : 2, awake ? 0.55 : 1).to(awake ? 1 : 0);
        s.brow.to(awake ? [0, 0.2, 0.6, 1][mood] : 0);
        s.glow.to(awake && mood === 3 ? 1 : awake && mood === 2 ? 0.3 : 0);
        if (awake && !this._awake) {
            s.roll.kick(-3.4);
            s.dy.kick(-40);
        }
        // aggro: one hard shake, then calm red eyes
        if (mood === 3 && this._mood !== 3)
            s.dx.kick(55);
        this._mood = mood;
        this._awake = awake;
        this._kick();
    }

    pop() {
        this._s.scale.snap(0.35);
        this._s.scale.to(1);
        this._kick();
    }

    // Off screen or behind a fullscreen game nobody is watching: land on the
    // final pose at once instead of animating.
    _kick() {
        if (!animationsEnabled() || !this.mapped || this._still()) {
            for (const sp of Object.values(this._s))
                sp.snap(sp.target);
            [this._eye.L, this._eye.C, this._eye.h].forEach(sp => sp.snap(sp.target));
            this.queue_repaint();
            return;
        }
        this._loop.start();
    }

    _frame(dt) {
        const springs = Object.values(this._s);
        springs.forEach(sp => sp.step(dt));
        this._eye.step(dt);
        this.queue_repaint();
        return !springs.every(sp => sp.resting) || !this._eye.resting;
    }

    vfunc_style_changed() {
        super.vfunc_style_changed();
        this.queue_repaint();
    }

    vfunc_repaint() {
        const s = this._s;
        const cr = this.get_context();
        cr.scale(this._k, this._k);
        const fg = this.get_theme_node().get_foreground_color();
        drawGlyph(cr, [fg.red / 255, fg.green / 255, fg.blue / 255, fg.alpha / 255], {
            open: s.open.x,
            brow: s.brow.x,
            eye: this._eye.rgb,
            glow: clamp(s.glow.x, 0, 1),
            roll: s.roll.x,
            dy: s.dy.x * 0.04,
            dx: s.dx.x * 0.04,
            scale: Math.max(s.scale.x, 0),
        });
        cr.$dispose();
    }
});

// A label whose text rolls like a counter: down when the value drops, up when
// it grows. Springs, so a new value can interrupt a roll mid-way.
export const RollingLabel = GObject.registerClass(
class RollingLabel extends St.Widget {
    _init(params = {}) {
        super._init({
            layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true,
            y_align: Clutter.ActorAlign.CENTER,
            ...params,
        });
        this._label = this._make('');
        this._in = null;
        this._out = [];
        this._loop = new FrameLoop(this, dt => this._frame(dt));
        this.connect('destroy', () => this._loop.destroy());
    }

    _make(text) {
        const label = new St.Label({text, y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.START});
        this.add_child(label);
        return label;
    }

    get text() {
        return this._label.text;
    }

    // dir: -1 the value went down, 1 it went up, 0 just replace
    set(text, dir = 0) {
        if (text === this._label.text)
            return;
        if (!dir || !this.mapped || !animationsEnabled()) {
            this._settle();
            this._label.text = text;
            return;
        }
        const h = Math.max(this.height, 12) * 0.8;
        const old = this._label;
        this._out.push({
            label: old,
            spring: new Spring(0, 0.3).to(1),
            ty0: old.translation_y,
            op0: old.opacity / 255,
            ty1: -dir * h,
        });
        this._label = this._make(text);
        this._in = {spring: new Spring(0, 0.5, 0.72).to(1), from: dir * h, wait: 0.05};
        this._frame(0);
        this._loop.start();
    }

    _frame(dt) {
        this._out = this._out.filter(o => {
            o.spring.step(dt);
            const q = clamp(o.spring.x, 0, 1);
            o.label.translation_y = o.ty0 + (o.ty1 - o.ty0) * q;
            o.label.opacity = Math.round(o.op0 * (1 - q) * 255);
            if (q < 0.98)
                return true;
            o.label.destroy();
            return false;
        });
        const r = this._in;
        if (r) {
            r.wait -= dt;
            if (r.wait < 0)
                r.spring.step(dt);
            const x = r.spring.x;
            this._label.translation_y = r.from * (1 - x);
            this._label.opacity = Math.round(clamp(x * 1.6, 0, 1) * 255);
            if (r.spring.resting)
                this._settle();
        }
        return this._out.length > 0 || this._in !== null;
    }

    _settle() {
        this._out.forEach(o => o.label.destroy());
        this._out = [];
        this._in = null;
        this._label.translation_y = 0;
        this._label.opacity = 255;
    }
});
