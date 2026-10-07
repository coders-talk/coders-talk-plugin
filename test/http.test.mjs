import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as forward } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { connect, createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { proxyFor, request, trusted } from '../scripts/lib/http.mjs';

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

/**
 * A SOCKS5 proxy (RFC 1928, 1929): CONNECT by name or IPv4; with `socksAuth` set it wants that username and password.
 * What it was asked to reach goes into `seen`.
 */
let socksAuth = null;
const socks = createTcpServer((client) => {
    let buffer = Buffer.alloc(0);
    let stage = 'hello';
    const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (stage === 'hello' && buffer.length >= 2 + buffer[1]) {
            const methods = [...buffer.subarray(2, 2 + buffer[1])];
            buffer = buffer.subarray(2 + buffer[1]);
            const method = socksAuth ? (methods.includes(2) ? 2 : 255) : 0;
            client.write(Buffer.from([5, method]));
            if (method === 255) return client.end();
            stage = method === 2 ? 'auth' : 'connect';
        }
        if (stage === 'auth' && buffer.length >= 2 && buffer.length >= 3 + buffer[1] && buffer.length >= 3 + buffer[1] + buffer[2 + buffer[1]]) {
            const user = buffer.subarray(2, 2 + buffer[1]).toString();
            const password = buffer.subarray(3 + buffer[1], 3 + buffer[1] + buffer[2 + buffer[1]]).toString();
            buffer = buffer.subarray(3 + buffer[1] + buffer[2 + buffer[1]]);
            const ok = `${user}:${password}` === socksAuth;
            client.write(Buffer.from([1, ok ? 0 : 1]));
            if (!ok) return client.end();
            stage = 'connect';
        }
        if (stage === 'connect' && buffer.length >= 5) {
            const type = buffer[3];
            const length = type === 1 ? 4 : type === 3 ? 1 + buffer[4] : 16;
            if (buffer.length < 4 + length + 2) return;
            const host = type === 1 ? [...buffer.subarray(4, 8)].join('.') : buffer.subarray(5, 5 + buffer[4]).toString();
            const port = buffer.readUInt16BE(4 + length);
            const rest = buffer.subarray(4 + length + 2);
            seen.push(`SOCKS ${host}:${port}`);
            stage = 'done';
            client.removeListener('data', onData);
            const upstream = connect(port, host === 'localhost' ? '127.0.0.1' : host, () => {
                client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
                upstream.write(rest);
                upstream.pipe(client);
                client.pipe(upstream);
            });
            upstream.on('error', () => {
                client.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]));
            });
        }
    };
    client.on('data', onData);
    client.on('error', () => {});
});

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let siteUrl;
let plainUrl;
let proxyUrl;
let socksUrl;
before(async () => {
    await Promise.all([listen(site), listen(plainSite), listen(proxy), listen(socks)]);
    socksUrl = `socks5://127.0.0.1:${socks.address().port}`;
    siteUrl = `https://localhost:${site.address().port}`;
    plainUrl = `http://127.0.0.1:${plainSite.address().port}`;
    proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
});
after(() => [site, plainSite, proxy, socks].forEach((s) => s.close()));

const upload = (size) => {
    const form = new FormData();
    form.append('agent', 'claude-code');
    form.append('file', new Blob([Buffer.alloc(size, 7)], { type: 'application/gzip' }), 's.jsonl.gz');

    return form;
};

