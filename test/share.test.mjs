// `coders-talk share` (coders.talk github-distribution-plan, stage 39): a published Build in its pull request and the
// README, against a stand-in for the site's /api/v1/share and a stand-in for the GitHub CLI, in a throwaway repository.
// And the share auto mode: the SessionStart hook puts published Builds into their pull requests in the background.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { promisify } from 'node:util';
import { ghProblem, shareCheckDue, withPrBlock, withReadmeBlock } from '../scripts/lib/share.mjs';
import { coders, hookCommand, waitFor } from './helpers.mjs';

const run = promisify(execFile);
const SLUG = 'ported-the-dsp-web-app-to-android-k3x9q';
const DRAFT = 'still-a-draft-p2m7w';
const SESSION = '0b5e2c1a-7d4f-4e2b-9a3c-6f1d8e2b4a70';
const REPO = 'https://github.com/acme/shop';
const PR = `${REPO}/pull/12`;
const TOKEN = 'ct_test_token';

const prBlock = [`<!-- coders-talk:build ${SLUG} -->`, '### How this change was built', '', '**Ported the DSP web app to Android**  ', '6h 24m · 1 human intervention', '', `[See how this change was built →](http://127.0.0.1/b/${SLUG}?utm_source=github&utm_medium=pr&utm_campaign=build)`, '<!-- /coders-talk:build -->'].join('\n');
const readmeBlock = ['<!-- coders-talk:repo -->', '## Built with AI', '', '[![Built with AI on Coders Talk](http://127.0.0.1/embed/r/acme/shop.svg)](http://127.0.0.1/r/acme/shop)', '<!-- /coders-talk:repo -->'].join('\n');

function kit(extra = {}) {
    return {
        status: 'published', published: true, slug: SLUG, title: 'Ported the DSP web app to Android', url: `http://127.0.0.1/b/${SLUG}`,
        pr_url: null, repo: REPO, branch: 'feat/android',
        share: { numbers: ['6h 24m', '1 human intervention'], pr: prBlock, readme: readmeBlock, profile: '[![My agent sessions](x)](y)', links: {} },
        attachments: [],
        ...extra,
    };
}

let autoPr = false;
let pendingAsked = 0;
const attachments = [];
const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const send = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: { code: 'invalid_token', message: 'no' } });
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/v1/me') return send(200, { username: 'mara', token: { name: 'laptop' }, teams: [], share: { auto_pr: autoPr } });
    if (url.pathname === '/api/v1/share' && req.method === 'GET') {
        const build = url.searchParams.get('build');
        if (build === DRAFT) return send(200, { status: 'draft', published: false, slug: DRAFT, title: 'Still a draft', edit_url: `http://127.0.0.1/b/${DRAFT}/edit` });
        if (build === SLUG || url.searchParams.get('session_id') === SESSION) return send(200, kit());
        return send(404, { error: { code: 'not_found', message: 'No Build of yours at that address.' } });
    }
    if (url.pathname === '/api/v1/share/attachments') {
        attachments.push(JSON.parse(body));
        // Answered after a moment, as a real site does: the auto mode test must wait for what its background run does
        // once the answer is in, not only for the request.
        await new Promise((r) => setTimeout(r, 300));
        return send(201, { attachment: JSON.parse(body), linked: JSON.parse(body).target === 'pr' });
    }
    if (url.pathname === '/api/v1/share/settings') {
        autoPr = JSON.parse(body).auto_pr;
        return send(200, { auto_pr: autoPr });
    }
    if (url.pathname === '/api/v1/share/pending') {
        pendingAsked++;
        assert.equal(url.searchParams.get('repo'), REPO);
        return send(200, { auto_pr: autoPr, builds: autoPr ? [kit()] : [] });
    }
    send(404, { error: { code: 'not_found', message: 'Not found' } });
});

