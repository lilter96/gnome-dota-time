// gjs -m tools/icon.js — the notification icon: Roshan in aggro on graphite.
import Cairo from 'cairo';
import System from 'system';
import {roundRect, src} from '../dota-time@terentiy/kit.js';
import {GLYPH, MOODS, drawGlyph} from '../dota-time@terentiy/roshan.js';

const S = 128;
const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, S, S);
const cr = new Cairo.Context(surf);
roundRect(cr, 0, 0, S, S, 30);
src(cr, [0.114, 0.118, 0.145]);
cr.fill();
const k = 4.1;
cr.translate((S - GLYPH.w * k) / 2, (S - GLYPH.h * k) / 2 + 2);
cr.scale(k, k);
drawGlyph(cr, [1, 1, 1, 1], {open: 1, brow: 1, eye: MOODS[3].eye, glow: 1});
surf.writeToPNG(ARGV[0] ?? 'dota-time@terentiy/icons/roshan.png');
System.exit(0);
