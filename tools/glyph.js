// gjs -m tools/glyph.js out.png — the panel glyph in each mood, zoomed.
import Cairo from 'cairo';
import System from 'system';
import {GLYPH, MOODS, drawGlyph} from '../dota-time@terentiy/roshan.js';

const Z = 6;
const states = [
    {open: 0, brow: 0, eye: MOODS[0].eye, glow: 0},
    {open: 1, brow: 0, eye: MOODS[0].eye, glow: 0},
    {open: 1, brow: 0.2, eye: MOODS[1].eye, glow: 0},
    {open: 0.8, brow: 0.6, eye: MOODS[2].eye, glow: 0.3},
    {open: 1, brow: 1, eye: MOODS[3].eye, glow: 1},
];
const W = GLYPH.w * Z + 20, H = GLYPH.h * Z + 20;
const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, W * states.length, H * 2 + 40);
const cr = new Cairo.Context(surf);
cr.setSourceRGB(0, 0, 0);
cr.paint();
states.forEach((g, i) => {
    for (const [row, k] of [[0, Z], [1, 1]]) {
        cr.save();
        cr.translate(i * W + 10, row ? H + 30 : 10);
        cr.scale(k, k);
        drawGlyph(cr, [1, 1, 1, 1], g);
        cr.restore();
    }
});
surf.writeToPNG(ARGV[0] ?? 'glyph.png');
System.exit(0);
