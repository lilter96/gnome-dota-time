// Roshan: a chibi Roshan who sits in his pit and watches how long you play.
// He sleeps while Dota is closed, hugs his Cheese while you play, starts to
// grumble after the third hour and goes into full aggro after the fourth.
//
// Drawn with Cairo and animated with springs; no Shell imports, so it also
// renders under plain gjs. Coordinates are "pit units": the backdrop disc has
// radius 100 and is centred at the origin, y grows downwards.

import Cairo from 'cairo';

import {
    BLACK, ColorSpring, Spring, TAU, WHITE, arcPath, clamp, colorKey, ellipse,
    hex, linear, mix, mirrored, pat, path, pivotOf, qz, radial, smooth, src, withXf,
} from './kit.js';

export const HERO = {scale: 0.56, x0: -128, y0: -186, w: 256, h: 306};
export const AGGRO_HOURS = 4;

// Mood follows today's hours. Colours from Apple's dark-mode system palette.
export const MOODS = [
    {min: 0, color: hex('#30d158'), eye: hex('#ffd23f')},
    {min: 2, color: hex('#ffd60a'), eye: hex('#ffbf1f')},
    {min: 3, color: hex('#ff9f0a'), eye: hex('#ff8a1c')},
    {min: AGGRO_HOURS, color: hex('#ff453a'), eye: hex('#ff2e24')},
];

export function moodFor(hours) {
    if (!(hours >= 0))
        return 0;
    let m = 0;
    MOODS.forEach((x, i) => {
        if (hours >= x.min)
            m = i;
    });
    return m;
}

const SKIN_HI = hex('#ddcdb6');
const SKIN = hex('#b9a38b');
const SKIN_SH = hex('#8e7a66');
const SKIN_DEEP = hex('#665449');
const BELLY = hex('#efe0c4');
const BELLY_SH = hex('#cfba99');
const STONE = hex('#7d6d64');
const STONE_HI = hex('#b3a396');
const STONE_SH = hex('#53463f');
const HORN_BASE = hex('#4a3d36');
const HORN_MID = hex('#8c7a69');
const HORN_TIP = hex('#f3eadb');
const TUSK = hex('#fff7e6');
const TUSK_SH = hex('#d8c4a2');
const LINE = hex('#3b2d26');
const SOCKET = hex('#2b201c');
const MOUTH = hex('#4b1d22');
const TONGUE = hex('#cf6670');
const CHEESE = hex('#ffd34d');
const CHEESE_HI = hex('#ffe995');
const CHEESE_SH = hex('#e9a92c');
const CHEESE_HOLE = hex('#d38f25');
const COIN = hex('#ffcf3a');
const COIN_SH = hex('#d9921c');
const EMBER = hex('#ff5a2a');
const SWEAT = hex('#8fd5ff');
const AGGRO = hex('#ff3b30');

// --- shapes (pit units) ----------------------------------------------------------

const BODY = 'M -36 8 C -56 16 -66 38 -64 60 C -63 76 -52 86 0 86 C 52 86 63 76 64 60 C 66 38 56 16 36 8 Z';
const BELLY_PATH = 'M -27 34 C -31 52 -29 70 -21 81 C -10 85 10 85 21 81 C 29 70 31 52 27 34 C 15 28 -15 28 -27 34 Z';
const SKULL = 'M 0 -64 C 36 -64 57 -46 58 -20 C 59 0 52 14 38 20 C 24 26 -24 26 -38 20 C -52 14 -59 0 -58 -20 C -57 -46 -36 -64 0 -64 Z';
const HORN = 'M -47 -37 C -67 -41 -83 -55 -85 -75 C -86 -90 -80 -101 -70 -109 C -72 -97 -71 -87 -66 -79 C -60 -70 -45 -65 -28 -62 Z';
const HORN_PIVOT = [-38, -52];
const BROW = 'M -47 -30 C -42 -39 -26 -42 -9 -35 C -6 -33 -5 -29 -8 -26 C -22 -29 -34 -27 -44 -23 C -48 -22 -49 -26 -47 -30 Z';
const BROW_PIVOT = [-27, -31];
const MUZZLE = 'M -31 3 C -31 -8 -17 -11 0 -8 C 17 -11 31 -8 31 3 C 31 14 18 20 0 20 C -18 20 -31 14 -31 3 Z';
const NOSE = 'M -13 -4 C -13 -10 13 -10 13 -4 C 13 2 7 5 0 5 C -7 5 -13 2 -13 -4 Z';
const JAW = 'M -33 11 C -34 26 -19 33 0 33 C 19 33 34 26 33 11 C 22 16 -22 16 -33 11 Z';
const CAVITY = 'M -24 8 C -16 4 16 4 24 8 C 24 20 14 27 0 27 C -14 27 -24 20 -24 8 Z';
const TUSK_PATH = 'M -24 20 C -27 14 -28 8 -26 1 C -22 5 -19 11 -18 19 Z';
const ARM = 'M -60 12 C -74 22 -78 42 -73 58 L -41 60 C -43 46 -43 32 -38 20 Z';
const ARM_PIVOT = [-50, 20];
const FIST = [-56, 64, 15];
const PAD = 'M -73 33 C -78 15 -66 2 -49 4 C -38 6 -33 14 -35 23 C -46 23 -60 27 -73 33 Z';
const FOOT = [-28, 82, 18, 8];
const CHEESE_AT = [0, 58];
const NOSTRILS = [[-5.5, -1], [5.5, -1]];
const EYES = [[-20, -15], [20, -15]];
const RING_R = 112;
const RING_W = 11;
const RUNE_Y = -154;
const GROUND = 84;

const ZED = 'M -4 -4 L 4 -4 L -4 4 L 4 4';
const DROP = 'M 0 -6 C 2.5 -2 4 0.5 4 2.6 C 4 5 2.2 6.6 0 6.6 C -2.2 6.6 -4 5 -4 2.6 C -4 0.5 -2.5 -2 0 -6 Z';
const HEART = 'M 0 6 C -10 -1 -8 -9 -2.8 -8 C -1.2 -7.7 -0.4 -6.6 0 -5.5 C 0.4 -6.6 1.2 -7.7 2.8 -8 C 8 -9 10 -1 0 6 Z';

// Blink: lids drop in 70 ms, rise in 120 ms.
function blinkCurve(t) {
    if (t < 0 || t > 0.19)
        return 1;
    return t < 0.07 ? 1 - smooth(0, 0.07, t) : smooth(0.07, 0.19, t);
}

// --- behaviour -------------------------------------------------------------------

const SLAM = {windup: 0.42, strike: 0.11, hold: 0.5};
const RAISED = 2.55;   // arm angle with the fists up beside the head
const HUG = -0.78;     // arms crossed in front, holding the Cheese
const NIBBLE = -1.0;