// The GitHub CLI's stand-in: pull requests in a JSON file, every call noted. On Windows a .cmd, which runs only through a
// shell, as the enable tests stand in for claude and codex.
const home = mkdtempSync(join(tmpdir(), 'ct-share-'));
const ghState = join(home, 'gh.json');
const ghBin = join(home, process.platform === 'win32' ? 'gh.cmd' : 'gh');
writeFileSync(join(home, 'gh.mjs'), `
import { readFileSync, writeFileSync } from 'node:fs';
const file = ${JSON.stringify(ghState)};
const state = JSON.parse(readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
state.calls.push(args.join(' '));
const save = () => writeFileSync(file, JSON.stringify(state));
const pick = (pr) => ({ url: pr.url, number: pr.number, title: pr.title, body: pr.body, state: pr.state });
const option = (name) => args[args.indexOf(name) + 1];
if (args[0] === '--version') { save(); console.log('gh version 2.60.0'); process.exit(0); }
if (args[0] === 'auth') { save(); process.exit(state.signedIn ? 0 : 1); }
if (args[0] === 'pr' && args[1] === 'view') {
    const url = args[2] && !args[2].startsWith('--') ? args[2] : null;
    const pr = state.prs.find((p) => (url ? p.url === url : p.branch === state.checkedOut));
    save();
    if (!pr) { console.error('no pull requests found'); process.exit(1); }
    console.log(JSON.stringify(pick(pr))); process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'list') {
    const found = state.prs.filter((p) => 'https://github.com/' + option('--repo') === p.repo && p.branch === option('--head') && (option('--state') === 'all' || p.state === 'OPEN'));
    save(); console.log(JSON.stringify(found.slice(0, 1).map(pick))); process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'edit') {
    const pr = state.prs.find((p) => p.url === args[2]);
    pr.body = readFileSync(0, 'utf8');
    save(); console.log(args[2]); process.exit(0);
}
save(); process.exit(1);
`);
if (process.platform === 'win32') writeFileSync(ghBin, `@"${process.execPath}" "${join(home, 'gh.mjs')}" %*\r\n`);
else {
    writeFileSync(ghBin, `#!/bin/sh\nexec "${process.execPath}" "${join(home, 'gh.mjs')}" "$@"\n`);
    chmodSync(ghBin, 0o755);
}
const gh = () => JSON.parse(readFileSync(ghState, 'utf8'));

let repo;
let env;
before(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    env = { ...process.env, CODERS_TALK_URL: `http://127.0.0.1:${server.address().port}`, CODERS_TALK_TOKEN: TOKEN, CODERS_TALK_HOME: join(home, 'ct'), CODERS_TALK_GH: ghBin, CLAUDE_CONFIG_DIR: join(home, 'claude'), CODEX_HOME: join(home, 'codex'), CODERS_TALK_NO_UPDATE_CHECK: '1', CODERS_TALK_NO_BROWSER: '1' };
    for (const name of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID', 'CODEX_THREAD_ID', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[name];
});
after(() => server.close());
beforeEach(() => {
    autoPr = false;
    pendingAsked = 0;
    attachments.length = 0;
    repo = realpathSync(mkdtempSync(join(home, 'repo-')));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/shop.git'], { cwd: repo });
    writeFileSync(join(repo, 'README.md'), '# Shop\n\nA shop.\n');
    writeFileSync(ghState, JSON.stringify({ signedIn: true, checkedOut: 'feat/android', calls: [], prs: [{ url: PR, number: 12, title: 'Android port', body: 'Ports the app.\r\n\r\nCloses #3.', state: 'OPEN', repo: REPO, branch: 'feat/android' }] }));
    // Nothing known about auto mode yet: a fresh computer. (Not the CLI: it would wait on this very process's server.)
    rmSync(join(home, 'ct', 'share.json'), { force: true });
});

const cli = (args, extra = {}) => run(...coders(['share', ...args]), { env: { ...env, ...extra }, cwd: repo }).then(({ stdout }) => ({ ok: true, out: stdout }), (e) => ({ ok: false, out: e.stdout + e.stderr }));

