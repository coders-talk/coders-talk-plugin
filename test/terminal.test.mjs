// Sending from a terminal (plan, stage 13.4): `coders-talk sessions` lists this folder's Claude Code and Codex
// sessions, `coders-talk build <#>` previews, asks and sends. The question needs a real terminal: where `script` can
// give the program one (Linux, macOS), the whole round runs in it; nothing lets a script answer it otherwise.
import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { coders } from './helpers.mjs';

const run = promisify(execFile);
const fixture = (name) => fileURLToPath(new URL(`./fixtures/slim/${name}`, import.meta.url));
const TOKEN = 'ct_' + 't'.repeat(48);
const claudeId = 'a1b2c3d4-0000-4000-8000-0000000000c1';
const codexId = '01a0d9a1-c59d-7d13-a259-942f9e79aa01';

const home = mkdtempSync(join(tmpdir(), 'ct-term-'));
// The folder the sessions ran in, as the agents write it (no symlinked temp folder on macOS).
const work = realpathSync(mkdtempSync(join(tmpdir(), 'ct-work-')));

// Claude Code: <config>/projects/<the folder, every other character as "-">/<id>.jsonl, active an hour ago.
const project = join(home, 'claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
mkdirSync(project, { recursive: true });
copyFileSync(fixture('claude-code.jsonl'), join(project, `${claudeId}.jsonl`));
utimesSync(join(project, `${claudeId}.jsonl`), new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
// Codex: a rollout of today whose session_meta names the folder; and one of another folder.
const now = new Date();
const day = join(home, 'codex', 'sessions', String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), String(now.getUTCDate()).padStart(2, '0'));
mkdirSync(day, { recursive: true });
const codexLines = readFileSync(fixture('codex.jsonl'), 'utf8').trim().split('\n');
const meta = JSON.parse(codexLines[0]);
const rollout = (id, cwd) => [JSON.stringify({ ...meta, payload: { ...meta.payload, id, cwd } }), ...codexLines.slice(1)].join('\n') + '\n';
writeFileSync(join(day, `rollout-2026-09-26T08-00-00-${codexId}.jsonl`), rollout(codexId, work));
writeFileSync(join(day, 'rollout-2026-09-26T08-00-00-01a0d9a1-c59d-7d13-a259-942f9e79aa02.jsonl'), rollout('01a0d9a1-c59d-7d13-a259-942f9e79aa02', join(work, '..', 'elsewhere')));

const imports = [];
const server = createServer((req, res) => {
    const reply = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { error: { code: 'invalid_token', message: 'No.' } });
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
        const base = `http://127.0.0.1:${server.address().port}`;
        const links = { build_slug: 'draft-t', edit_url: `${base}/b/draft-t/edit`, status_url: `${base}/api/v1/imports/imp-t` };
        if (req.url === '/api/v1/me') return reply(200, { username: 'mara', token: { name: 'cli' }, teams: [] });
        if (req.method === 'POST' && req.url === '/api/v1/imports') {
            imports.push(Buffer.concat(chunks).toString('utf8'));
            return reply(202, { status: 'queued', reused: false, space: { type: 'personal' }, ...links });
        }
        if (req.url === '/api/v1/imports/imp-t') return reply(200, { status: 'done', result: { turns: 3 }, ...links });
        reply(404, { error: { code: 'not_found', message: 'Not found.' } });
    });
});

