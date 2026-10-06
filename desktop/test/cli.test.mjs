// How the app runs coders-talk (src/main/cli.mjs): reading its JSON lines, telling a failure, and putting its own copy of
// the file in ~/.coders-talk/bin only when that one is missing or older. A small Node script stands in for the program.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cliEnv, CLI_NAME, ensureCli, LineReader, newer, runCli } from '../src/main/cli.mjs';

test('versions compare as numbers', () => {
    assert.equal(newer('0.14.10', '0.14.9'), true);
    assert.equal(newer('0.14.7', '0.14.7'), false);
    assert.equal(newer('0.13.9', '0.14.0'), false);
});

test('a line reader hands on whole JSON objects and keeps the other lines apart', () => {
    const got = [];
    const reader = new LineReader((o) => got.push(o));
    reader.push('{"event":"step","st');
    reader.push('atus":"running"}\r\nWARNING: something\n{"a":');
    reader.push('1}');
    reader.end();
    assert.deepEqual(got, [{ event: 'step', status: 'running' }, { a: 1 }]);
    assert.deepEqual(reader.other, ['WARNING: something']);
});

/** A stand-in program: node and a script that prints what $body says, given the arguments. */
function program(body) {
    const dir = mkdtempSync(join(tmpdir(), 'ct-app-cli-'));
    const script = join(dir, 'fake.mjs');
    writeFileSync(script, `const args = process.argv.slice(2);\n${body}\n`);

    return { run: (args, options = {}) => runCli(process.execPath, [script, ...args], options), dir };
}

test('runCli: events as they come, the result, and {"error"} as a failure with its details', async () => {
    const fake = program(`
        if (args[0] === 'status') console.log(JSON.stringify({ site: 'https://coders.talk', json: args.includes('--json') }));
        if (args[0] === 'enable') {
            console.log(JSON.stringify({ event: 'plan', steps: ['a'] }));
            console.log('not json');
            console.log(JSON.stringify({ event: 'done', installed: [] }));
        }
        if (args[0] === 'send') { console.log(JSON.stringify({ error: 'Nothing prepared to send.' })); process.exit(1); }
        if (args[0] === 'crash') { console.error('Segmentation fault'); process.exit(139); }
        if (args[0] === 'privacy') { let t = ''; process.stdin.on('data', (c) => (t += c)).on('end', () => console.log(JSON.stringify({ words: JSON.parse(t) }))); }
    `);

    const status = await fake.run(['status']);
    assert.deepEqual(status, { ok: true, result: { site: 'https://coders.talk', json: true }, events: [], error: null, details: null });

    const seen = [];
    const enable = await fake.run(['enable'], { onEvent: (e) => seen.push(e.event) });
    assert.equal(enable.ok, true);
    assert.deepEqual(seen, ['plan', 'done']);

    const send = await fake.run(['send']);
    assert.equal(send.ok, false);
    assert.equal(send.error, 'Nothing prepared to send.');

    const crash = await fake.run(['crash']);
    assert.equal(crash.ok, false);
    assert.equal(crash.error, 'Segmentation fault');

    const privacy = await fake.run(['privacy'], { input: '["Globex"]' });
    assert.deepEqual(privacy.result, { words: ['Globex'] });
});

test('runCli: a cancelled sign-in says so', async () => {
    const fake = program(`console.log(JSON.stringify({ event: 'opened', user_code: 'ABCD' })); setTimeout(() => {}, 60_000);`);
    const controller = new AbortController();
    const r = fake.run(['login'], { signal: controller.signal, onEvent: () => controller.abort() });
    const done = await r;
    assert.equal(done.cancelled, true);
    assert.equal(done.ok, false);
});

test('a program that is not there is an error, not a crash', async () => {
    const r = await runCli(join(tmpdir(), 'no-such-coders-talk'), ['status']);
    assert.equal(r.ok, false);
    assert.match(r.error, /Could not start coders-talk|ENOENT/);
});