test('proxyFor reads HTTPS_PROXY, HTTP_PROXY, ALL_PROXY and NO_PROXY the way curl does', () => {
    const https = 'https://keepplain.com/api/v1/me';
    assert.equal(proxyFor(https, {}), null);
    assert.equal(proxyFor(https, { HTTPS_PROXY: 'http://127.0.0.1:2081' }).host, '127.0.0.1:2081');
    assert.equal(proxyFor(https, { https_proxy: '127.0.0.1:2081' }).href, 'http://127.0.0.1:2081/');
    assert.equal(proxyFor(https, { HTTP_PROXY: 'http://127.0.0.1:2081' }), null, 'HTTP_PROXY is for http:// sites');
    assert.equal(proxyFor('http://localhost:8000/x', { HTTP_PROXY: 'http://p:1' }).host, 'p:1');
    assert.equal(proxyFor(https, { ALL_PROXY: 'http://p:1' }).host, 'p:1');
    assert.equal(proxyFor(https, { HTTPS_PROXY: 'socks5://127.0.0.1:1080' }).protocol, 'socks5:');
    assert.equal(proxyFor(https, { ALL_PROXY: 'socks5h://u:p@127.0.0.1:1080' }).username, 'u');
    assert.equal(proxyFor(https, { HTTPS_PROXY: 'socks4://127.0.0.1:1080' }), null, 'socks4 is not ours to speak');
    assert.equal(proxyFor(https, { HTTPS_PROXY: '::not a url' }), null);

    const behind = { HTTPS_PROXY: 'http://p:1', HTTP_PROXY: 'http://p:1' };
    for (const noProxy of ['*', 'keepplain.com', '.keepplain.com', '*.com', 'localhost, keepplain.com', 'keepplain.com:443']) {
        assert.equal(proxyFor(https, { ...behind, NO_PROXY: noProxy }), null, noProxy);
    }
    for (const noProxy of ['localhost,127.0.0.1,::1,.local', 'com.keepplain', 'keepplain.com:8443']) {
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

test('through a SOCKS5 proxy (a VPN client in system-proxy mode): https upload by name, http site, and credentials', async () => {
    seen = [];
    socksAuth = null;
    const response = await request(`${siteUrl}/api/v1/imports`, { method: 'POST', headers: { Authorization: 'Bearer good' }, body: upload(1024 * 1024) }, { env: { HTTPS_PROXY: socksUrl }, ca });
    assert.equal(response.status, 202);
    const got = await response.json();
    assert.equal(got.has_file, true);
    assert.ok(got.size > 1024 * 1024);
    assert.deepEqual(seen, [`SOCKS localhost:${site.address().port}`], 'the site goes by its name, for the proxy to resolve');

    seen = [];
    socksAuth = 'mara:s3cret';
    const withAuth = socksUrl.replace('socks5://', 'socks5h://mara:s3cret@');
    const plain = await request(`${plainUrl}/api/v1/me?x=1`, { headers: { Authorization: 'Bearer good' } }, { env: { ALL_PROXY: withAuth } });
    assert.equal(plain.status, 202);
    assert.equal((await plain.json()).path, '/api/v1/me?x=1');
    assert.deepEqual(seen, [`SOCKS 127.0.0.1:${plainSite.address().port}`]);

    const wrong = socksUrl.replace('socks5://', 'socks5://mara:nope@');
    await assert.rejects(request(`${siteUrl}/api/v1/me`, {}, { env: { HTTPS_PROXY: wrong }, ca }), (e) => {
        assert.equal(e.code, 'EPROXYREFUSED');
        assert.match(e.message, /wrong username or password \(through the proxy 127\.0\.0\.1:\d+\)/);
        assert.doesNotMatch(e.message, /nope/);
        return true;
    });
    socksAuth = null;
});

test('proxy credentials from the URL are sent, and a refusal names the proxy without them', async () => {
    auth = 'mara:s3cr#t';
    try {
        const refused = await request(`${siteUrl}/api/v1/me`, {}, { env: { HTTPS_PROXY: proxyUrl }, ca }).catch((e) => e);
        assert.ok(refused instanceof Error);
        assert.match(refused.message, /the proxy answered 407 to CONNECT localhost:\d+ \(through the proxy 127\.0\.0\.1:\d+\)/);
        // The caller tells a refusal from a network that is down by these.
        assert.equal(refused.code, 'EPROXYREFUSED');
        assert.equal(refused.status, 407);

        const withAuth = proxyUrl.replace('http://', `http://mara:${encodeURIComponent('s3cr#t')}@`);
        const ok = await request(`${siteUrl}/api/v1/me`, { headers: { Authorization: 'Bearer good' } }, { env: { HTTPS_PROXY: withAuth }, ca });
        assert.equal(ok.status, 202);

        const wrong = await request(`${siteUrl}/api/v1/me`, {}, { env: { HTTPS_PROXY: proxyUrl.replace('http://', 'http://mara:nope@') }, ca }).catch((e) => e);
        assert.doesNotMatch(wrong.message, /nope/);
    } finally {
        auth = null;
    }
});

test('a proxy that looks inside TLS is trusted through the CA file the environment names', async () => {
    const cert = join(fixtures, 'tls-cert.pem');
    const env = { HTTPS_PROXY: proxyUrl };
    // The test site's own certificate stands in for the proxy's CA: without it the tunnel does not trust the site.
    const untrusted = await request(`${siteUrl}/api/v1/me`, {}, { env }).catch((e) => e);
    assert.ok(untrusted instanceof Error);

    for (const name of ['SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE']) {
        const response = await request(`${siteUrl}/api/v1/me`, { headers: { Authorization: 'Bearer good' } }, { env: { ...env, [name]: cert } });
        assert.equal(response.status, 202, name);
    }
});

test("the CA Claude Code on the web keeps in ~/.ccr is trusted, on top of Node's own", () => {
    const home = mkdtempSync(join(tmpdir(), 'ct-ccr-'));
    try {
        mkdirSync(join(home, '.ccr'));
        writeFileSync(join(home, '.ccr', 'ca-bundle.crt'), ca);
        const list = trusted({}, home);
        assert.ok(list.includes(ca.toString('utf8')));
        assert.ok(list.length > 100, "Node's own CAs stay in the list");
        // A file named but missing adds nothing and breaks nothing.
        assert.ok(trusted({ SSL_CERT_FILE: join(home, 'missing.pem') }, home).includes(ca.toString('utf8')));
    } finally {
        rmSync(home, { recursive: true, force: true });
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
