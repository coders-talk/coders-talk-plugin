// preview → send → whoami against a stand-in for the Coders Talk API, with a throwaway Claude Code config folder.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, request as forward } from 'node:http';
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
// Every import request's body, for tests that send more than one.
const bodies = [];
let importsDown = false;
let alreadyPublished = false;
// The next import request finds the session's last sync still being imported.
let busyOnce = false;
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
        if (req.method === 'GET' && req.url === '/api/v1/me') {
            return reply(200, { username: 'mara', token: { name: 'laptop' }, teams: [{ slug: 'acme', name: 'Acme', github_owners: ['acme-inc'], auto_capture: true }] });
        }
        if (req.method === 'POST' && req.url === '/api/v1/imports') {
            if (importsDown) return reply(503, { error: { code: 'unavailable', message: 'Coders Talk is down for maintenance.' } });
            if (busyOnce) {
                busyOnce = false;
                return reply(409, { error: { code: 'import_running', message: 'This session is still being imported. Wait for it to finish.' } });
            }
            received = Buffer.concat(chunks);
            bodies.push(received.toString('latin1'));
            if (alreadyPublished) return reply(200, { status: 'skipped', reason: 'published', build_slug: 'shipped' });
            const series = received.includes('name="continues"') ? { slug: 'rate-limits', title: 'Rate limits', url: `${base}/s/rate-limits` } : null;
            // The site's routing, in short: a named space, else the team whose repository it is, else private.
            const body = received.toString('utf8');
            const named = body.match(/name="space"\r\n\r\n([^\r]+)/)?.[1];
            const team = named ? named !== 'personal' : /github\.com\/acme-inc\//i.test(body);
            const space = team ? { type: 'team', slug: 'acme', name: 'Acme' } : { type: 'personal', slug: null, name: 'Private' };
            return reply(202, { status: 'queued', stage: null, reused: false, series, space, ...links });
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
    // The machine's own proxy stays out of these; the proxy test sets one.
    for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY']) {
        delete env[name];
        delete env[name.toLowerCase()];
    }
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
    assert.match(preview.out, /Prompts: +2, tool calls: 5/);
    assert.match(preview.out, /compressed/);
    // mara/shop is not one of the team's repositories: the draft stays with its sender.
    assert.match(preview.out, /Goes to: +your private Builds: only you see the draft/);
    // Counted before slimming dropped them: only the numbers go.
    assert.match(preview.out, /Tokens: +10 \(claude-opus-5-5\); only the counts are sent/);
    // The files the agent changed go as diffs, an env file by its name only (plan, stage 11.1).
    assert.match(preview.out, /Code: +4 files \(\+323 −2\), as diffs; \.env by name only/);
    assert.ok(
        preview.out.includes('Git:        https://github.com/mara/shop (linked on the Build only if the repository is public), branch main; 2 commits in this session, 1 file +2 −0. Commit titles are sent, not the commits.'),
        preview.out,
    );
    const prepared = join(temp, 'coders-talk', `${id}.jsonl.gz`);
    const gz = readFileSync(prepared);
    const sentLater = gunzipSync(gz).toString('utf8');
    assert.doesNotMatch(sentLater, /SKILL BODY MARKER|coders-talk:build/);
    assert.doesNotMatch(sentLater, /file-history-snapshot|iVBORw0KGgoAAAA/);

    const send = await cli(['send', id, '--continues=https://coders.talk/b/first-part']);
    assert.equal(send.ok, true, send.out);
    assert.match(send.out, /Draft created \(private: only you see it\): http:\/\/127\.0\.0\.1:\d+\/b\/draft-x\/edit/);
    assert.match(send.out, /Review and publish: /);
    assert.match(send.out, /Linked as the next part of the series "Rate limits": http:\/\/127\.0\.0\.1:\d+\/s\/rate-limits/);
    assert.match(send.out, /Proposing moments/);
    assert.match(send.out, /Imported 9 turns, with suggested moments/);
    assert.match(send.out, /1 possible secret redacted/);

    // The multipart body carries the prepared gzip unchanged, and the preview file is gone.
    assert.ok(received.includes(gz));
    assert.match(received.toString('latin1'), /name="session_id"\r\n\r\na1b2c3d4-0000-4000-8000-000000000001/);
    assert.match(received.toString('latin1'), /name="agent"\r\n\r\nclaude-code/);
    assert.match(received.toString('latin1'), /name="continues"\r\n\r\nhttps:\/\/coders\.talk\/b\/first-part/);
    assert.match(received.toString('latin1'), /name="trigger"\r\n\r\nmanual/);
    const usage = JSON.parse(received.toString('utf8').match(/name="usage"\r\n\r\n(.*)\r\n/)[1]);
    assert.deepEqual(usage, { models: { 'claude-opus-5-5': { input: 10, output: 0, cache_read: 0, cache_write: 0 } } });
    const git = JSON.parse(received.toString('utf8').match(/name="git"\r\n\r\n(.*)\r\n/)[1]);
    assert.equal(git.remote, 'https://github.com/mara/shop');
    assert.equal(git.head_start, repo.hashes[0]);
    assert.deepEqual(git.commits.subjects, ['Cover the limiter with tests', 'Add a limiter keyed by email']);
    assert.equal(existsSync(prepared), false);
});

