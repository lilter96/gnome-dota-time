import GLib from 'gi://GLib';

import {Portraits} from '../dota-time@terentiy/sources.js';
import {assert, equal, test} from './harness.js';

// A real PNG, big enough that writing it takes a while.
const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const [, PNG] = GLib.file_get_contents(GLib.build_filenamev([here, '..', 'docs', 'media', 'cards.png']));

const PA = 44;   // Phantom Assassin
const FILE = 'phantom_assassin.png';

function fakeWeb() {
    const web = {calls: 0, get: async () => {
        web.calls++;
        return PNG;
    }};
    return web;
}

const tick = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

// Asks like a repaint does, every half a millisecond, until a picture comes or time runs out.
async function askUntilLoaded(p, ms) {
    const until = GLib.get_monotonic_time() + ms * 1000;
    let surf = null;
    while (!surf && GLib.get_monotonic_time() < until) {
        surf = p.get(PA);
        await tick(0);
    }
    return surf;
}

test('a portrait cut short on disk is fetched again, not given up on', async () => {
    const dir = GLib.dir_make_tmp('dota-time-XXXXXX');
    GLib.file_set_contents(GLib.build_filenamev([dir, FILE]), PNG.slice(0, 200));
    const web = fakeWeb();
    const p = new Portraits(web, () => {}, dir);
    const surf = await askUntilLoaded(p, 3000);
    assert(surf, 'still grey');
    equal(web.calls, 1);
    equal(surf.getWidth(), 1725);
});

test('a repaint while the portrait is being written never sees half of it', async () => {
    for (let round = 0; round < 20; round++) {
        const dir = GLib.dir_make_tmp('dota-time-XXXXXX');
        const p = new Portraits(fakeWeb(), () => {}, dir);
        const surf = await askUntilLoaded(p, 3000);
        assert(surf, `still grey after the download, round ${round}`);
    }
});