export class Roshan {
    constructor({random = Math.random, reducedMotion = false} = {}) {
        this.rand = random;
        this.reduced = reducedMotion;
        this.t = 0;
        this.state = {hours: 0, awake: false, inMatch: false};
        this.mood = 0;
        this.particles = [];
        this.next = {blink: 1.1, glance: 0.7, nibble: 4, steam: 2, slam: 2.2, z: 0.4, ember: 0, twitch: 5};
        this.blinkAt = -1;
        this.blinkTwice = false;
        this.look = [0, 0];
        this.pointerAt = null;
        this.wokeAt = -10;
        this.wakeUntil = 0;
        this.nibbleAt = -10;
        this.slamAt = -10;
        this.impacted = true;
        this.reaction = null;   // {kind: 'win' | 'loss' | 'poke', at}
        this.breathPhase = 0;
        this.spin = 0.4;
        this._blink = 1;

        const S = (x, r, d) => new Spring(x, r, d);
        this.color = new ColorSpring(MOODS[0].color);
        this.eye = new ColorSpring(MOODS[0].eye, 0.7);
        this.s = {
            ring: S(0, 1.1, 0.92), flare: S(0, 0.5),
            runeY: S(0, 0.55, 0.45), runeA: S(1, 0.3), runeK: S(1, 0.35, 0.35),
            roll: S(0, 0.45, 0.32), dip: S(0, 0.3, 0.42), sag: S(0, 1.6),
            open: S(1, 0.22), happy: S(0, 0.25), lookX: S(0, 0.22, 0.85), lookY: S(0, 0.22, 0.85),
            brow: S(0, 0.35, 0.6), browY: S(0, 0.3, 0.6), smile: S(0, 0.4),
            jaw: S(0, 0.22, 0.55), armL: S(HUG, 0.5, 0.6), armR: S(-HUG, 0.5, 0.6),
            cheese: S(1, 0.4, 0.7), cheeseY: S(0, 0.35, 0.6),
            hornL: S(0, 0.5, 0.4), hornR: S(0, 0.5, 0.4),
            glow: S(0, 0.8), tremble: S(0, 0.6), breathAmp: S(1, 1.5),
            shakeX: S(0, 0.16, 0.18), shakeY: S(0, 0.14, 0.2), bodyDy: S(0, 0.28, 0.4),
        };
    }

    get sleeping() {
        return !this.state.awake && this.t >= this.wakeUntil;
    }

    get aggro() {
        return this.mood === 3 && !this.sleeping;
    }

    // state: {hours, awake, inMatch}
    update(state) {
        const wasSleeping = this.sleeping;
        const oldMood = this.mood;
        Object.assign(this.state, state);
        this.mood = moodFor(this.state.hours);
        // the first mood is where we start, not a change to animate
        if (!this._colored) {
            this._colored = true;
            this.color.to(MOODS[this.mood].color, true);
            this.eye.to(MOODS[this.mood].eye, true);
            this.s.ring.snap(this.ringGoal);
        }
        if (this.mood === 3 && oldMood !== 3) {
            this.s.runeK.kick(4);
            this.next.slam = this.t + 0.6;
        }
        if (wasSleeping && !this.sleeping)
            this._wake();
    }

    get ringGoal() {
        return Math.max(this.state.hours, 0) / AGGRO_HOURS;
    }

    _wake() {
        this.wokeAt = this.t;
        this.s.hornL.kick(-3);
        this.s.hornR.kick(3);
        this.s.bodyDy.kick(-60);
        this.next.blink = this.t + 1.3;
        this._emit('bang', 0, -86, 0, -10, 1.1);
    }

    // A match ended: 'win' or 'loss'.
    react(kind) {
        if (kind !== 'win' && kind !== 'loss')
            return;
        this.reaction = {kind, at: this.t};
        if (this.sleeping)
            this.wakeUntil = this.t + 4;
        if (kind === 'win') {
            this.s.bodyDy.kick(-90);
            for (let i = 0; i < 9; i++) {
                const a = -Math.PI / 2 + (this.rand() - 0.5) * 2.2;
                const v = 70 + this.rand() * 50;
                this._emit('coin', (this.rand() - 0.5) * 30, -70, Math.cos(a) * v, Math.sin(a) * v, 1.7);
            }
        } else {
            this._emit('drop', 46, -40, 0, 10, 1.8);
            this._puff(0.6);
        }
    }

    // Popup opened: the ring sweeps in, the rune drops into place.
    intro() {
        const s = this.s;
        this.particles = [];
        if (this.reduced) {
            this.settle();
            return;
        }
        s.ring.from(0);
        s.runeY.from(-26);
        s.runeA.from(0);
        if (!this.sleeping) {
            s.hornL.kick(-2.2);
            s.hornR.kick(2.2);
            this.blinkAt = this.t + 0.32;
        }
        if (this.aggro)
            this.next.slam = this.t + 1.1;
    }

    // Jump straight to the resting pose (reduced motion, first frame).
    settle() {
        this.step(0);
        for (const sp of Object.values(this.s))
            sp.snap(sp.target);
        for (const c of [this.color, this.eye])
            [c.L, c.C, c.h].forEach(sp => sp.snap(sp.target));
        this.particles = [];
    }

    // Pointer position in pit units, or null when it leaves.
    pointer(p) {
        if (p && !this.pointerAt && this.sleeping)
            this.s.hornR.kick(2.4);
        this.pointerAt = p;
    }

    // A click on Roshan.
    poke() {
        if (this.sleeping) {
            this.wakeUntil = this.t + 4;
            this._wake();
            return;
        }
        if (this.aggro) {
            this.next.slam = this.t;
            return;
        }
        this.reaction = {kind: 'poke', at: this.t};
        this.s.roll.kick(this.rand() < 0.5 ? -1.6 : 1.6);
        this._puff(1);
        if (this.mood < 2)
            this._emit('heart', 0, -78, 0, -40, 1.3);
    }

    _emit(kind, x, y, vx, vy, life) {
        this.particles.push({kind, x, y, vx, vy, life, age: 0, seed: this.rand() * TAU});
    }

    _puff(strength) {
        for (const [nx, ny] of NOSTRILS) {
            const side = Math.sign(nx);
            this._emit('steam', nx + side * 4, ny + 4, side * (16 + this.rand() * 10) * strength,
                (6 + this.rand() * 8), 1.1 + 0.4 * strength);
        }
    }

    _impact() {
        const s = this.s;
        s.shakeY.kick(130);
        s.shakeX.kick((this.rand() < 0.5 ? -1 : 1) * 70);
        s.bodyDy.kick(70);
        s.flare.from(1);
        this._emit('shock', 0, GROUND, 0, 0, 0.75);
        this._emit('shock', 0, GROUND, 0, 0, 1.05);
        for (let i = 0; i < 8; i++) {
            const side = i % 2 ? 1 : -1;
            this._emit('dust', side * (34 + this.rand() * 22), GROUND - 2,
                side * (30 + this.rand() * 40), -18 - this.rand() * 26, 0.8 + this.rand() * 0.4);
        }
        this._puff(1.3);
    }