test('blocks go between their markers: replaced when there, added after a blank line otherwise, line endings kept', () => {
    const once = withPrBlock('Ports the app.\r\n\r\nCloses #3.', SLUG, prBlock);
    assert.match(once, /^Ports the app\.\r\n\r\nCloses #3\.\r\n\r\n<!-- coders-talk:build /);
    assert.ok(once.includes('\r\n### How this change was built\r\n'));
    assert.equal(withPrBlock(once, SLUG, prBlock), once, 'the same block again changes nothing');
    const newer = withPrBlock(once, SLUG, prBlock.replace('6h 24m', '6h 30m'));
    assert.equal((newer.match(/<!-- coders-talk:build /g) ?? []).length, 1);
    assert.ok(newer.includes('6h 30m') && !newer.includes('6h 24m'));
    // Another Build's block in the same pull request stays.
    const two = withPrBlock(once, 'another-build-a1b2c', prBlock.replaceAll(SLUG, 'another-build-a1b2c'));
    assert.equal((two.match(/<!-- coders-talk:build /g) ?? []).length, 2);
    assert.equal(withPrBlock('', SLUG, prBlock), `${prBlock}\n`);

    const readme = withReadmeBlock('# Shop\n', readmeBlock);
    assert.equal(readme, `# Shop\n\n${readmeBlock}\n`);
    assert.equal(withReadmeBlock(readme.replace('Built with AI', 'Old'), readmeBlock), readme);
});

test("gh is found in PATH as the agents' CLIs are: on Windows by PATHEXT, a .cmd through a shell", () => {
    const bin = join(home, 'bin');
    mkdirSync(bin, { recursive: true });
    copyFileSync(ghBin, join(bin, basename(ghBin)));
    chmodSync(join(bin, basename(ghBin)), 0o755);
    // Only PATH says where gh is: no CODERS_TALK_GH, and Windows' own Path out of the way.
    const pathEnv = Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== 'PATH' && key !== 'CODERS_TALK_GH'));

    assert.equal(ghProblem({ env: { ...pathEnv, PATH: [bin, process.env.PATH].join(delimiter) } }), null);
    assert.deepEqual(gh().calls, ['--version', 'auth status']);
    assert.match(ghProblem({ env: { ...pathEnv, PATH: join(home, 'nothing-here') } }) ?? '', /install gh \(https:\/\/cli\.github\.com\)/);
});

