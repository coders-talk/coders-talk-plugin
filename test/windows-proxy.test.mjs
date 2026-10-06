import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { parseRegistry, windowsProxyFromSettings, windowsProxyFor } from '../scripts/lib/windows-proxy.mjs';
import { request } from '../scripts/lib/http.mjs';

const target = 'https://coders.talk/api/v1/me';
const settings = (server, overrides = '') => ({ proxyenable: 1, proxyserver: server, proxyoverride: overrides });

test('Windows settings: enabled, disabled, shared and per-protocol HTTP/SOCKS proxies', () => {
    assert.equal(windowsProxyFromSettings(target, {}), null);
    assert.equal(windowsProxyFromSettings(target, { ...settings('p:80'), proxyenable: 0 }), null);
    assert.equal(windowsProxyFromSettings(target, settings('127.0.0.1:2080')).href, 'http://127.0.0.1:2080/');
    const split = settings('http=plain:8080;https=secure:8081;socks=socks:1080');
    assert.equal(windowsProxyFromSettings(target, split).href, 'http://secure:8081/');
    assert.equal(windowsProxyFromSettings('http://example.com', split).host, 'plain:8080');
    assert.equal(windowsProxyFromSettings(target, settings('http=plain:8080;socks=127.0.0.1:1080')).protocol, 'socks5:');
    assert.equal(windowsProxyFromSettings(target, settings('socks5://127.0.0.1:1080')).protocol, 'socks5:');
    assert.equal(windowsProxyFromSettings(target, settings('http=plain:8080')), null);
    assert.equal(windowsProxyFromSettings(target, settings('::invalid')), null);
    assert.equal(windowsProxyFromSettings(target, settings('file:///private')), null);
});

test('Windows exceptions: wildcard, port, local names and loopback', () => {
    const configured = settings('proxy:8080', '*.example.com;special.test:443;<local>;192.168.*');
    for (const url of ['http://a.example.com', 'https://special.test', 'http://intranet', 'http://192.168.1.2', 'http://localhost', 'https://127.0.0.2', 'http://[::1]']) {
        assert.equal(windowsProxyFromSettings(url, configured), null, url);
    }
    for (const url of ['https://example.com', 'http://special.test', 'https://notexample.com', target]) {
        assert.ok(windowsProxyFromSettings(url, configured), url);
    }
});

test('reg.exe output: values, casing, spaces and hex DWORDs', () => {
    assert.deepEqual(parseRegistry('HKEY_CURRENT_USER\\...\r\n    ProxyEnable    REG_DWORD    0x1\r\n    ProxyServer    REG_SZ    http=p:1; https=p:2\r\n    ProxyOverride    REG_SZ    <local>;*.test\r\n    Unrelated REG_SZ secret\r\n'), {
        proxyenable: 1, proxyserver: 'http=p:1; https=p:2', proxyoverride: '<local>;*.test',
    });
    assert.deepEqual(parseRegistry('    ProxySettingsPerUser    REG_DWORD    0x0'), { proxysettingsperuser: 0 });
});

test('refresh settings every time, skip other platforms, respect cancellation', async () => {
    let count = 0;
    const readSettings = async () => ({ ...settings('p:8080'), proxyenable: ++count === 1 ? 1 : 0 });
    assert.ok(await windowsProxyFor(target, { platform: 'win32', readSettings }));
    assert.equal(await windowsProxyFor(target, { platform: 'win32', readSettings }), null);
    assert.equal(await windowsProxyFor(target, { platform: 'linux', readSettings }), null);
    assert.equal(count, 2);
    await assert.rejects(windowsProxyFor(target, { platform: 'win32', readSettings, signal: AbortSignal.abort() }), { name: 'AbortError' });
    assert.equal(count, 2);
});

test('request without env proxies reaches a site only through the Windows proxy', async () => {
    let received;
    const server = createServer((req, res) => {
        received = { url: req.url, auth: req.headers.authorization };
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const systemProxy = (url, options) => windowsProxyFor(url, {
            ...options, platform: 'win32', readSettings: async () => settings('127.0.0.1:' + server.address().port),
        });
        const response = await request('http://unresolvable.invalid/api/v1/me', {
            headers: { Authorization: 'Bearer test-token' }, signal: AbortSignal.timeout(5000),
        }, { env: {}, systemProxy });
        assert.deepEqual(await response.json(), { ok: true });
        assert.deepEqual(received, { url: 'http://unresolvable.invalid/api/v1/me', auth: 'Bearer test-token' });
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
});

test('explicit environment and NO_PROXY never consult the system proxy', async () => {
    const server = createServer((req, res) => res.end('ok'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port;
    const systemProxy = () => { throw new Error('must not read Windows settings'); };
    try {
        for (const env of [
            { NO_PROXY: '*' }, { no_proxy: '127.0.0.1' },
            { HTTPS_PROXY: 'http://unused:1' }, { https_proxy: 'http://unused:1' },
            { ALL_PROXY: url }, { http_proxy: url },
            { HTTP_PROXY: '::invalid' },
        ]) {
            const response = await request(url, {}, { env, systemProxy });
            assert.equal(await response.text(), 'ok');
        }
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
});
