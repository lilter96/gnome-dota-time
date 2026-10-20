import Gio from 'gi://Gio';

import {DotaWatcher} from '../dota-time@terentiy/sources.js';
import {equal, test} from './harness.js';

// Just enough of GNOME Shell for DotaWatcher: a display and a window list.
function fakeShell(windows) {
    globalThis.global = {
        display: {connect: () => 1, disconnect() {}},
        get_window_actors: () => windows.map(w => ({meta_window: w})),
    };
}

function fakeWindow(wmClass, pid) {
    return {
        get_wm_class: () => wmClass,
        get_pid: () => pid,
        connect: () => 1,
        disconnect() {},
        has_focus: () => true,
        is_fullscreen: () => true,
    };
}

const me = Gio.Credentials.new().get_unix_pid();

test('Dota already open when the extension starts is no change to report', () => {
    // a lock screen or a shell restart in the middle of a game
    fakeShell([fakeWindow('dota2', me)]);
    const calls = [];
    const w = new DotaWatcher(r => calls.push(r));
    equal(calls.length, 0, 'onChange during construction:');
    equal(w.running, true);
    equal(w.gaming, true);
    w.destroy();
});

test('the launch flag stays unknown unless the process is Dota', () => {
    fakeShell([fakeWindow('dota2', me)]);
    const w = new DotaWatcher(() => {});
    equal(w.gsiFlag, null);
    w.destroy();
});