    step(dt) {
        dt = Math.min(dt, 0.05);
        const t = this.t += dt;
        const R = this.rand, s = this.s, st = this.state;
        const sleeping = this.sleeping;
        const lively = !this.reduced;
        const mood = this.mood;
        const aggro = mood === 3 && !sleeping;
        const re = this.reaction && t - this.reaction.at < (this.reaction.kind === 'poke' ? 0.7 : 3.2)
            ? this.reaction : null;
        const win = re?.kind === 'win', loss = re?.kind === 'loss', poked = re?.kind === 'poke';

        this.color.to(MOODS[mood].color);
        this.eye.to(MOODS[mood].eye);
        s.ring.to(this.ringGoal);
        s.flare.to(0);
        s.runeY.to(0);
        s.runeA.to(1);
        s.runeK.to(1);

        // Aggro: slam the ground every few seconds.
        const sinceSlam = t - this.slamAt;
        const slamming = sinceSlam < SLAM.windup + SLAM.strike + SLAM.hold;
        if (aggro && lively && !slamming && !re && t >= this.next.slam) {
            this.slamAt = t;
            this.impacted = false;
            this.next.slam = t + 5.5 + R() * 3.5;
        }
        const windup = slamming && sinceSlam < SLAM.windup;
        const strike = slamming && !windup && sinceSlam < SLAM.windup + SLAM.strike;
        if (slamming && !this.impacted && sinceSlam >= SLAM.windup + SLAM.strike * 0.8) {
            this.impacted = true;
            this._impact();
        }

        // Cheese: hugged while calm, a nibble now and then.
        const holding = !sleeping && mood < 2 && !win && !loss;
        if (holding && lively && t >= this.next.nibble && !re) {
            this.nibbleAt = t;
            this.next.nibble = t + 7 + R() * 7;
        }
        const nib = t - this.nibbleAt;
        const nibbling = holding && nib < 1.3;
        if (nibbling) {
            for (const at of [0.42, 0.85]) {
                if (nib - dt < at && nib >= at)
                    this._emit('crumb', (R() - 0.5) * 16, 30, (R() - 0.5) * 40, 10, 0.9);
            }
        }

        // Arms.
        let armL = holding ? HUG : 0;
        if (nibbling)
            armL = NIBBLE;
        if (win)
            armL = 2.75 + 0.18 * Math.sin((t - re.at) * 14);
        if (loss)
            armL = 0.12;
        if (windup)
            armL = RAISED;
        else if (strike)
            armL = -0.32;
        const stiff = strike ? [0.09, 0.5] : windup ? [0.32, 0.7] : [0.5, 0.6];
        s.armL.tune(...stiff).to(armL);
        s.armR.tune(...stiff).to(-armL);

        s.cheese.to(holding ? 1 : 0);
        s.cheeseY.to(nibbling ? -24 - 3 * Math.sin(nib * 20) : 0);

        // Eyes: blinks, happy squints, sleep, aggro glow.
        let blink = 1;
        if (!sleeping && lively && !slamming) {
            if (t >= this.next.blink) {
                this.blinkAt = t;
                this.blinkTwice = R() < 0.18;
                this.next.blink = t + (aggro ? 4 : 2.2) + R() * 4.5;
            }
            blink = blinkCurve(t - this.blinkAt);
            if (this.blinkTwice)
                blink = Math.min(blink, blinkCurve(t - this.blinkAt - 0.26));
        }
        const happy = win || (nibbling && nib > 0.3) || (poked && mood < 2);
        const awakeOpen = [0.9, 0.8, 0.62, 1][mood];
        if (sleeping)
            s.open.tune(2.2);
        else if (t - this.wokeAt < 0.9)
            s.open.tune(0.3, 0.38);
        else
            s.open.tune(0.22);
        s.open.to(sleeping || happy ? 0 : loss ? 0.5 : awakeOpen);
        s.happy.to(happy ? 1 : 0);
        s.glow.to(aggro ? (lively ? 0.75 + 0.25 * Math.sin(t * 5.2) : 1) : mood === 2 && !sleeping ? 0.18 : 0);

        // Brows: -1 sad, 0 calm, 1 furious.
        let brow = sleeping ? -0.1 : [0, 0.15, 0.55, 1][mood];
        if (win)
            brow = -0.35;
        if (loss)
            brow = -0.9;
        if (poked)
            brow = Math.max(brow, 0.7);
        s.brow.to(brow);
        s.browY.to(aggro ? 3 : loss ? -2 : 0);
        s.smile.to(win || happy ? 1 : loss ? -1 : mood >= 2 && !sleeping ? -0.5 : 0);

        // Jaw: chomps on the Cheese, roars on the slam, cheers on a win.
        let jaw = 0;
        if (nibbling)
            jaw = Math.max(0, Math.sin(nib * 2 * TAU / 1.3 * 1.1)) * 0.55;
        if (windup || (slamming && sinceSlam < SLAM.windup + SLAM.strike + 0.35))
            jaw = 1;
        if (win)
            jaw = 0.65;
        if (poked)
            jaw = 0.5;
        s.jaw.to(jaw);

        // Gaze: follow the pointer, otherwise glance around now and then.
        if (sleeping || loss) {
            this.look = [0, loss ? 0.9 : 0.3];
        } else if (nibbling) {
            this.look = [0, 1];
        } else if (this.pointerAt) {
            const [px, py] = this.pointerAt;
            this.look = [clamp(px / 70, -1, 1), clamp((py + 14) / 60, -1, 1)];
        } else if (lively && t >= this.next.glance) {
            this.look = R() < 0.35 ? [0, 0] : [R() * 2 - 1, (R() * 2 - 1) * 0.6];
            this.next.glance = t + 1.8 + R() * 4;
        }
        s.lookX.to(this.look[0]);
        s.lookY.to(this.look[1]);

        // Horns droop in sleep, flare up in aggro; one twitches now and then.
        const horn = sleeping ? 0.12 : aggro ? -0.1 : loss ? 0.1 : 0;
        s.hornL.to(horn);
        s.hornR.to(-horn);
        if (!sleeping && lively && t >= this.next.twitch) {
            if (R() < 0.5)
                s.hornL.kick(-2);
            else
                s.hornR.kick(2);
            this.next.twitch = t + 6 + R() * 9;
        }

        // Head.
        s.roll.to((sleeping ? 0.08 : 0) + s.lookX.x * 0.045);
        s.dip.to(windup ? -7 : nibbling ? 7 : 0);
        s.sag.to(sleeping ? 1 : loss ? 0.8 : 0);
        s.bodyDy.to(0);
        s.shakeX.to(0);
        s.shakeY.to(0);
        s.tremble.to(aggro && lively ? 1 : 0);

        // Grumbling: steam from the nostrils; embers in aggro.
        if (!sleeping && lively && mood >= 2 && t >= this.next.steam && !nibbling) {
            this._puff(aggro ? 1.2 : 0.75);
            this.next.steam = t + (aggro ? 1.6 + R() * 1.4 : 3 + R() * 3);
        }
        if (aggro && lively && t >= this.next.ember) {
            const x = (R() - 0.5) * 120;
            this._emit('ember', x, GROUND - R() * 30, (R() - 0.5) * 12, -26 - R() * 22, 1.6 + R());
            this.next.ember = t + 0.22 + R() * 0.3;
        }
        if (sleeping && lively && t >= this.next.z) {
            this._emit('z', 40, -62, 14, -24, 2.8);
            this.next.z = t + 1.8;
        }

        s.breathAmp.to(lively ? 1 : 0);
        this.breathPhase += dt * TAU / (sleeping ? 4.8 : aggro ? 1.6 : 3.4);
        if (lively)
            this.spin += dt * TAU / (aggro ? 1.6 : 4.8);

        for (const sp of Object.values(s))
            sp.step(dt);
        this.color.step(dt);
        this.eye.step(dt);

        for (const p of this.particles) {
            p.age += dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.kind === 'coin' || p.kind === 'crumb' || p.kind === 'dust')
                p.vy += (p.kind === 'dust' ? 40 : 160) * dt;
        }
        this.particles = this.particles.filter(p => p.age < p.life);
        this._blink = blink;
    }

    // True while something is still moving; with reduced motion the loop can stop.
    get moving() {
        return !this.reduced || this.particles.length > 0 ||
            Object.values(this.s).some(sp => !sp.resting) ||
            !this.color.resting || !this.eye.resting;
    }

    // The ring value to print next to the drawing, follows the sweep.
    get shownHours() {
        return this.s.ring.x * AGGRO_HOURS;
    }

    get pose() {
        const s = this.s, t = this.t;
        const breath = 1 + 0.016 * s.breathAmp.x * Math.sin(this.breathPhase);
        const tr = s.tremble.x;
        return {
            t,
            color: this.color.rgb,
            eye: this.eye.rgb,
            ring: Math.max(s.ring.x, 0),
            flare: clamp(s.flare.x, 0, 1),
            glow: clamp(s.glow.x, 0, 1),
            rune: {
                y: s.runeY.x + 2.6 * s.breathAmp.x * Math.sin(t * TAU / 2.6),
                alpha: clamp(s.runeA.x, 0, 1),
                scale: s.runeK.x,
                spin: this.spin,
            },
            rig: {
                tx: s.shakeX.x + tr * 0.9 * Math.sin(t * 53) * Math.sin(t * 7.3),
                ty: s.shakeY.x * 0.6 + s.bodyDy.x * 0.08,
            },
            breath,
            head: {roll: s.roll.x, dip: s.dip.x, sag: s.sag.x},
            hornL: s.hornL.x,
            hornR: s.hornR.x,
            brow: s.brow.x,
            browY: s.browY.x,
            smile: clamp(s.smile.x, -1, 1),
            jaw: clamp(s.jaw.x, 0, 1.2),
            armL: s.armL.x,
            armR: s.armR.x,
            cheese: {alpha: clamp(s.cheese.x, 0, 1), y: s.cheeseY.x},
            eyes: {
                open: Math.max(s.open.x, 0) * this._blink,
                happy: clamp(s.happy.x, 0, 1),
                lookX: s.lookX.x,
                lookY: s.lookY.x,
            },
            particles: this.particles,
        };
    }
}

