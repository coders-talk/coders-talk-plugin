// The app's own updates (src/main/updater.mjs) with stand-ins for Electron's net and electron-updater: what it asks, and
// that a copy from the Microsoft Store never updates itself.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createUpdater } from '../src/main/updater.mjs';

function deps({ version = '0.1.0', releases = [], store = false, packaged = true } = {}) {
    const asked = [];
    const states = [];
    const autoUpdater = Object.assign(new EventEmitter(), {
        feeds: [],
        setFeedURL(feed) {
            this.feeds.push(feed);
        },
        async checkForUpdates() {
            this.emit('download-progress', { percent: 50 });
            this.emit('update-downloaded', { version: '0.2.0' });
        },
        quitAndInstall() {},
    });
    const net = {
        async fetch(url) {
            asked.push(url);
            return { ok: true, json: async () => releases };
        },
    };
    const app = { isPackaged: packaged, getVersion: () => version };
    const updater = createUpdater({ app, net, autoUpdater, broadcast: (s) => states.push(s.state), env: {}, store });

    return { updater, asked, states, autoUpdater };
}

const release = (tag) => ({ tag_name: tag, draft: false, prerelease: false, assets: [{ name: 'latest.yml' }] });

test('a copy from the Microsoft Store leaves updates to the Store: it never asks GitHub', async () => {
    const { updater, asked } = deps({ store: true, releases: [release('desktop--v9.0.0')] });
    assert.equal(updater.state().state, 'store');
    assert.equal((await updater.check()).state, 'store');
    assert.equal(updater.install(), false);
    assert.deepEqual(asked, []);
});

test('a copy that is not installed never checks', async () => {
    const { updater, asked } = deps({ packaged: false });
    assert.equal((await updater.check()).state, 'off');
    assert.deepEqual(asked, []);
});

test('the newest app release is downloaded from its own release folder, and then it is ready', async () => {
    const { updater, asked, states, autoUpdater } = deps({ releases: [release('coders-talk--v1.0.0'), release('desktop--v0.2.0')] });
    const state = await updater.check();
    assert.equal(asked.length, 1);
    assert.deepEqual(autoUpdater.feeds, [{ provider: 'generic', url: 'https://github.com/coders-talk/coders-talk-plugin/releases/download/desktop--v0.2.0' }]);
    assert.deepEqual(states, ['checking', 'downloading', 'downloading', 'ready']);
    assert.deepEqual(state, { state: 'ready', version: '0.2.0' });
    assert.equal(updater.install(), true);
});

test('no newer release: up to date, and nothing downloads', async () => {
    const { updater, autoUpdater } = deps({ version: '0.2.0', releases: [release('desktop--v0.2.0')] });
    assert.equal((await updater.check()).state, 'none');
    assert.deepEqual(autoUpdater.feeds, []);
});
