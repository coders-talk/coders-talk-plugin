// coders-talk update (plan, stage 13.1) against a stand-in for the GitHub releases API. On the single file
// (npm run test:binary) it replaces a copy of that file; under Node it only says where the plugin is updated.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { assetName, newer, replaceExecutable } from '../scripts/lib/update.mjs';
import { BINARY, coders } from './helpers.mjs';

const run = promisify(execFile);
const dir = mkdtempSync(join(tmpdir(), 'ct-update-'));
// What the release serves as this platform's file, and what its SHA256SUMS says about it.
let served = Buffer.from('new file');
let sums = null;
const server = createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const assets = [assetName(), 'SHA256SUMS'].map((name) => ({ name, browser_download_url: `${base}/download/${name}` }));
    if (req.url === '/releases/latest') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ tag_name: 'coders-talk--v9.9.9', assets }));
    if (req.url === '/releases/tags/coders-talk--v1.0.0') return res.writeHead(404).end('{}');
    // GitHub sends release files elsewhere: the update follows.
    if (req.url.startsWith('/download/')) return res.writeHead(302, { Location: req.url.replace('/download/', '/objects/') }).end();
    if (req.url === `/objects/${assetName()}`) return res.writeHead(200).end(served);
    if (req.url === '/objects/SHA256SUMS') return res.writeHead(200).end(sums ?? `${createHash('sha256').update(served).digest('hex')}  ${assetName()}\n`);
    res.writeHead(404).end();
});

let env;
before(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    env = { ...process.env, CODERS_TALK_HOME: join(dir, 'ct'), CODERS_TALK_RELEASES_URL: `http://127.0.0.1:${server.address().port}/releases`, CODERS_TALK_NO_UPDATE_CHECK: '1' };
    for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) delete env[name], delete env[name.toLowerCase()];
});
after(() => server.close());

test('versions compare by number, and each platform has its file', () => {
    assert.equal(newer('0.10.0', '0.9.9'), true);
    assert.equal(newer('1.0.0', '1.0.0'), false);
    assert.equal(newer('0.9.10', '0.10.0'), false);
    assert.equal(assetName('win32', 'x64'), 'coders-talk-windows-x64.exe');
    assert.equal(assetName('darwin', 'arm64'), 'coders-talk-darwin-arm64');
});

test('the file is put in place of the old one; on Windows the old one steps aside', () => {
    const file = join(dir, 'replace-me');
    writeFileSync(file, 'old');
    replaceExecutable(file, Buffer.from('new'));
    assert.equal(readFileSync(file, 'utf8'), 'new');
    assert.equal(existsSync(`${file}.old`), process.platform === 'win32');
    assert.equal(existsSync(`${file}.new`), false);
});

test('update --check notes the latest release for the notice, quietly', async () => {
    const { stdout } = await run(...coders(['update', '--check']), { env });
    assert.equal(stdout, '');
    assert.equal(JSON.parse(readFileSync(join(dir, 'ct', 'update.json'), 'utf8')).latest, '9.9.9');
});

test('the plugin from an agent is updated there', { skip: BINARY !== null }, async () => {
    const r = await run(...coders(['update']), { env }).then(() => assert.fail('should refuse'), (e) => e.stderr);
    assert.match(r, /installed from the agent: it is updated there/);
});

test('the single file replaces itself with the release, checked against SHA256SUMS', { skip: BINARY === null }, async () => {
    const copy = join(dir, assetName());
    copyFileSync(BINARY, copy);
    // The release serves the very same program, so the updated copy still runs.
    served = readFileSync(BINARY);

    sums = `${'0'.repeat(64)}  ${assetName()}\n`;
    const bad = await run(copy, ['update'], { env }).then(() => assert.fail('should refuse'), (e) => e.stderr);
    assert.match(bad, /does not match the SHA256SUMS of release 9\.9\.9\. Nothing was changed\./);
    assert.equal(existsSync(`${copy}.old`), false);

    sums = null;
    const { stdout } = await run(copy, ['update'], { env });
    assert.match(stdout, /Updated coders-talk \d+\.\d+\.\d+ → 9\.9\.9\./);
    assert.match((await run(copy, ['version'], { env })).stdout, /^coders-talk /);
    // Removed at the first start after the update.
    assert.equal(existsSync(`${copy}.old`), false);

    const missing = await run(copy, ['update', '1.0.0'], { env }).then(() => assert.fail('should fail'), (e) => e.stderr);
    assert.match(missing, /There is no release 1\.0\.0\./);
});