test('alone it shows the Build and what can go where; a draft is not shared', async () => {
    const shown = await cli([SLUG]);
    assert.equal(shown.ok, true, shown.out);
    assert.match(shown.out, /"Ported the DSP web app to Android" · 6h 24m · 1 human intervention/);
    assert.match(shown.out, /### How this change was built/);
    assert.match(shown.out, new RegExp(`share ${SLUG} --pr`));
    assert.deepEqual(gh().calls, [], 'nothing asked of GitHub');

    const draft = await cli([DRAFT, '--pr', '--write']);
    assert.equal(draft.ok, false);
    assert.match(draft.out, /not published yet, so nothing goes to GitHub\. Publish it first: http:\/\/127\.0\.0\.1\/b\/still-a-draft-p2m7w\/edit/);
    assert.deepEqual(gh().calls, []);

    // Inside a session, the session's own Build.
    assert.match((await cli([], { CLAUDE_CODE_SESSION_ID: SESSION })).out, /Ported the DSP web app/);
    const none = await cli([]);
    assert.equal(none.ok, false);
    assert.match(none.out, /Which Build\?/);
});

test('--pr shows the change first, and --write makes it with gh, keeping the rest of the description', async () => {
    const shown = await cli([SLUG, '--pr']);
    assert.equal(shown.ok, true, shown.out);
    assert.match(shown.out, /The pull request: https:\/\/github\.com\/acme\/shop\/pull\/12 \(#12 Android port\)/);
    assert.match(shown.out, /Adds the block "How this change was built"/);
    assert.match(shown.out, /Nothing is changed yet: the same command with --write changes the description\./);
    assert.equal(gh().prs[0].body, 'Ports the app.\r\n\r\nCloses #3.');
    assert.deepEqual(attachments, []);
    // Found by the session's branch in its repository.
    assert.ok(gh().calls.includes('pr list --repo acme/shop --head feat/android --state all --limit 1 --json url,number,title,body,state'));

    const written = await cli([SLUG, '--pr', '--write']);
    assert.equal(written.ok, true, written.out);
    assert.match(written.out, /Done: https:\/\/github\.com\/acme\/shop\/pull\/12/);
    assert.match(written.out, /The Build links to the pull request now/);
    const body = gh().prs[0].body;
    assert.ok(body.startsWith('Ports the app.\r\n\r\nCloses #3.\r\n\r\n<!-- coders-talk:build '), body);
    assert.deepEqual(attachments, [{ build: SLUG, target: 'pr', url: PR }]);

    const again = await cli([SLUG, '--pr', '--write']);
    assert.match(again.out, /The block is already there, unchanged\./);
    assert.equal(gh().prs[0].body, body);
    assert.equal(gh().calls.filter((c) => c.startsWith('pr edit')).length, 1);
});

test('without a pull request or without gh it says what to do, and gives the block to paste', async () => {
    writeFileSync(ghState, JSON.stringify({ ...gh(), prs: [] }));
    const none = await cli([SLUG, '--pr', '--write']);
    assert.equal(none.ok, false);
    assert.match(none.out, /No pull request found for this session \(branch feat\/android\)\. Open one first \(gh pr create\), or name it/);
    assert.match(none.out, /Or paste the block into the description by hand:\n<!-- coders-talk:build /);

    const missing = await cli([SLUG, '--pr', '--write'], { CODERS_TALK_GH: join(home, 'no-such-gh') });
    assert.equal(missing.ok, false);
    assert.match(missing.out, /install gh \(https:\/\/cli\.github\.com\)/);

    writeFileSync(ghState, JSON.stringify({ ...gh(), signedIn: false }));
    assert.match((await cli([SLUG, '--pr'])).out, /not signed in: run gh auth login/);
    assert.deepEqual(attachments, []);
});

test('--readme writes the section into the working tree only, and says where it went', async () => {
    const shown = await cli([SLUG, '--readme']);
    assert.match(shown.out, /Goes to: README\.md \(added at the end\)/);
    assert.equal(readFileSync(join(repo, 'README.md'), 'utf8'), '# Shop\n\nA shop.\n');

    const written = await cli([SLUG, '--readme', '--write']);
    assert.equal(written.ok, true, written.out);
    assert.match(written.out, /Written: README\.md\. Nothing is committed/);
    assert.equal(readFileSync(join(repo, 'README.md'), 'utf8'), `# Shop\n\nA shop.\n\n${readmeBlock}\n`);
    assert.equal(execFileSync('git', ['log', '--oneline', '--all'], { cwd: repo, encoding: 'utf8' }).trim(), '', 'nothing committed');
    assert.deepEqual(attachments, [{ build: SLUG, target: 'readme', url: REPO }]);
    assert.match((await cli([SLUG, '--readme', '--write'])).out, /already has the section, unchanged/);
});

test('auto mode: off, nothing leaves; on, the session start puts the Build into its pull request and says so next time', async () => {
    const start = () => new Promise((resolve, reject) => {
        const child = execFile(...hookCommand('session-start'), { env }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
        child.stdin.end(JSON.stringify({ session_id: SESSION, cwd: repo, hook_event_name: 'SessionStart', source: 'startup' }));
    });

    // Not known to be on: the start asks nothing, and no repository's address goes anywhere.
    assert.equal(await start(), '');
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(pendingAsked, 0);

    const on = await cli(['auto', 'on']);
    assert.match(on.out, /^On: when a session starts in a public repository/);
    assert.equal(autoPr, true);
    assert.equal(shareCheckDue(env.CODERS_TALK_URL, repo, join(home, 'ct')), true);

    assert.equal(await start(), '');
    // The background run tells the site, then notes the notice and, last, the log line: wait for that one.
    const log = join(home, 'ct', 'auto.log');
    await waitFor(() => existsSync(log) && readFileSync(log, 'utf8').includes(`share ${SLUG}: attached to ${PR}`));
    assert.match(readFileSync(log, 'utf8'), new RegExp(`share ${SLUG}: attached to ${PR}`));
    assert.deepEqual(attachments, [{ build: SLUG, target: 'pr', url: PR, auto: true }]);
    assert.ok(gh().prs[0].body.includes(`<!-- coders-talk:build ${SLUG} -->`));

    // The next start tells, once, and does not check again within the hour.
    const said = JSON.parse(await start());
    assert.match(said.systemMessage, /Coders Talk put your Build "Ported the DSP web app to Android" into https:\/\/github\.com\/acme\/shop\/pull\/12 \(auto mode/);
    assert.equal(await start(), '');
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(pendingAsked, 1);

    // Switched off on the site: the next preview's /api/v1/me or whoami tells this computer.
    autoPr = false;
    await run(...coders(['whoami']), { env, cwd: repo });
    assert.equal(shareCheckDue(env.CODERS_TALK_URL, join(repo, 'elsewhere'), join(home, 'ct')), false);
    assert.ok(existsSync(join(home, 'ct', 'share.json')));
});