// --- scene -----------------------------------------------------------------------

const headDy = p => p.head.dip + p.head.sag * 6 - (p.breath - 1) * 70;

export const SCENE = [
    {id: 'disc', box: [-104, -104, 208, 208], key: p => colorKey(p.color), draw: drawDisc},
    {id: 'aura', box: [-104, -104, 208, 208], draw: drawAura, xf: p => ({alpha: p.glow * 0.9})},
    {id: 'ring', box: [-120, -120, 240, 240], draw: drawRing,
        key: p => `${qz(p.ring, 0.004)}|${qz(p.flare, 0.05)}|${colorKey(p.color)}`},
    {id: 'rune', box: [-40, -200, 80, 88], pivot: [0, RUNE_Y],
        key: p => `${qz(p.rune.spin % TAU, 0.02)}|${colorKey(p.color)}`,
        draw: (cr, p) => drawRune(cr, 0, RUNE_Y, 11, p.rune.spin, p.color),
        xf: p => ({ty: p.rune.y, s: p.rune.scale, alpha: p.rune.alpha})},
    {id: 'rig', box: [-96, -120, 192, 216], pivot: [0, GROUND],
        xf: p => ({tx: p.rig.tx, ty: p.rig.ty}),
        children: [
            {id: 'shadow', box: [-72, 72, 144, 24], draw: drawShadow},
            {id: 'body', box: [-72, 0, 144, 96], pivot: [0, GROUND],
                draw: drawBody, xf: p => ({sx: 1 + (p.breath - 1) * 0.5, sy: p.breath})},
            {id: 'armL', box: [-96, 0, 64, 88], pivot: ARM_PIVOT, draw: cr => drawArm(cr, -1),
                xf: p => ({rot: p.armL})},
            {id: 'armR', box: [32, 0, 64, 88], pivot: [-ARM_PIVOT[0], ARM_PIVOT[1]],
                draw: cr => drawArm(cr, 1), xf: p => ({rot: p.armR})},
            {id: 'padL', box: [-80, 0, 48, 40], draw: cr => drawPad(cr, -1)},
            {id: 'padR', box: [32, 0, 48, 40], draw: cr => drawPad(cr, 1)},
            {id: 'head', box: [-80, -120, 160, 160], pivot: [0, 22],
                xf: p => ({ty: headDy(p), rot: p.head.roll,
                    sx: 1 + p.head.dip * 0.003, sy: 1 - p.head.dip * 0.005}),
                children: [
                    {id: 'hornL', box: [-80, -112, 56, 80], pivot: HORN_PIVOT,
                        draw: cr => drawHorn(cr, -1), xf: p => ({rot: p.hornL})},
                    {id: 'hornR', box: [24, -112, 56, 80], pivot: [-HORN_PIVOT[0], HORN_PIVOT[1]],
                        draw: cr => drawHorn(cr, 1), xf: p => ({rot: p.hornR})},
                    {id: 'skull', box: [-64, -72, 128, 104], draw: drawSkull},
                    {id: 'jaw', box: [-40, 0, 80, 40], pivot: [0, 10],
                        draw: drawJaw, xf: p => ({ty: p.jaw * 9, rot: 0})},
                    {id: 'muzzle', box: [-32, -16, 64, 40], draw: drawMuzzle,
                        key: p => qz(p.smile, 0.05)},
                    {id: 'tusks', box: [-32, -8, 64, 40], draw: drawTusks,
                        xf: p => ({ty: p.jaw * 9})},
                    {id: 'eyes', box: [-32, -32, 64, 32], draw: drawEyes,
                        key: p => `${qz(p.eyes.open, 0.01)}|${qz(p.eyes.happy, 0.02)}|${colorKey(p.eye)}|` +
                            `${qz(p.eyes.lookX, 0.04)}|${qz(p.eyes.lookY, 0.04)}`},
                    {id: 'browL', box: [-56, -48, 56, 32], pivot: BROW_PIVOT, draw: cr => drawBrow(cr, -1),
                        xf: p => ({rot: p.brow * 0.32, ty: p.browY + Math.max(p.brow, 0) * 2.2 - Math.max(-p.brow, 0) * 3})},
                    {id: 'browR', box: [0, -48, 56, 32], pivot: [-BROW_PIVOT[0], BROW_PIVOT[1]],
                        draw: cr => drawBrow(cr, 1),
                        xf: p => ({rot: -p.brow * 0.32, ty: p.browY + Math.max(p.brow, 0) * 2.2 - Math.max(-p.brow, 0) * 3})},
                    {id: 'glare', box: [-48, -40, 96, 48], draw: drawGlare,
                        xf: p => ({alpha: p.glow * clamp(p.eyes.open * 1.6, 0, 1)})},
                ]},
            {id: 'cheese', box: [-24, 40, 48, 40], draw: drawCheese,
                xf: p => ({ty: p.cheese.y, alpha: p.cheese.alpha, s: 0.6 + 0.4 * p.cheese.alpha})},
        ]},
];

