import Cairo from 'cairo';

import {AGGRO_HOURS, GLYPH, HERO, MOODS, Roshan, SCENE, compose, drawGlyph, moodFor} from '../dota-time@terentiy/roshan.js';
import {assert, equal, seeded, test} from './harness.js';

const FRAME = 1 / 60;

function make(state) {
    const r = new Roshan({random: seeded(3)});
    r.update({hours: 0, awake: true, ...state});
    r.settle();
    return r;
}

function run(r, seconds) {
    for (let t = 0; t < seconds; t += FRAME)
        r.step(FRAME);
}

test('mood follows the hours played today', () => {
    equal(moodFor(0), 0);
    equal(moodFor(1.99), 0);
    equal(moodFor(2), 1);
    equal(moodFor(3.5), 2);
    equal(moodFor(AGGRO_HOURS), 3);
    equal(moodFor(9), 3);
    equal(moodFor(NaN), 0);
    equal(MOODS.length, 4);
});

test('Roshan sleeps while Dota is closed and wakes when it starts', () => {
    const r = make({awake: false});
    assert(r.sleeping);
    r.update({awake: true});
    assert(!r.sleeping);
    assert(r.particles.some(p => p.kind === 'bang'), 'wakes with a start');
});

test('a poke wakes him for a few seconds', () => {
    const r = make({awake: false});
    r.poke();
    assert(!r.sleeping);
    run(r, 4.5);
    assert(r.sleeping);
});

test('in aggro he slams the ground: a shockwave and a shake', () => {
    const r = make({hours: 4.5});
    let shock = false, shake = 0;
    for (let t = 0; t < 10; t += FRAME) {
        r.step(FRAME);
        shock ||= r.particles.some(p => p.kind === 'shock');
        shake = Math.max(shake, Math.abs(r.pose.rig.ty));
    }
    assert(shock, 'shockwave');
    assert(shake > 1, `camera shake ${shake}`);
});

test('below four hours there is no slam', () => {
    const r = make({hours: 3.9});
    run(r, 15);
    assert(!r.particles.some(p => p.kind === 'shock'));
});

test('the ring overflows past four hours', () => {
    const r = make({hours: 6});
    run(r, 3);
    assert(Math.abs(r.pose.ring - 1.5) < 0.01, `ring ${r.pose.ring}`);
});

test('with reduced motion everything comes to rest', () => {
    const r = new Roshan({random: seeded(1), reducedMotion: true});
    r.update({hours: 5, awake: true});
    r.settle();
    run(r, 0.5);
    assert(!r.moving);
});

test('every state renders', () => {
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, HERO.w, HERO.h);
    const cr = new Cairo.Context(surf);
    cr.translate(-HERO.x0, -HERO.y0);
    for (const state of [{awake: false}, {hours: 1}, {hours: 3.2}, {hours: 7}]) {
        const r = make(state);
        r.react('win');
        run(r, 1);
        compose(cr, r.pose, SCENE);
    }
    cr.$dispose();
});

test('the panel glyph renders in every mood, asleep and awake', () => {
    const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, GLYPH.w, GLYPH.h);
    for (const [i, m] of MOODS.entries()) {
        for (const open of [0, 1]) {
            const cr = new Cairo.Context(surf);
            drawGlyph(cr, [1, 1, 1, 1], {open, brow: i / 3, eye: m.eye, glow: i === 3 ? 1 : 0, roll: 0.1, dy: -1});
            cr.$dispose();
        }
    }
});
