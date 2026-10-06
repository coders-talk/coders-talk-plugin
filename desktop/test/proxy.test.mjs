// The system's proxy for coders-talk (src/main/proxy.mjs): what Chromium's resolveProxy answers becomes the variables
// coders-talk reads, and a proxy the person named stays theirs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proxyVariables, withSystemProxy } from '../src/main/proxy.mjs';

const local = 'localhost,127.0.0.1,::1';

test('a VPN client in system-proxy mode: its HTTP or SOCKS5 port goes to coders-talk', () => {
    assert.deepEqual(proxyVariables('PROXY 127.0.0.1:10809', {}), { HTTPS_PROXY: 'http://127.0.0.1:10809', HTTP_PROXY: 'http://127.0.0.1:10809', NO_PROXY: local });
    assert.deepEqual(proxyVariables('SOCKS5 127.0.0.1:1080; DIRECT', {}), { HTTPS_PROXY: 'socks5://127.0.0.1:1080', HTTP_PROXY: 'socks5://127.0.0.1:1080', NO_PROXY: local });
    assert.equal(proxyVariables('SOCKS 127.0.0.1:7890', {}).HTTPS_PROXY, 'socks5://127.0.0.1:7890', 'the Windows "socks=" setting');
    assert.equal(proxyVariables('HTTPS proxy.corp:443', {}).HTTPS_PROXY, 'https://proxy.corp:443');
    assert.equal(proxyVariables('PROXY p:1', { NO_PROXY: '.corp' }).NO_PROXY, undefined, 'the NO_PROXY there stays');
});

test('a direct connection, or a proxy the person named, changes nothing', () => {
    assert.deepEqual(proxyVariables('DIRECT', {}), {});
    assert.deepEqual(proxyVariables('', {}), {});
    assert.deepEqual(proxyVariables(undefined, {}), {});
    assert.deepEqual(proxyVariables('PROXY 127.0.0.1:10809', { HTTPS_PROXY: 'http://mine:3128' }), {});
    assert.deepEqual(proxyVariables('PROXY 127.0.0.1:10809', { all_proxy: 'socks5://mine:1080' }), {});
});

test('each command asks for the site, and a failing question leaves the environment as it is', async () => {
    const asked = [];
    const env = await withSystemProxy({ A: '1' }, 'https://coders.talk', async (url) => (asked.push(url), 'PROXY 127.0.0.1:2080'));
    assert.deepEqual(asked, ['https://coders.talk']);
    assert.equal(env.A, '1');
    assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:2080');
    assert.deepEqual(await withSystemProxy({ A: '1' }, 'https://coders.talk', async () => { throw new Error('no session'); }), { A: '1' });
});