export const PARTICLE_BOX = {
    shock: [-128, -24, 256, 48],
    default: [-16, -16, 32, 32],
};
export const particleBox = kind => PARTICLE_BOX[kind] ?? PARTICLE_BOX.default;

export function particleXf(q) {
    const k = q.age / q.life;
    const a = smooth(0, 0.12, k) * (1 - smooth(0.6, 1, k));
    switch (q.kind) {
    case 'z':
        return {tx: q.x + 4 * Math.sin(q.seed + q.age * 1.6), ty: q.y, s: 0.6 + 0.6 * k, alpha: 0.7 * a};
    case 'steam':
        return {tx: q.x, ty: q.y, s: 0.45 + 1.2 * smooth(0, 1, k), alpha: 0.55 * (1 - smooth(0.2, 1, k))};
    case 'shock':
        return {tx: q.x, ty: q.y, s: 0.25 + 0.95 * Math.sqrt(k), alpha: 1 - smooth(0.3, 1, k)};
    case 'dust':
        return {tx: q.x, ty: q.y, s: 0.5 + 0.9 * k, alpha: 0.6 * (1 - smooth(0.4, 1, k))};
    case 'ember':
        return {tx: q.x + 6 * Math.sin(q.seed + q.age * 3), ty: q.y, s: 0.5 * (1 - 0.5 * k), alpha: a};
    case 'coin':
        return {tx: q.x, ty: q.y, rot: q.age * 6 + q.seed, sx: Math.cos(q.age * 9 + q.seed), sy: 1,
            alpha: 1 - smooth(0.7, 1, k)};
    case 'crumb':
        return {tx: q.x, ty: q.y, rot: q.seed + q.age * 5, s: 0.5, alpha: 1 - smooth(0.6, 1, k)};
    case 'bang':
        return {tx: q.x, ty: q.y, s: 0.4 + 0.9 * smooth(0, 0.18, q.age) - 0.1 * smooth(0.18, 0.4, q.age),
            alpha: 1 - smooth(0.75, 1, k)};
    case 'drop':
        return {tx: q.x, ty: q.y + 6 * smooth(0, 1, k), s: 0.9, alpha: a};
    default:
        return {tx: q.x + 3 * Math.sin(q.seed + q.age * 5), ty: q.y,
            s: 0.6 + 0.9 * smooth(0, 0.25, k), alpha: a};
    }
}

export function drawParticle(cr, kind) {
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    switch (kind) {
    case 'z':
        cr.setLineWidth(2.2);
        src(cr, WHITE);
        path(cr, ZED);
        cr.stroke();
        break;
    case 'steam':
        cr.setSource(radial(0, 0, 0, 0, 0, 9, [[0, WHITE, 0.9], [0.55, WHITE, 0.5], [1, WHITE, 0]]));
        cr.newPath();
        ellipse(cr, -2.5, 1, 6.5, 5.5);
        ellipse(cr, 3.5, -1.5, 6, 5.5);
        ellipse(cr, 1, 3, 5, 4);
        cr.fill();
        break;
    case 'shock':
        cr.setLineWidth(3.2);
        cr.newPath();
        ellipse(cr, 0, 0, 118, 16);
        src(cr, mix(AGGRO, WHITE, 0.35), 0.9);
        cr.stroke();
        break;
    case 'dust':
        cr.setSource(radial(0, 0, 0, 0, 0, 9, [[0, SKIN_SH, 0.8], [1, SKIN_SH, 0]]));
        cr.newPath();
        ellipse(cr, 0, 0, 9);
        cr.fill();
        break;
    case 'ember':
        cr.setSource(radial(0, 0, 0, 0, 0, 10, [[0, hex('#fff1c2')], [0.25, EMBER, 0.9], [1, EMBER, 0]]));
        cr.newPath();
        ellipse(cr, 0, 0, 10);
        cr.fill();
        break;
    case 'coin':
        cr.newPath();
        ellipse(cr, 0, 0, 6.5);
        cr.setSource(radial(-2, -2.5, 0.5, 0, 0, 7, [[0, hex('#fff3b0')], [0.5, COIN], [1, COIN_SH]]));
        cr.fill();
        src(cr, COIN_SH);
        cr.setLineWidth(1.1);
        ellipse(cr, 0, 0, 4.2);
        cr.stroke();
        break;
    case 'crumb':
        src(cr, CHEESE);
        cr.newPath();
        cr.moveTo(-4, 3);
        cr.lineTo(4, 2.4);
        cr.lineTo(0, -4);
        cr.closePath();
        cr.fill();
        break;
    case 'bang':
        drawBang(cr);
        break;
    case 'drop':
        path(cr, DROP);
        src(cr, SWEAT);
        cr.fill();
        break;
    default:
        path(cr, HEART);
        src(cr, hex('#ff5f7e'));
        cr.fill();
    }
}

function drawBang(cr) {
    cr.newPath();
    cr.moveTo(-3.8, -12);
    cr.lineTo(3.8, -12);
    cr.lineTo(2, 4);
    cr.lineTo(-2, 4);
    cr.closePath();
    ellipse(cr, 0, 9.5, 2.8);
    src(cr, hex('#ffd60a'));
    cr.fillPreserve();
    src(cr, LINE, 0.6);
    cr.setLineWidth(1);
    cr.stroke();
}

// Cairo compositor for the scene; cr must be in pit units.
export function compose(cr, p, layers = SCENE) {
    for (const l of layers) {
        withXf(cr, pivotOf(l), l.xf?.(p) ?? {}, () => {
            l.draw?.(cr, p);
            if (l.children)
                compose(cr, p, l.children);
        });
    }
    if (layers === SCENE) {
        for (const q of p.particles)
            withXf(cr, null, particleXf(q), () => drawParticle(cr, q.kind));
    }
}

// --- layer drawings (absolute pit units) -------------------------------------------

function drawDisc(cr, p) {
    cr.newPath();
    ellipse(cr, 0, 0, 100);
    cr.setSource(pat('disc', () => radial(-18, -46, 0, 0, 0, 100,
        [[0, WHITE, 0.12], [0.7, WHITE, 0.055], [1, WHITE, 0.03]])));
    cr.fillPreserve();
    src(cr, p.color, 0.07);
    cr.fillPreserve();
    // the pit floor: a darker band at the bottom of the disc
    cr.save();
    cr.clip();
    cr.setSource(pat('floor', () => linear(0, 40, 0, 100, [[0, BLACK, 0], [1, BLACK, 0.32]])));
    cr.paint();
    cr.restore();
}

function drawAura(cr) {
    cr.newPath();
    ellipse(cr, 0, 0, 100);
    cr.setSource(pat('aura', () => radial(0, 30, 10, 0, 10, 100,
        [[0, AGGRO, 0.55], [0.55, AGGRO, 0.22], [1, AGGRO, 0.05]])));
    cr.fill();
}

