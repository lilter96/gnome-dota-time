// Renders Roshan in a few states to a contact sheet, with plain gjs:
//   gjs -m tools/frames.js out.png [scale]
// Handy for checking drawings without restarting the Shell.

import Cairo from 'cairo';
import System from 'system';

import {HERO, Roshan, compose} from '../dota-time@terentiy/roshan.js';

const [out = 'frames.png', scaleArg = '2'] = ARGV;
const K = Number(scaleArg);

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

// [label, state, seconds to run, optional action]
const SHOTS = [
    ['asleep', {hours: 0.6, awake: false}, 3],
    ['calm', {hours: 1.2, awake: true}, 2.5],
    ['nibble', {hours: 1.6, awake: true}, 4.9],
    ['alert', {hours: 2.4, awake: true}, 3],
    ['grumpy', {hours: 3.4, awake: true}, 3.1],
    ['aggro', {hours: 4.6, awake: true}, 3.3],
    ['windup', {hours: 5.1, awake: true}, 1.38],
    ['slam', {hours: 5.1, awake: true}, 1.7],
    ['win', {hours: 1.8, awake: true}, 2, r => r.react('win'), 0.5],
    ['loss', {hours: 2.6, awake: true}, 2, r => r.react('loss'), 1.2],
];

const CELL_W = HERO.w * HERO.scale, CELL_H = HERO.h * HERO.scale;
const cols = 5;
const rows = Math.ceil(SHOTS.length / cols);
const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, Math.ceil(cols * CELL_W * K), Math.ceil(rows * CELL_H * K));
const cr = new Cairo.Context(surf);
cr.setSourceRGB(29 / 255, 30 / 255, 37 / 255);
cr.paint();

SHOTS.forEach(([label, state, secs, action, after = 0], i) => {
    const r = new Roshan({random: rng(7 + i)});
    r.update(state);
    r.settle();
    r.intro();
    for (let t = 0; t < secs; t += 1 / 60)
        r.step(1 / 60);
    if (action) {
        action(r);
        for (let t = 0; t < after; t += 1 / 60)
            r.step(1 / 60);
    }
    cr.save();
    cr.translate((i % cols) * CELL_W * K, Math.floor(i / cols) * CELL_H * K);
    cr.scale(K * HERO.scale, K * HERO.scale);
    cr.translate(-HERO.x0, -HERO.y0);
    compose(cr, r.pose);
    cr.restore();
    cr.save();
    cr.translate((i % cols) * CELL_W * K + 8, Math.floor(i / cols) * CELL_H * K + 18);
    cr.setSourceRGBA(1, 1, 1, 0.6);
    cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
    cr.setFontSize(12 * K / 2);
    cr.showText(label);
    cr.restore();
});

surf.writeToPNG(out);
cr.$dispose();
System.exit(0);
