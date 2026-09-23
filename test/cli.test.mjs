// preview → send → whoami against a stand-in for the Coders Talk API, with a throwaway Claude Code config folder.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { makeRepo } from './helpers.mjs';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/coders-talk.mjs', import.meta.url));
const id = 'a1b2c3d4-0000-4000-8000-000000000001';
const TOKEN = 'ct_' + 'k'.repeat(48);

const home = mkdtempSync(join(tmpdir(), 'ct-cli-'));
const temp = join(home, 'tmp');
mkdirSync(temp);
mkdirSync(join(home, 'projects', 'C--code-shop'), { recursive: true });
const transcript = join(home, 'projects', 'C--code-shop', `${id}.jsonl`);
copyFileSync(fileURLToPath(new URL('./fixtures/slim/claude-code.jsonl', import.meta.url)), transcript);
// The plugin's own run, as Claude Code writes it: it must not be sent.
appendFileSync(transcript, JSON.stringify({ type: 'user', message: { role: 'user', content: '<command-message>coders-talk:build</command-message>\n<command-name>/coders-talk:build</command-name>' } }) + '\n');
appendFileSync(transcript, JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: 'SKILL BODY MARKER' } }) + '\n');

// The session ran in a repository: the hook remembered HEAD before its two commits.
const repo = makeRepo();
mkdirSync(join(home, 'ct', 'sessions'), { recursive: true });
writeFileSync(join(home, 'ct', 'sessions', `${id}.json`), JSON.stringify({ session_id: id, cwd: repo.dir, head: repo.hashes[0] }));

let received = null;
let importsDown = false;
let polls = 0;
let tokenPolls = 0;
const server = createServer((req, res) => {
    const reply = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));

    // Browser sign-in: no token yet. The person "approves" on the second poll.
    if (req.method === 'POST' && req.url === '/api/v1/device/codes') {
        return reply(201, { device_code: 'device-secret', user_code: 'WDJB-MJHT', verification_url: `http://127.0.0.1:${server.address().port}/connect`, verification_url_complete: `http://127.0.0.1:${server.address().port}/connect/01request`, expires_in: 600, interval: 0 });
    }
    if (req.method === 'POST' && req.url === '/api/v1/device/token') {
        const body = [];
        req.on('data', (c) => body.push(c));
        return req.on('end', () => {
            if (JSON.parse(Buffer.concat(body).toString()).device_code !== 'device-secret') return reply(404, { error: { code: 'not_found', message: 'Not found.' } });

            return reply(200, ++tokenPolls < 2 ? { status: 'pending', interval: 0 } : { status: 'approved', token: TOKEN, username: 'mara' });
        });
    }

    if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { error: { code: 'invalid_token', message: 'The token is missing, revoked or wrong.' } });

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
        const base = `http://127.0.0.1:${server.address().port}`;
        const links = { build_slug: 'draft-x', edit_url: `${base}/b/draft-x/edit`, status_url: `${base}/api/v1/imports/imp1` };
        if (req.method === 'GET' && req.url === '/api/v1/me') return reply(200, { username: 'mara', token: { name: 'laptop' } });
        if (req.method === 'POST' && req.url === '/api/v1/imports') {
            if (importsDown) return reply(503, { error: { code: 'unavailable', message: 'Coders Talk is down for maintenance.' } });
            received = Buffer.concat(chunks);
            const series = received.includes('name="continues"') ? { slug: 'rate-limits', title: 'Rate limits', url: `${base}/s/rate-limits` } : null;
            return reply(202, { status: 'queued', stage: null, reused: false, series, ...links });
        }
        if (req.method === 'GET' && req.url === '/api/v1/imports/imp1') {
            polls++;
            return reply(200, polls < 2
                ? { status: 'running', stage: 'labeling', ...links }
                : { status: 'done', stage: null, result: { turns: 9, secrets: 1, warnings: 0, moments_created: true, label_error: null }, ...links });
        }
        reply(404, { error: { code: 'not_found', message: 'Not found.' } });
    });
});