// Today's time against the 4-hour quota. Past four hours the ring keeps
// going like an Apple Watch ring: a second lap with a shadow at its head.
function drawRing(cr, p) {
    const c = p.color;
    const a0 = -Math.PI / 2;
    const v = p.ring;
    cr.setLineWidth(RING_W);
    cr.setLineCap(Cairo.LineCap.ROUND);
    src(cr, c, 0.17);
    cr.newPath();
    cr.arc(0, 0, RING_R, 0, TAU);
    cr.stroke();
    if (v <= 0.002)
        return;

    const bright = mix(c, WHITE, 0.25 + 0.35 * p.flare);
    const deep = mix(c, BLACK, 0.18);
    if (v <= 1) {
        cr.setSource(conicLike(a0, a0 + v * TAU, deep, bright));
        cr.newPath();
        cr.arc(0, 0, RING_R, a0, a0 + v * TAU);
        cr.stroke();
    } else {
        // full lap underneath, then the overflow with a shadowed head
        src(cr, deep);
        cr.newPath();
        cr.arc(0, 0, RING_R, 0, TAU);
        cr.stroke();
        const end = a0 + v * TAU;
        const start = end - Math.min(v - 1, 1) * TAU;
        // a soft shadow ahead of the head
        const hx = RING_R * Math.cos(end), hy = RING_R * Math.sin(end);
        const nx = Math.cos(end + Math.PI / 2), ny = Math.sin(end + Math.PI / 2);
        cr.setSource(radial(hx + nx * 2, hy + ny * 2, 0, hx + nx * 2, hy + ny * 2, RING_W * 1.25,
            [[0, BLACK, 0.55], [1, BLACK, 0]]));
        cr.newPath();
        ellipse(cr, hx + nx * 2, hy + ny * 2, RING_W * 1.25);
        cr.fill();
        cr.setSource(conicLike(start, end, mix(c, BLACK, 0.05), bright));
        cr.newPath();
        cr.arc(0, 0, RING_R, start, end);
        cr.stroke();
    }
    // a little sheen at the head
    const end = a0 + v * TAU;
    cr.newPath();
    ellipse(cr, RING_R * Math.cos(end), RING_R * Math.sin(end), RING_W * 0.28);
    src(cr, WHITE, 0.35 + 0.4 * p.flare);
    cr.fill();
}

// Cairo has no conic gradient: a linear gradient along the chord from the
// tail to the head of the arc reads as one.
function conicLike(a0, a1, c0, c1) {
    const span = a1 - a0;
    if (span > Math.PI * 1.2) {
        const mid = a0 + span * 0.5;
        return linear(RING_R * Math.cos(mid), RING_R * Math.sin(mid),
            RING_R * Math.cos(a1), RING_R * Math.sin(a1), [[0, c0], [1, c1]]);
    }
    return linear(RING_R * Math.cos(a0), RING_R * Math.sin(a0),
        RING_R * Math.cos(a1), RING_R * Math.sin(a1), [[0, c0], [1, c1]]);
}

// A Dota power rune: a glowing orb with a swirl, in the mood colour.
export function drawRune(cr, x, y, r, spin, color, alpha = 1, glow = true) {
    cr.save();
    cr.translate(x, y);
    if (glow) {
        cr.setSource(radial(0, 0, 0, 0, 0, r * 2.8,
            [[0, color, 0.5 * alpha], [0.4, color, 0.16 * alpha], [1, color, 0]]));
        cr.rectangle(-r * 3, -r * 3, r * 6, r * 6);
        cr.fill();
    }
    const light = mix(color, WHITE, 0.6);
    const dark = mix(color, BLACK, 0.45);
    cr.newPath();
    ellipse(cr, 0, 0, r);
    cr.setSource(radial(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r, [[0, light, alpha], [0.55, color, alpha], [1, dark, alpha]]));
    cr.fill();
    // the swirl: two arcs that turn with the spin
    cr.save();
    cr.rotate(spin);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(r * 0.17);
    src(cr, WHITE, 0.85 * alpha);
    cr.newPath();
    cr.arc(0, 0, r * 0.55, 0.2, 2.2);
    cr.stroke();
    cr.newPath();
    cr.arc(0, 0, r * 0.55, Math.PI + 0.2, Math.PI + 2.2);
    cr.stroke();
    src(cr, WHITE, 0.95 * alpha);
    cr.newPath();
    ellipse(cr, 0, 0, r * 0.16);
    cr.fill();
    cr.restore();
    // glass highlight
    cr.newPath();
    ellipse(cr, -r * 0.38, -r * 0.48, r * 0.3, r * 0.18);
    src(cr, WHITE, 0.55 * alpha);
    cr.fill();
    cr.restore();
}

function drawShadow(cr) {
    cr.save();
    cr.translate(0, GROUND);
    cr.scale(1, 8 / 64);
    cr.newPath();
    ellipse(cr, 0, 0, 64);
    cr.setSource(pat('shadow', () => radial(0, 0, 0, 0, 0, 64, [[0, BLACK, 0.5], [0.6, BLACK, 0.25], [1, BLACK, 0]])));
    cr.fill();
    cr.restore();
}

function drawBody(cr) {
    path(cr, BODY);
    cr.setSource(pat('body', () => radial(-16, 22, 6, 0, 46, 74,
        [[0, SKIN_HI], [0.45, SKIN], [1, SKIN_SH]])));
    cr.fill();

    // stone patches
    src(cr, SKIN_DEEP, 0.22);
    for (const [x, y, rx, ry] of [[-50, 46, 6, 9], [-44, 66, 4, 5], [52, 52, 5, 8], [45, 36, 3.5, 4]]) {
        cr.newPath();
        ellipse(cr, x, y, rx, ry);
        cr.fill();
    }

    cr.newPath();
    ellipse(cr, 0, 22, 44, 12);
    cr.setSource(pat('neck', () => radial(0, 22, 4, 0, 22, 44, [[0, SKIN_DEEP, 0.55], [1, SKIN_DEEP, 0]])));
    cr.fill();

    path(cr, BELLY_PATH);
    cr.setSource(pat('belly', () => linear(0, 30, 0, 86, [[0, BELLY], [1, BELLY_SH]])));
    cr.fill();
    // armour plates across the belly
    cr.setLineWidth(1.5);
    cr.setLineCap(Cairo.LineCap.ROUND);
    src(cr, BELLY_SH);
    for (const y of [46, 58, 70]) {
        const w = 27 - Math.abs(y - 52) * 0.15;
        cr.newPath();
        cr.moveTo(-w, y);
        cr.curveTo(-w * 0.5, y + 4, w * 0.5, y + 4, w, y);
        cr.stroke();
    }

    // feet with ivory claws
    mirrored(cr, () => {
        const [fx, fy, rx, ry] = FOOT;
        cr.newPath();
        ellipse(cr, fx, fy, rx, ry);
        cr.setSource(pat('foot', () => linear(0, fy - ry, 0, fy + ry, [[0, SKIN], [1, SKIN_SH]])));
        cr.fill();
        for (const dx of [-9, 0, 9]) {
            cr.newPath();
            ellipse(cr, fx + dx, fy + ry * 0.55, 3.4, 2.6);
            src(cr, TUSK);
            cr.fill();
        }
    });
}

