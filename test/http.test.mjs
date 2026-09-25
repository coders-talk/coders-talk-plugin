import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, request as forward } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { connect } from 'node:net';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { proxyFor, request } from '../scripts/lib/http.mjs';

const fixtures = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');
const ca = readFileSync(join(fixtures, 'tls-cert.pem'));

/** What the site got: method, path, content type and the body's size and first bytes. */
const handler = (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
        const body = Buffer.concat(chunks);
        const status = req.headers.authorization === 'Bearer good' ? 202 : 401;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Set-Cookie': ['a=1', 'b=2'] }).end(JSON.stringify({
            method: req.method, path: req.url, type: req.headers['content-type'] ?? null, size: body.length, has_file: body.includes('filename="s.jsonl.gz"'),
        }));
    });
};
const site = createTlsServer({ key: readFileSync(join(fixtures, 'tls-key.pem')), cert: ca }, handler);
const plainSite = createServer(handler);

/** A forward proxy: CONNECT tunnels and absolute-form requests; with `auth` set it wants those credentials. */
let seen = [];
let auth = null;
const proxy = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (auth && req.headers['proxy-authorization'] !== `Basic ${Buffer.from(auth).toString('base64')}`) return res.writeHead(407).end();
    const target = new URL(req.url);
    const out = forward({ host: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers: req.headers }, (upstream) => {
        res.writeHead(upstream.statusCode, upstream.headers);
        upstream.pipe(res);
    });
    req.pipe(out);
});
proxy.on('connect', (req, socket, head) => {
    seen.push(`CONNECT ${req.url}`);
    if (auth && req.headers['proxy-authorization'] !== `Basic ${Buffer.from(auth).toString('base64')}`) {
        return socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
    }
    const [host, port] = req.url.split(':');
    const upstream = connect(Number(port), host, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
});

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let siteUrl;
let plainUrl;
let proxyUrl;
before(async () => {
    await Promise.all([listen(site), listen(plainSite), listen(proxy)]);
    siteUrl = `https://localhost:${site.address().port}`;
    plainUrl = `http://127.0.0.1:${plainSite.address().port}`;
    proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
});
after(() => [site, plainSite, proxy].forEach((s) => s.close()));

const upload = (size) => {
    const form = new FormData();
    form.append('agent', 'claude-code');
    form.append('file', new Blob([Buffer.alloc(size, 7)], { type: 'application/gzip' }), 's.jsonl.gz');

    return form;
};

test('proxyFor reads HTTPS_PROXY, HTTP_PROXY, ALL_PROXY and NO_PROXY the way curl does', () => {
    const https = 'https://coders.talk/api/v1/me';
    assert.equal(proxyFor(https, {}), null);
    assert.equal(proxyFor(https, { HTTPS_PROXY: 'http://127.0.0.1:2081' }).host, '127.0.0.1:2081');
    assert.equal(proxyFor(https, { https_proxy: '127.0.0.1:2081' }).href, 'http://127.0.0.1:2081/');
    assert.equal(proxyFor(https, { HTTP_PROXY: 'http://127.0.0.1:2081' }), null, 'HTTP_PROXY is for http:// sites');
    assert.equal(proxyFor('http://localhost:8000/x', { HTTP_PROXY: 'http://p:1' }).host, 'p:1');
    assert.equal(proxyFor(https, { ALL_PROXY: 'http://p:1' }).host, 'p:1');
    assert.equal(proxyFor(https, { HTTPS_PROXY: 'socks5://127.0.0.1:1080' }), null, 'socks is not ours to speak');
    assert.equal(proxyFor(https, { HTTPS_PROXY: '::not a url' }), null);

    const behind = { HTTPS_PROXY: 'http://p:1', HTTP_PROXY: 'http://p:1' };
    for (const noProxy of ['*', 'coders.talk', '.coders.talk', '*.talk', 'localhost, coders.talk', 'coders.talk:443']) {
        assert.equal(proxyFor(https, { ...behind, NO_PROXY: noProxy }), null, noProxy);
    }
    for (const noProxy of ['localhost,127.0.0.1,::1,.local', 'talk.coders', 'coders.talk:8443']) {
        assert.notEqual(proxyFor(https, { ...behind, NO_PROXY: noProxy }), null, noProxy);
    }
    assert.equal(proxyFor('http://127.0.0.1:8000/', { ...behind, no_proxy: 'localhost,127.0.0.1,::1' }), null);
    assert.equal(proxyFor('http://[::1]:8000/', { ...behind, NO_PROXY: '::1' }), null);
    assert.equal(proxyFor('http://sub.example.com/', { ...behind, NO_PROXY: 'example.com' }), null);
});

test('an upload to an https site goes through a CONNECT tunnel and comes back as a Response', async () => {
    seen = [];
    const env = { HTTPS_PROXY: proxyUrl };
    // 2 MB: far past the 16 KB after which some networks reset a direct connection.
    const response = await request(`${siteUrl}/api/v1/imports?x=1`, { method: 'POST', headers: { Authorization: 'Bearer good', Accept: 'application/json' }, body: upload(2 * 1024 * 1024) }, { env, ca });
    assert.equal(response.status, 202);
    assert.equal(response.ok, true);
    assert.equal(response.headers.get('content-type'), 'application/json');
    const got = await response.json();
    assert.equal(got.method, 'POST');
    assert.equal(got.path, '/api/v1/imports?x=1');
    assert.match(got.type, /^multipart\/form-data; boundary=/);
    assert.equal(got.has_file, true);
    assert.ok(got.size > 2 * 1024 * 1024);
    assert.deepEqual(seen, [`CONNECT localhost:${site.address().port}`]);

    // Statuses come through as they are, so the caller's 401 handling still works.
    const denied = await request(`${siteUrl}/api/v1/me`, { headers: { Authorization: 'Bearer bad' } }, { env, ca });
    assert.equal(denied.status, 401);
    assert.equal(denied.ok, false);
});

test('an http site goes to the proxy with the whole URL, and NO_PROXY goes direct', async () => {
    seen = [];
    const response = await request(`${plainUrl}/api/v1/me`, { headers: { Authorization: 'Bearer good' } }, { env: { HTTP_PROXY: proxyUrl } });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).path, '/api/v1/me');
    assert.deepEqual(seen, [`GET ${plainUrl}/api/v1/me`]);

    seen = [];
    const direct = await request(`${plainUrl}/api/v1/me`, {}, { env: { HTTP_PROXY: proxyUrl, NO_PROXY: '127.0.0.1' } });
    assert.equal(direct.status, 401);
    assert.deepEqual(seen, []);
});