let env;
before(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    env = { ...process.env, CLAUDE_CONFIG_DIR: home, TMPDIR: temp, TEMP: temp, TMP: temp, CODERS_TALK_URL: `http://127.0.0.1:${server.address().port}`, CODERS_TALK_POLL_MS: '10', CODERS_TALK_HOME: join(home, 'ct'), CODERS_TALK_NO_BROWSER: '1', CODERS_TALK_LOGIN_WAIT_MS: '5000' };
    delete env.CODERS_TALK_TOKEN;
    delete env.CLAUDE_PLUGIN_OPTION_TOKEN;
});
after(() => server.close());

const cli = (args, extra = {}) => run(process.execPath, [script, ...args], { env: { ...env, ...extra } }).then(
    ({ stdout }) => ({ ok: true, out: stdout }),
    (e) => ({ ok: false, out: e.stdout + e.stderr }),
);

test('login opens the approval link, --wait collects the token and saves it for this site only', async () => {
    const notYet = await cli(['whoami']);
    assert.equal(notYet.ok, false);
    assert.match(notYet.out, /not connected .* yet\. Run \/coders-talk:login/);

    // Step one returns at once with the link, so Claude can show it before anything waits.
    const r = await cli(['login']);
    assert.equal(r.ok, true, r.out);
    assert.match(r.out, /Opened http:\/\/127\.0\.0\.1:\d+\/connect\/01request in the browser\. Check that the page shows the code WDJB-MJHT and press Connect\./);
    assert.doesNotMatch(r.out, /Connected to/);
    assert.equal(tokenPolls, 0, 'the first step does not wait');

    const waited = await cli(['login', '--wait']);
    assert.equal(waited.ok, true, waited.out);
    assert.match(waited.out, /Connected to http:\/\/127\.0\.0\.1:\d+ as @mara/);
    assert.doesNotMatch(r.out + waited.out, new RegExp(TOKEN), 'the token is never printed');

    const saved = JSON.parse(readFileSync(join(home, 'ct', 'credentials.json'), 'utf8'));
    assert.deepEqual(Object.keys(saved), [env.CODERS_TALK_URL]);
    assert.equal(saved[env.CODERS_TALK_URL].token, TOKEN);
    assert.equal(existsSync(join(home, 'ct', 'login-pending.json')), false);

    assert.match((await cli(['login'])).out, /Already connected .* as @mara/);
});

test('Codex login reaches the API despite a stale sandbox network flag', async () => {
    const r = await cli(['login', '--agent=codex'], { CODERS_TALK_HOME: join(home, 'fresh-codex'), CODEX_SANDBOX_NETWORK_DISABLED: '1' });
    assert.equal(r.ok, true, r.out);
    assert.match(r.out, /Opened http:.*WDJB-MJHT/);
});

test('Codex reports actual permission errors without mislabeling DNS failures', async () => {
    for (const code of ['EACCES', 'EPERM', 'ENOTFOUND']) {
        const preload = join(home, `fetch-${code}.mjs`);
        writeFileSync(preload, `globalThis.fetch = async () => {
            const cause = Object.assign(new Error('lookup failed'), { code: '${code}' });
            throw new TypeError('fetch failed', { cause: ${code === 'EACCES' ? 'new AggregateError([cause])' : 'cause'} });
        };`);
        const result = await run(process.execPath, ['--import', pathToFileURL(preload).href, script, 'login', '--agent=codex'], {
            env: { ...env, CODERS_TALK_HOME: join(home, 'failed-codex'), CODEX_SANDBOX_NETWORK_DISABLED: '1' },
        }).then(() => assert.fail('request should fail'), (e) => e.stdout + e.stderr);
        if (code === 'ENOTFOUND') {
            assert.match(result, /Could not reach .*lookup failed/);
            assert.doesNotMatch(result, /was denied/);
        } else {
            assert.match(result, /Network access .* was denied/);
        }
    }
});

test('send refuses without a preview', async () => {
    const r = await cli(['send', id]);
    assert.equal(r.ok, false);
    assert.match(r.out, /Run the preview step first/);
});