function drawArm(cr, side) {
    cr.save();
    if (side > 0)
        cr.scale(-1, 1);
    path(cr, ARM);
    cr.setSource(pat('arm', () => linear(-76, 0, -40, 0, [[0, SKIN_SH], [0.55, SKIN], [1, SKIN_HI]])));
    cr.fill();
    const [fx, fy, fr] = FIST;
    cr.newPath();
    ellipse(cr, fx, fy, fr, fr * 0.92);
    cr.setSource(pat('fist', () => radial(fx + 4, fy - 6, 2, fx, fy, fr,
        [[0, SKIN_HI], [0.6, SKIN], [1, SKIN_SH]])));
    cr.fill();
    // knuckles
    cr.setLineWidth(1.3);
    cr.setLineCap(Cairo.LineCap.ROUND);
    src(cr, SKIN_DEEP, 0.55);
    for (const dx of [-5, 1, 7]) {
        cr.newPath();
        cr.moveTo(fx + dx, fy + 4);
        cr.lineTo(fx + dx - 0.5, fy + 9);
        cr.stroke();
    }
    cr.restore();
}

function drawPad(cr, side) {
    cr.save();
    if (side > 0)
        cr.scale(-1, 1);
    path(cr, PAD);
    cr.setSource(pat('pad', () => linear(-70, 2, -44, 32, [[0, STONE_HI], [0.5, STONE], [1, STONE_SH]])));
    cr.fill();
    // two rocky spikes
    for (const [x, y, h] of [[-66, 12, 9], [-55, 5, 7]]) {
        cr.newPath();
        cr.moveTo(x - 4, y + 3);
        cr.lineTo(x - 2.5, y - h);
        cr.lineTo(x + 4, y + 2);
        cr.closePath();
        src(cr, STONE_HI);
        cr.fill();
    }
    cr.restore();
}

function drawHorn(cr, side) {
    cr.save();
    if (side > 0)
        cr.scale(-1, 1);
    path(cr, HORN);
    cr.setSource(pat('horn', () => linear(-38, -52, -74, -104,
        [[0, HORN_BASE], [0.45, HORN_MID], [1, HORN_TIP]])));
    cr.fillPreserve();
    // a soft light along the outer curve
    cr.save();
    cr.clip();
    cr.setSource(pat('hornLight', () => linear(-86, 0, -62, 0, [[0, WHITE, 0.3], [1, WHITE, 0]])));
    cr.paint();
    cr.restore();
    // ridges
    cr.setLineWidth(1.2);
    src(cr, HORN_BASE, 0.55);
    for (const [x0, y0, x1, y1] of [[-62, -48, -50, -63], [-76, -60, -60, -72], [-82, -77, -67, -82]]) {
        cr.newPath();
        cr.moveTo(x0, y0);
        cr.curveTo(x0 + 3, y0 + 2, x1 - 3, y1 + 3, x1, y1);
        cr.stroke();
    }
    cr.restore();
}

function drawSkull(cr) {
    path(cr, SKULL);
    cr.setSource(pat('skull', () => radial(-16, -40, 6, 0, -14, 74,
        [[0, SKIN_HI], [0.5, SKIN], [1, SKIN_SH]])));
    cr.fillPreserve();
    cr.save();
    cr.clip();
    // stone patches on the forehead and cheeks
    src(cr, SKIN_DEEP, 0.2);
    for (const [x, y, rx, ry] of [[-6, -52, 9, 5], [10, -48, 5, 3.5], [-46, -6, 4, 6], [46, -2, 5, 7]]) {
        cr.newPath();
        ellipse(cr, x, y, rx, ry);
        cr.fill();
    }
    cr.restore();

    // deep eye sockets under the brow
    for (const [x, y] of EYES) {
        cr.newPath();
        ellipse(cr, x, y + 0.5, 12.5, 10.5);
        cr.setSource(radial(x, y + 1, 4, x, y + 1, 13, [[0, SOCKET, 0.95], [0.75, SOCKET, 0.6], [1, SOCKET, 0]]));
        cr.fill();
    }
}

function drawJaw(cr) {
    path(cr, CAVITY);
    src(cr, MOUTH);
    cr.fill();
    cr.newPath();
    ellipse(cr, 0, 22, 12, 5);
    src(cr, TONGUE);
    cr.fill();
    path(cr, JAW);
    cr.setSource(pat('jaw', () => linear(0, 10, 0, 33, [[0, SKIN], [1, SKIN_SH]])));
    cr.fill();
}

function drawMuzzle(cr, p) {
    path(cr, MUZZLE);
    cr.setSource(pat('muzzle', () => radial(-6, -6, 2, 0, 4, 32, [[0, SKIN_HI], [0.7, hex('#cdb89e')], [1, SKIN]])));
    cr.fill();
    path(cr, NOSE);
    cr.setSource(pat('nose', () => linear(0, -9, 0, 5, [[0, hex('#7d6a5c')], [1, SKIN_DEEP]])));
    cr.fill();
    for (const [x, y] of NOSTRILS) {
        cr.newPath();
        ellipse(cr, x, y, 3.2, 2.1);
        src(cr, SOCKET);
        cr.fill();
    }
    // upper lip: smile > 0 curls up, < 0 down
    const s = p.smile;
    cr.setLineWidth(1.6);
    cr.setLineCap(Cairo.LineCap.ROUND);
    src(cr, LINE, 0.75);
    cr.newPath();
    cr.moveTo(-20, 13 - s * 2.5);
    cr.curveTo(-10, 16 + s * 2, 10, 16 + s * 2, 20, 13 - s * 2.5);
    cr.stroke();
}

function drawTusks(cr) {
    mirrored(cr, () => {
        path(cr, TUSK_PATH);
        cr.setSource(pat('tusk', () => linear(-27, 0, -18, 0, [[0, TUSK], [1, TUSK_SH]])));
        cr.fill();
    });
}

function drawEyes(cr, p) {
    for (const [x, y] of EYES)
        drawEye(cr, x, y, p.eyes, p.eye);
}