test('a session in a team repository goes to the team, unless the person keeps it private', async () => {
    const work = 'a1b2c3d4-0000-4000-8000-000000000002';
    const acme = makeRepo('git@github.com:Acme-Inc/billing.git');
    copyFileSync(transcript, join(home, 'projects', 'C--code-shop', `${work}.jsonl`));
    writeFileSync(join(home, 'ct', 'sessions', `${work}.json`), JSON.stringify({ session_id: work, cwd: acme.dir, head: acme.hashes[0] }));

    const preview = await cli(['preview', work]);
    assert.equal(preview.ok, true, preview.out);
    assert.match(preview.out, /Goes to: +the Acme team, because acme-inc\/\* is the team's: the team sees the draft, nobody else\. Add --private/);
    const send = await cli(['send', work]);
    assert.match(send.out, /Draft created in Acme \(the team sees it, nobody else\): /);
    assert.match(send.out, /Review it: /);
    assert.doesNotMatch(received.toString('latin1'), /name="space"/, 'the site routes by the repository itself');

    assert.match((await cli(['preview', work, '--private'])).out, /Goes to: +your private Builds/);
    assert.match((await cli(['send', work])).out, /private: only you see it/);
    assert.match(received.toString('latin1'), /name="space"\r\n\r\npersonal/);

    assert.match((await cli(['preview', id, '--team=acme'])).out, /Goes to: +the Acme team: the team sees the draft/);
    assert.equal((await cli(['send', id])).ok, true);
    assert.match(received.toString('latin1'), /name="space"\r\n\r\nacme/);

    const unknown = await cli(['preview', id, '--team=globex']);
    assert.equal(unknown.ok, false);
    assert.match(unknown.out, /not in a team called "globex"\. Your teams: acme\./);
});

test('auto mode is off until the person turns it on, and then sends a session that ended by itself', async () => {
    const autoFile = join(home, 'ct', 'auto.json');
    const logPath = join(home, 'ct', 'auto.log');
    assert.match((await cli(['auto'])).out, /Auto mode is off for .*: sessions are sent only when you run \/coders-talk:build/);
    received = null;
    await cli(['auto-send', id]);
    assert.equal(received, null, 'off means nothing leaves the machine');

    const on = await cli(['auto', 'on']);
    assert.equal(on.ok, true, on.out);
    assert.match(on.out, /Auto mode is on\. Claude Code sessions on this computer are sent to .* as @mara by themselves, every ten minutes while they run and once more when they end/);
    assert.equal(JSON.parse(readFileSync(autoFile, 'utf8'))[env.CODERS_TALK_URL].mode, 'all');

    const sent = await cli(['auto-send', id]);
    assert.equal(sent.out, '', 'auto-send prints nothing: nobody is watching');
    const body = received.toString('latin1');
    assert.match(body, /name="trigger"\r\n\r\nauto/);
    assert.match(body, /name="final"\r\n\r\n1/);
    assert.doesNotMatch(body, /name="space"/);
    // The session ended by itself: nothing is cut off its end.
    const gz = received.subarray(received.indexOf(Buffer.from([0x1f, 0x8b])), received.lastIndexOf('\r\n--'));
    assert.match(gunzipSync(gz).toString('utf8'), /SKILL BODY MARKER/);
    assert.match(readFileSync(logPath, 'utf8'), new RegExp(`${id} sent to your private Builds: http`));

    alreadyPublished = true;
    await cli(['auto-send', id]).finally(() => (alreadyPublished = false));
    assert.match(readFileSync(logPath, 'utf8'), new RegExp(`${id} skipped: already published`));
    assert.match((await cli(['auto'])).out, /Last sessions it looked at/);

    // Team mode sends only what a team asks for.
    assert.match((await cli(['auto', 'team'])).out, /Sessions in repositories of Acme \(acme-inc\/\*\) are sent to the team while they run and when they end\. Everything else stays on this computer\./);
    received = null;
    await cli(['auto-send', id]);
    assert.equal(received, null);
    assert.match(readFileSync(logPath, 'utf8'), /skipped: not a repository of a team that asks for automatic sending/);
    await cli(['auto-send', 'a1b2c3d4-0000-4000-8000-000000000002']);
    assert.match(received.toString('latin1'), /name="space"\r\n\r\nacme/);

    assert.match((await cli(['auto', 'sometimes'])).out, /Use \/coders-talk:auto on/);
    // Codex has its own switch: turning Claude Code's off leaves it on, and the other way round.
    assert.match((await cli(['auto', 'on', '--agent=codex'])).out, /Codex runs a plugin's hooks only once you trust them: type \/hooks/);
    assert.match((await cli(['auto', 'off'])).out, /Auto mode is off in Claude Code/);
    assert.equal(JSON.parse(readFileSync(autoFile, 'utf8'))[env.CODERS_TALK_URL].codex.mode, 'all');
    assert.match((await cli(['auto', 'off', '--agent=codex'])).out, /Auto mode is off in Codex/);
    assert.equal(JSON.parse(readFileSync(autoFile, 'utf8'))[env.CODERS_TALK_URL], undefined);
});

test('the SessionEnd hook hands the session to auto-send only when auto mode is on', async () => {
    const hook = fileURLToPath(new URL('../scripts/session-end.mjs', import.meta.url));
    const fire = () => new Promise((resolve, reject) => {
        const child = execFile(process.execPath, [hook], { env }, (error) => (error ? reject(error) : resolve()));
        child.stdin.end(JSON.stringify({ session_id: id, reason: 'prompt_input_exit', hook_event_name: 'SessionEnd' }));
    });
    const logPath = join(home, 'ct', 'auto.log');
    await cli(['auto', 'off']);
    const lines = () => (existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length : 0);

    const before = lines();
    await fire();
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(lines(), before, 'off: the hook does nothing');

    await cli(['auto', 'on']);
    await fire();
    // The upload runs after the hook returned; wait for its line in the log.
    for (let i = 0; i < 50 && lines() === before; i++) await new Promise((r) => setTimeout(r, 200));
    assert.equal(lines(), before + 1);
    await cli(['auto', 'off']);
});

const hookRun = (name, event) => new Promise((resolve, reject) => {
    const hook = fileURLToPath(new URL(`../scripts/${name}.mjs`, import.meta.url));
    const child = execFile(process.execPath, [hook], { env: { ...env, CODERS_TALK_RETRY_MS: '10' } }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
    child.stdin.end(JSON.stringify(event));
});
const autoLog = () => (existsSync(join(home, 'ct', 'auto.log')) ? readFileSync(join(home, 'ct', 'auto.log'), 'utf8') : '');
const sessionsState = () => JSON.parse(readFileSync(join(home, 'ct', 'auto-sessions.json'), 'utf8'))[env.CODERS_TALK_URL] ?? {};
/** Waits for the background upload the hook started, by its line in the log. */
async function logged(pattern) {
    for (let i = 0; i < 50 && !pattern.test(autoLog()); i++) await new Promise((r) => setTimeout(r, 200));
    assert.match(autoLog(), pattern);
}
/** Pretends auto mode saw the session a while ago, as the hooks would have written it. */
function sawSession(sessionId, path, agoMs) {
    const file = join(home, 'ct', 'auto-sessions.json');
    const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    all[env.CODERS_TALK_URL] = { ...all[env.CODERS_TALK_URL], [sessionId]: { path, seen: Date.now() - agoMs } };
    writeFileSync(file, JSON.stringify(all));
}

test('the Stop hook syncs a running session every ten minutes of work, as still going', async () => {
    await cli(['auto', 'on']);
    const event = { session_id: id, transcript_path: transcript, hook_event_name: 'Stop' };

    bodies.length = 0;
    assert.equal(await hookRun('stop', event), '', 'hooks print nothing');
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(bodies.length, 0, 'a session that just started is not synced: its end sends it');
    assert.equal(sessionsState()[id].path, transcript);

    sawSession(id, transcript, 11 * 60_000);
    await hookRun('stop', event);
    await logged(new RegExp(`${id} synced, still going, to your private Builds: http`));
    assert.match(bodies.at(-1), /name="final"\r\n\r\n0/);
    const sent = sessionsState()[id].sent;
    assert.equal(sent.final, false);
    assert.equal(sent.size, statSync(transcript).size);

    // Nothing new since: the next answer sends nothing.
    await hookRun('stop', event);
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(bodies.length, 1);

    // The end of the session waits for the last sync to be imported.
    busyOnce = true;
    await cli(['auto-send', id], { CODERS_TALK_RETRY_MS: '10' });
    assert.equal(busyOnce, false);
    assert.equal(bodies.length, 2);
    assert.match(bodies.at(-1), /name="final"\r\n\r\n1/);
    assert.equal(sessionsState()[id].sent.final, true);

    // Turned off, it forgets the sessions it saw: turned on later, it never sends what grew in between.
    await cli(['auto', 'off']);
    assert.deepEqual(sessionsState(), {});
});

test('the next start catches up on sessions that never said they ended', async () => {
    await cli(['auto', 'on']);
    const fixture = fileURLToPath(new URL('./fixtures/slim/claude-code.jsonl', import.meta.url));
    const ids = { quiet: 'a1b2c3d4-0000-4000-8000-0000000000c1', recent: 'a1b2c3d4-0000-4000-8000-0000000000c2', busy: 'a1b2c3d4-0000-4000-8000-0000000000c3' };
    const ages = { quiet: 40, recent: 5, busy: 0 };
    for (const [key, sessionId] of Object.entries(ids)) {
        const path = join(home, 'projects', 'C--code-shop', `${sessionId}.jsonl`);
        copyFileSync(fixture, path);
        const at = new Date(Date.now() - ages[key] * 60_000);
        utimesSync(path, at, at);
        sawSession(sessionId, path, 60 * 60_000);
    }
    // Never seen by auto mode: stays on this computer whatever its age.
    const unseen = join(home, 'projects', 'C--code-shop', 'a1b2c3d4-0000-4000-8000-0000000000c4.jsonl');
    copyFileSync(fixture, unseen);
    utimesSync(unseen, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));

    bodies.length = 0;
    const start = { session_id: id, transcript_path: transcript, source: 'startup', hook_event_name: 'SessionStart' };
    assert.equal(await hookRun('session-start', start), '', 'a SessionStart hook prints nothing: it would reach the model');
    await logged(new RegExp(`${ids.recent} synced, still going, to your private Builds at the next start: http`));
    assert.match(autoLog(), new RegExp(`${ids.quiet} sent to your private Builds at the next start: http`));

    assert.equal(bodies.length, 2, 'the busy one is open somewhere else and its own hooks send it; the current one is just starting');
    assert.match(bodies[0], new RegExp(`name="session_id"\r\n\r\n${ids.quiet}`));
    assert.match(bodies[0], /name="final"\r\n\r\n1/);
    assert.match(bodies[1], new RegExp(`name="session_id"\r\n\r\n${ids.recent}`));
    assert.match(bodies[1], /name="final"\r\n\r\n0/);
    assert.doesNotMatch(bodies.join('\n'), /0000000000c4/);

    // Caught up: the next start has nothing to send.
    await hookRun('session-start', start);
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(bodies.length, 2);
    await cli(['auto', 'off']);
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
    assert.match(preview.out, /Prompts: +3, tool calls: 7/);
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

test('the git snapshots of a session go with it, in place, instead of its own edits', async () => {
    const { takeSnapshot } = await import('../scripts/lib/snapshots.mjs');
    const other = 'a1b2c3d4-0000-4000-8000-000000000011';
    const repoDir = makeRepo().dir;
    copyFileSync(fileURLToPath(new URL('./fixtures/slim/claude-code.jsonl', import.meta.url)), join(home, 'projects', 'C--code-shop', `${other}.jsonl`));
    // At the fixture's own times: the prompt at 10:00:00, the answer by 10:05:00.
    const snap = (kind, at) => takeSnapshot({ session_id: other, cwd: repoDir }, kind, { dir: join(home, 'ct', 'snapshots'), now: Date.parse(at) });
    snap('start', '2026-09-01T09:59:50Z');
    snap('prompt', '2026-09-01T10:00:00Z');
    writeFileSync(join(repoDir, 'app.txt'), 'rewritten by a formatter\n');
    snap('stop', '2026-09-01T10:05:01Z');

    const preview = await cli(['preview', other]);
    assert.equal(preview.ok, true, preview.out);
    assert.match(preview.out, /Code: +1 file \(\+1 −3\), as diffs from git snapshots/);
    const sent = gunzipSync(readFileSync(join(temp, 'coders-talk', `${other}.jsonl.gz`))).toString('utf8').split('\n').map((l) => JSON.parse(l));
    const git = sent.findIndex((d) => d.type === 'git-changes');
    assert.equal(sent[git].by, 'agent');
    assert.deepEqual(sent[git].changes.map((c) => c.path), ['app.txt']);
    // After the answer it belongs to, at the end of the session here.
    assert.equal(git, sent.length - 1);
});

test('with HTTP_PROXY set the requests go through the proxy', async () => {
    const seen = [];
    const proxy = createServer((req, res) => {
        seen.push(`${req.method} ${req.url}`);
        const target = new URL(req.url);
        req.pipe(forward({ host: target.hostname, port: target.port, path: target.pathname, method: req.method, headers: req.headers }, (upstream) => {
            res.writeHead(upstream.statusCode, upstream.headers);
            upstream.pipe(res);
        }));
    });
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    try {
        const r = await cli(['whoami'], { HTTP_PROXY: `http://127.0.0.1:${proxy.address().port}` });
        assert.match(r.out, /as @mara/, r.out);
        assert.deepEqual(seen, [`GET ${env.CODERS_TALK_URL}/api/v1/me`]);
    } finally {
        proxy.close();
    }
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