test('the environment coders-talk gets has no agent in it, and the shell PATH', () => {
    const env = cliEnv({ CLAUDECODE: '1', CODEX_THREAD_ID: 'x', HOME: '/h', PATH: '/bin' }, '/opt/homebrew/bin:/bin');
    assert.equal(env.CLAUDECODE, undefined);
    assert.equal(env.CODEX_THREAD_ID, undefined);
    assert.equal(env.CODERS_TALK_NO_UPDATE_CHECK, '1');
    assert.equal(process.platform === 'win32' ? env.Path : env.PATH, '/opt/homebrew/bin:/bin');
});

/** A coders-talk file that says it is $version, and answers `nudge --json` in JSON unless $json is false (a shell script). */
function versioned(dir, version, { json = true, name = CLI_NAME } = {}) {
    mkdirSync(dir, { recursive: true });
    if (process.platform === 'win32') {
        // A real .exe cannot be faked here: runCli and versionOf spawn the file itself.
        return null;
    }
    const file = join(dir, name);
    const nudge = json ? `echo '{"nudge":true}'` : `echo 'The suggestion to share a session is on.'`;
    writeFileSync(file, `#!/bin/sh\nif [ "$1" = nudge ]; then ${nudge}; exit 0; fi\necho "coders-talk ${version}"\n`);
    chmodSync(file, 0o755);

    return file;
}

test('ensureCli puts the app\'s copy in ~/.coders-talk/bin when it is missing or older, and keeps a newer one', { skip: process.platform === 'win32' && 'needs an executable stand-in' }, () => {
    const home = mkdtempSync(join(tmpdir(), 'ct-app-home-'));
    const env = { ...process.env, CODERS_TALK_HOME: home };
    delete env.CODERS_TALK_APP_CLI;
    const bundled = versioned(join(home, 'app'), '0.15.0');

    const first = ensureCli({ bundled, env });
    assert.equal(first.action, 'installed');
    assert.equal(first.path, join(home, 'bin', CLI_NAME));
    assert.match(readFileSync(first.path, 'utf8'), /0\.15\.0/);

    versioned(join(home, 'bin'), '0.14.0');
    const updated = ensureCli({ bundled, env });
    assert.equal(updated.action, 'updated');
    assert.equal(updated.version, '0.15.0');

    versioned(join(home, 'bin'), '0.16.0');
    const kept = ensureCli({ bundled, env });
    assert.equal(kept.action, 'kept');
    assert.equal(kept.version, '0.16.0');
    assert.equal(existsSync(join(home, 'bin', `${CLI_NAME}.old`)), false);

    // The same version, but a build from before --json (the release the app's CLI shares its number with): replaced.
    versioned(join(home, 'bin'), '0.15.0', { json: false });
    const rebuilt = ensureCli({ bundled, env });
    assert.equal(rebuilt.action, 'updated');
    assert.match(readFileSync(rebuilt.path, 'utf8'), /"nudge":true/);
    // Now the very same file: left as it is.
    assert.equal(ensureCli({ bundled, env }).action, 'kept');
    // Another build under the same number that speaks JSON too (an earlier build of the app): the app's own goes in.
    writeFileSync(rebuilt.path, `${readFileSync(rebuilt.path, 'utf8')}# an earlier build\n`);
    assert.equal(ensureCli({ bundled, env }).action, 'updated');
    assert.equal(readFileSync(rebuilt.path, 'utf8'), readFileSync(bundled, 'utf8'));

    // Neither speaks JSON: said plainly, nothing replaced.
    const old = versioned(join(home, 'old-app'), '0.15.0', { json: false });
    versioned(join(home, 'bin'), '0.15.0', { json: false });
    assert.throws(() => ensureCli({ bundled: old, env }), /older than this app\. Run "coders-talk update"/);

    assert.throws(() => ensureCli({ bundled: null, env: { ...env, CODERS_TALK_HOME: join(home, 'empty') } }), /Could not find the coders-talk program/);
});