test('proxy credentials from the URL are sent, and a refusal names the proxy without them', async () => {
    auth = 'mara:s3cr#t';
    try {
        const refused = await request(`${siteUrl}/api/v1/me`, {}, { env: { HTTPS_PROXY: proxyUrl }, ca }).catch((e) => e);
        assert.ok(refused instanceof Error);
        assert.match(refused.message, /the proxy answered 407 to CONNECT localhost:\d+ \(through the proxy 127\.0\.0\.1:\d+\)/);

        const withAuth = proxyUrl.replace('http://', `http://mara:${encodeURIComponent('s3cr#t')}@`);
        const ok = await request(`${siteUrl}/api/v1/me`, { headers: { Authorization: 'Bearer good' } }, { env: { HTTPS_PROXY: withAuth }, ca });
        assert.equal(ok.status, 202);

        const wrong = await request(`${siteUrl}/api/v1/me`, {}, { env: { HTTPS_PROXY: proxyUrl.replace('http://', 'http://mara:nope@') }, ca }).catch((e) => e);
        assert.doesNotMatch(wrong.message, /nope/);
    } finally {
        auth = null;
    }
});

test('a proxy that is not there is an error with the proxy in it', async () => {
    const closed = createServer();
    await listen(closed);
    const port = closed.address().port;
    await new Promise((resolve) => closed.close(resolve));

    const e = await request(`${siteUrl}/api/v1/me`, {}, { env: { HTTPS_PROXY: `http://127.0.0.1:${port}` }, ca }).catch((error) => error);
    assert.equal(e.code, 'ECONNREFUSED');
    assert.match(e.message, new RegExp(`through the proxy 127\\.0\\.0\\.1:${port}`));
});