test('preview prints what will go, then send uploads exactly that and waits for the draft', async () => {
    const preview = await cli(['preview', id]);
    assert.equal(preview.ok, true, preview.out);
    assert.match(preview.out, /Project: +shop/);
    assert.match(preview.out, /Prompts: +2, tool calls: 2/);
    assert.match(preview.out, /compressed/);
    assert.ok(
        preview.out.includes('Git:        https://github.com/mara/shop (linked on the Build only if the repository is public), branch main; 2 commits in this session, 1 file +2 −0. Commit titles are sent, the diff is not.'),
        preview.out,
    );
    const prepared = join(temp, 'coders-talk', `${id}.jsonl.gz`);
    const gz = readFileSync(prepared);
    const sentLater = gunzipSync(gz).toString('utf8');
    assert.doesNotMatch(sentLater, /SKILL BODY MARKER|coders-talk:build/);
    assert.doesNotMatch(sentLater, /file-history-snapshot|iVBORw0KGgoAAAA/);

    const send = await cli(['send', id, '--continues=https://coders.talk/b/first-part']);
    assert.equal(send.ok, true, send.out);
    assert.match(send.out, /Draft created: http:\/\/127\.0\.0\.1:\d+\/b\/draft-x\/edit/);
    assert.match(send.out, /Linked as the next part of the series "Rate limits": http:\/\/127\.0\.0\.1:\d+\/s\/rate-limits/);
    assert.match(send.out, /Proposing moments/);
    assert.match(send.out, /Imported 9 turns, with suggested moments/);
    assert.match(send.out, /1 possible secret redacted/);

    // The multipart body carries the prepared gzip unchanged, and the preview file is gone.
    assert.ok(received.includes(gz));
    assert.match(received.toString('latin1'), /name="session_id"\r\n\r\na1b2c3d4-0000-4000-8000-000000000001/);
    assert.match(received.toString('latin1'), /name="agent"\r\n\r\nclaude-code/);
    assert.match(received.toString('latin1'), /name="continues"\r\n\r\nhttps:\/\/coders\.talk\/b\/first-part/);
    const git = JSON.parse(received.toString('utf8').match(/name="git"\r\n\r\n(.*)\r\n/)[1]);
    assert.equal(git.remote, 'https://github.com/mara/shop');
    assert.equal(git.head_start, repo.hashes[0]);
    assert.deepEqual(git.commits.subjects, ['Cover the limiter with tests', 'Add a limiter keyed by email']);
    assert.equal(existsSync(prepared), false);
});

test('when the site is down, send points at the upload page and keeps the prepared file for it', async () => {
    assert.equal((await cli(['preview', id])).ok, true);
    const prepared = join(temp, 'coders-talk', `${id}.jsonl.gz`);

    importsDown = true;
    const down = await cli(['send', id]).finally(() => (importsDown = false));
    assert.equal(down.ok, false);
    assert.match(down.out, /down for maintenance\.\nUpload it by hand instead: open http:\/\/127\.0\.0\.1:\d+\/new and drop this file/);
    assert.ok(down.out.includes(prepared), down.out);
    assert.equal(existsSync(prepared), true);

    // A refusal about the upload itself is not a reason to try the upload page.
    const bad = await cli(['send', id], { CODERS_TALK_TOKEN: 'ct_wrong' });
    assert.match(bad.out, /not accepted/);
    assert.doesNotMatch(bad.out, /by hand/);

    assert.equal((await cli(['send', id])).ok, true, 'the kept file goes once the site is back');
});