function drawEye(cr, x, y, e, color) {
    const open = clamp(e.open, 0, 1);
    const happy = e.happy;
    const rx = 7.2, ry = 7;
    if (open > 0.06 && happy < 0.98) {
        cr.save();
        // glowing iris, the lids cut it from the top and bottom
        const top = y - ry + (1 - open) * ry * 1.25;
        const bot = y + ry - (1 - open) * ry * 0.75;
        cr.newPath();
        ellipse(cr, x, y, rx, ry);
        cr.clip();
        cr.newPath();
        cr.rectangle(x - rx, top, 2 * rx, bot - top);
        cr.clip();
        cr.setSource(radial(x, y, 0.5, x, y, rx * 1.1,
            [[0, mix(color, WHITE, 0.75)], [0.45, color], [1, mix(color, BLACK, 0.35)]]));
        cr.paint();
        const lx = x + e.lookX * 2.4, ly = y + e.lookY * 1.8;
        cr.newPath();
        ellipse(cr, lx, ly, 2.2, 4.4);
        src(cr, hex('#2a1206'), 0.9);
        cr.fill();
        cr.newPath();
        ellipse(cr, lx - 2.4, ly - 2.6, 1.6, 1.3);
        src(cr, WHITE, 0.9);
        cr.fill();
        cr.restore();
        if (happy > 0.02) {
            // fold the eye into an upside-down crescent as it squints
            cr.newPath();
            cr.rectangle(x - rx - 1, y + 1.5 - happy * 6, 2 * rx + 2, ry + 2);
            src(cr, SOCKET);
            cr.fill();
        }
    }
    if (happy > 0.5) {
        cr.setLineWidth(1.9);
        cr.setLineCap(Cairo.LineCap.ROUND);
        src(cr, color, 0.95);
        cr.newPath();
        cr.moveTo(x - 6, y + 1);
        cr.curveTo(x - 2.5, y - 3.5, x + 2.5, y - 3.5, x + 6, y + 1);
        cr.stroke();
    } else if (open <= 0.06) {
        // shut: a heavy lid with a dark lash line
        cr.newPath();
        ellipse(cr, x, y + 0.5, 10, 8);
        cr.setSource(radial(x - 2, y - 3, 1, x, y, 10, [[0, SKIN], [1, SKIN_SH]]));
        cr.fill();
        cr.setLineWidth(1.6);
        cr.setLineCap(Cairo.LineCap.ROUND);
        src(cr, LINE, 0.8);
        cr.newPath();
        cr.moveTo(x - 7, y + 1.5);
        cr.curveTo(x - 3, y + 5, x + 3, y + 5, x + 7, y + 1.5);
        cr.stroke();
    }
}

function drawBrow(cr, side) {
    cr.save();
    if (side > 0)
        cr.scale(-1, 1);
    path(cr, BROW);
    cr.setSource(pat('brow', () => linear(0, -42, 0, -22, [[0, SKIN], [1, SKIN_DEEP]])));
    cr.fill();
    cr.restore();
}

function drawGlare(cr) {
    for (const [x, y] of EYES) {
        cr.newPath();
        ellipse(cr, x, y, 22, 16);
        cr.setSource(radial(x, y, 1, x, y, 22, [[0, hex('#ffd2c4'), 0.9], [0.25, AGGRO, 0.65], [1, AGGRO, 0]]));
        cr.fill();
    }
}

function drawCheese(cr) {
    const [cx, cy] = CHEESE_AT;
    cr.save();
    cr.translate(cx, cy);
    // a wedge seen from the front and a little above
    cr.newPath();
    cr.moveTo(-16, -2);
    cr.lineTo(15, -9);
    cr.lineTo(16, 6);
    cr.lineTo(-15, 10);
    cr.closePath();
    cr.setSource(linear(0, -9, 0, 10, [[0, CHEESE], [1, CHEESE_SH]]));
    cr.fill();
    cr.newPath();
    cr.moveTo(-16, -2);
    cr.lineTo(15, -9);
    cr.lineTo(6, -14);
    cr.closePath();
    src(cr, CHEESE_HI);
    cr.fill();
    for (const [x, y, r] of [[-8, 3, 2.6], [3, 0, 2], [10, 3.5, 1.6], [-1, 6, 1.4]]) {
        cr.newPath();
        ellipse(cr, x, y, r, r * 0.85);
        src(cr, CHEESE_HOLE);
        cr.fill();
    }
    cr.restore();
}

// --- panel glyph -------------------------------------------------------------------
//
// Monochrome like a symbolic icon: Roshan's head and horns, cut out of the
// panel colour, with glowing eyes in the mood colour. Geometry in panel pixels.
// g: {open, brow, eye, glow, roll, dy, dx, scale}

export const GLYPH = {w: 24, h: 22};

const G_HEAD = 'M 12 7.2 C 16.7 7.2 19.5 9.8 19.5 13.4 C 19.5 17.3 16.4 20 12 20 C 7.6 20 4.5 17.3 4.5 13.4 C 4.5 9.8 7.3 7.2 12 7.2 Z';
const G_HORN = 'M 7.7 10.4 C 4.4 10.4 2 8.7 1.7 6.1 C 1.5 4.4 2.1 2.7 3.4 1.4 C 3.4 3.4 4.1 5 5.5 6 C 6.7 6.8 8.3 7.3 10 7.5 Z';
const G_EYE = [2.65, 13.1, 1.55, 1.45];
const G_PIVOT = [12, 13.5];

export function drawGlyph(cr, fg, g) {
    const [px, py] = G_PIVOT;
    cr.save();
    cr.translate(px + (g.dx ?? 0), py + (g.dy ?? 0));
    cr.scale(g.scale ?? 1, g.scale ?? 1);
    cr.rotate(g.roll ?? 0);
    cr.translate(-px, -py);

    cr.pushGroup();
    src(cr, fg);
    path(cr, G_HEAD);
    cr.fill();
    path(cr, G_HORN);
    cr.fill();
    cr.save();
    cr.translate(24, 0);
    cr.scale(-1, 1);
    path(cr, G_HORN);
    cr.fill();
    cr.restore();

    // knock out the brow, the eyes and the mouth
    cr.setOperator(Cairo.Operator.CLEAR);
    const [ex, ey, erx, ery] = G_EYE;
    const open = clamp(g.open ?? 1, 0, 1);
    const anger = clamp(g.brow ?? 0, -1, 1);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineWidth(1.05);
    for (const side of [-1, 1]) {
        const x = 12 + side * ex;
        cr.newPath();
        cr.moveTo(x + side * 2.6, ey - 3.2 - anger * 0.5);
        cr.lineTo(x - side * 1.6, ey - 2.5 + anger * 0.9);
        cr.stroke();
        cr.newPath();
        if (open > 0.25) {
            ellipse(cr, x, ey, erx, ery * open);
            cr.fill();
        } else {
            cr.moveTo(x - 1.5, ey);
            cr.curveTo(x - 0.6, ey + 1, x + 0.6, ey + 1, x + 1.5, ey);
            cr.stroke();
        }
    }
    cr.setLineWidth(0.95);
    cr.newPath();
    cr.moveTo(8.2, 17.1);
    cr.curveTo(10.4, 17.9, 13.6, 17.9, 15.8, 17.1);
    cr.stroke();

    // tusks back on top of the mouth
    cr.setOperator(Cairo.Operator.OVER);
    src(cr, fg);
    for (const side of [-1, 1]) {
        const x = 12 + side * 3;
        cr.newPath();
        cr.moveTo(x - 0.9, 17.8);
        cr.lineTo(x + side * 0.35, 14.9);
        cr.lineTo(x + 0.9, 17.8);
        cr.closePath();
        cr.fill();
    }
    cr.popGroupToSource();
    cr.paintWithAlpha(fg[3] ?? 1);

    // the eyes glow in the mood colour
    if (open > 0.25) {
        for (const side of [-1, 1]) {
            const x = 12 + side * ex;
            const glow = g.glow ?? 0;
            if (glow > 0.01) {
                cr.setSource(radial(x, ey, 0, x, ey, 3.6, [[0, g.eye, 0.5 * glow], [1, g.eye, 0]]));
                cr.newPath();
                ellipse(cr, x, ey, 3.6);
                cr.fill();
            }
            cr.newPath();
            ellipse(cr, x, ey, erx * 0.86, ery * open * 0.86);
            src(cr, g.eye);
            cr.fill();
        }
    }
    cr.restore();
}