let env;
before(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const site = `http://127.0.0.1:${server.address().port}`;
    mkdirSync(join(home, 'ct'));
    writeFileSync(join(home, 'ct', 'credentials.json'), JSON.stringify({ [site]: { token: TOKEN, username: 'mara' } }));
    env = { ...process.env, CLAUDE_CONFIG_DIR: join(home, 'claude'), CODEX_HOME: join(home, 'codex'), CODERS_TALK_HOME: join(home, 'ct'), CODERS_TALK_URL: site, CODERS_TALK_POLL_MS: '10', CODERS_TALK_NO_BROWSER: '1', CODERS_TALK_NO_UPDATE_CHECK: '1', TMPDIR: home, TEMP: home, TMP: home };
    for (const name of ['CODERS_TALK_TOKEN', 'CODERS_TALK_AUTO', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[name];
});
after(() => server.close());

const cli = (args) => run(...coders(args), { env, cwd: work }).then(({ stdout }) => ({ ok: true, out: stdout }), (e) => ({ ok: false, out: e.stdout + e.stderr }));

test('sessions lists both agents\' sessions of this folder, newest first, and what was sent', async () => {
    const r = await cli(['sessions']);
    assert.equal(r.ok, true, r.out);
    const rows = r.out.split('\n').filter((l) => /^ {2}\d/.test(l));
    assert.equal(rows.length, 2, r.out);
    assert.match(rows[0], /^ {2}1 +today \d\d:\d\d +Codex +3 +- +Fix the flaky checkout test\./);
    assert.match(rows[1], /^ {2}2 +\S+ \d\d:\d\d +Claude Code +2 +- +Add rate limiting to \/api\/login\. Keep the tests green\./);
    assert.doesNotMatch(r.out, /aa02/, 'another folder\'s session is not listed');
    assert.match(r.out, /Send one: coders-talk build <#>/);

    // A folder with nothing.
    const empty = await run(...coders(['sessions']), { env, cwd: home }).then(({ stdout }) => stdout);
    assert.match(empty, /No Claude Code or Codex sessions with prompts in /);
});

test('build refuses without a terminal and says what a script can run instead', async () => {
    const r = await cli(['build', '2']);
    assert.equal(r.ok, false);
    assert.match(r.out, /runs only in a terminal\. From a script: coders-talk preview <session-id> \[--agent=codex\], then coders-talk send <session-id>/);
    assert.equal(imports.length, 0);
});

const plain = (text) => text.replace(/\x1B\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');

/** $args run in a pseudo-terminal by `script`, with $input typed into it; null where `script` cannot do that. */
function inTerminal(args, input) {
    if (process.platform === 'win32') return null;
    const [program, programArgs] = coders(args);
    const quoted = [program, ...programArgs].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
    const linux = spawnSync('script', ['--version'], { encoding: 'utf8' }).stdout?.includes('util-linux');
    const scriptArgs = linux ? ['-qec', quoted, '/dev/null'] : ['-q', '/dev/null', 'sh', '-c', quoted];
    if (spawnSync('script', linux ? ['-qec', 'true', '/dev/null'] : ['-q', '/dev/null', 'true']).status !== 0) return null;

    return new Promise((resolve) => {
        const child = spawn('script', scriptArgs, { env, cwd: work });
        let out = '';
        child.stdout.on('data', (d) => {
            out += d;
            // Readline moves the cursor after its question, so the escape codes go first. `script` waits for its
            // input to end before it exits.
            if (/\[y\/N\]$/.test(plain(out).trimEnd()) && child.stdin.writable) child.stdin.end(input);
        });
        const stuck = setTimeout(() => child.kill(), 60_000);
        child.on('close', (status) => {
            clearTimeout(stuck);
            resolve({ status, out: plain(out) });
        });
    });
}

test('build in a terminal: the preview, the question, and only a yes sends', async (t) => {
    const no = await inTerminal(['build', '2'], 'n\n');
    if (no === null) return t.skip('no pseudo-terminal here');
    assert.match(no.out, /Session #2: Claude Code, .*"Add rate limiting/);
    assert.match(no.out, /Ready to send to http:\/\/127\.0\.0\.1:\d+/);
    assert.match(no.out, /Send this session to http:\/\/127\.0\.0\.1:\d+\? \[y\/N\]/);
    assert.match(no.out, /Nothing was sent\./);
    assert.equal(imports.length, 0);

    const yes = await inTerminal(['build', '2'], 'y\n');
    assert.equal(yes.status, 0, yes.out);
    assert.match(yes.out, /Draft created.*\/b\/draft-t\/edit/);
    assert.equal(imports.length, 1);
    assert.match(imports[0], /name="session_id"\r\n\r\na1b2c3d4-0000-4000-8000-0000000000c1/);

    const listed = await cli(['sessions']);
    assert.match(listed.out.split('\n').find((l) => l.includes('Claude Code')), / yes +Add rate limiting/);

    const codex = await inTerminal(['build'], 'y\n');
    assert.match(codex.out, /Session #1: Codex/);
    assert.match(imports[1], /name="agent"\r\n\r\ncodex/);
});