test('a Codex session: found by CODEX_THREAD_ID, HEAD at the start from session_meta, the skill run cut', async () => {
    const thread = '01a0b8a6-9f98-7701-8110-1a2556f5b096';
    const codexHome = join(home, 'codex');
    const day = join(codexHome, 'sessions', '2026', '09', '01');
    mkdirSync(day, { recursive: true });
    const rollout = join(day, `rollout-2026-09-01T10-00-00-${thread}.jsonl`);
    const fixture = readFileSync(fileURLToPath(new URL('./fixtures/slim/codex.jsonl', import.meta.url)), 'utf8').trim().split('\n').slice(1);
    const meta = { timestamp: '2026-09-01T10:00:00.000Z', type: 'session_meta', payload: { id: thread, cwd: repo.dir, git: { commit_hash: repo.hashes[0], branch: 'main' } } };
    const skill = { timestamp: '2026-09-01T10:05:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<skill>\n<name>coders-talk:build</name>\n<path>/p/codex/skills/build/SKILL.md</path>\nCODEX SKILL BODY\n</skill>' }] } };
    writeFileSync(rollout, [JSON.stringify(meta), ...fixture, JSON.stringify(skill)].join('\n') + '\n');
    const codex = { CODEX_HOME: codexHome, CODEX_THREAD_ID: thread };

    const preview = await cli(['preview', '--agent=codex'], codex);
    assert.equal(preview.ok, true, preview.out);
    assert.match(preview.out, /Prompts: +3, tool calls: 5/);
    assert.match(preview.out, /2 commits in this session/);
    assert.doesNotMatch(preview.out, /Claude Code/);
    const gz = readFileSync(join(temp, 'coders-talk', `${thread}.jsonl.gz`));
    const sent = gunzipSync(gz).toString('utf8');
    assert.doesNotMatch(sent, /CODEX SKILL BODY|base64/);
    assert.match(sent, /turn_aborted/);

    // Escalated commands can retain this flag even when the network is available.
    const send = await cli(['send', '--agent=codex'], { ...codex, CODEX_SANDBOX_NETWORK_DISABLED: '1' });
    assert.equal(send.ok, true, send.out);
    const body = received.toString('latin1');
    assert.match(body, /name="agent"\r\n\r\ncodex/);
    assert.match(body, new RegExp(`name="session_id"\\r\\n\\r\\n${thread}`));
    const git = JSON.parse(received.toString('utf8').match(/name="git"\r\n\r\n(.*)\r\n/)[1]);
    assert.equal(git.head_start, repo.hashes[0]);
    assert.equal(git.head_start_estimated, undefined);
    assert.ok(received.includes(gz));
});

test('whoami reports the account, or explains a bad token', async () => {
    assert.match((await cli(['whoami'])).out, /as @mara \(token "laptop"\)/);

    // A token in the environment wins over the saved one.
    const bad = await cli(['whoami'], { CODERS_TALK_TOKEN: 'ct_wrong' });
    assert.equal(bad.ok, false);
    assert.match(bad.out, /not accepted .* Run \/coders-talk:login/);
    assert.doesNotMatch(bad.out, /ct_wrong/);

    // Another site has its own sign-in.
    const other = await cli(['whoami', '--site=https://other.example']);
    assert.match(other.out, /not connected to https:\/\/other\.example yet/);
    // An unexpanded ${user_config.url} placeholder is ignored.
    assert.match((await cli(['whoami', '--site=${user_config.url}'])).out, /as @mara/);

    // Without CODERS_TALK_URL the plugin's "url" option is read from Claude Code's settings.json.
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ pluginConfigs: { 'coders-talk@coders-talk': { options: { url: env.CODERS_TALK_URL } } } }));
    assert.match((await cli(['whoami'], { CODERS_TALK_URL: '' })).out, /as @mara/);
    // Codex does not use the Claude Code plugin's option: only CODERS_TALK_URL or the default.
    assert.match((await cli(['whoami', '--agent=codex'], { CODERS_TALK_URL: '' })).out, /not connected to https:\/\/coders\.talk yet/);
    assert.match((await cli(['whoami', '--agent=codex'])).out, /as @mara/);
    writeFileSync(join(home, 'settings.json'), '{}');
    assert.match((await cli(['whoami'], { CODERS_TALK_URL: '' })).out, /not connected to https:\/\/coders\.talk yet/);
});

test('logout forgets the token on this computer', async () => {
    assert.match((await cli(['logout'])).out, /Signed out of .* remove it under Settings/);
    assert.match((await cli(['whoami'])).out, /not connected/);
    assert.match((await cli(['logout'])).out, /was not signed in/);
});

test('an unknown session is reported, not guessed', async () => {
    const r = await cli(['preview', '00000000-0000-0000-0000-000000000000']);
    assert.equal(r.ok, false);
    assert.match(r.out, /Could not find this session/);
});
