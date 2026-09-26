// coders-talk enable, disable, status and the refresh after an update (plan, stage 13.3), against stand-ins for the
// claude and codex commands (fixtures/fake-agent.mjs) and throwaway config folders. On Windows the stand-ins are
// .cmd files, the way npm installs claude.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { coders } from './helpers.mjs';

const run = promisify(execFile);
const fake = fileURLToPath(new URL('./fixtures/fake-agent.mjs', import.meta.url));
const SITE = 'https://coders.talk';

let dir;
let env;
const plugin = () => join(dir, 'ct', 'plugin');
const agentState = () => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
const calls = () => readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
// Outside any repository: enable would ask about the git hooks of the one it runs in (test/githooks.test.mjs).
const cli = (args) => run(...coders(args), { env, cwd: dir }).then(({ stdout }) => ({ ok: true, out: stdout }), (e) => ({ ok: false, out: e.stdout + e.stderr }));

/** A fresh computer with Claude Code and Codex, and nothing of Coders Talk. */
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ct-enable-'));
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    for (const agent of ['claude', 'codex']) {
        if (process.platform === 'win32') writeFileSync(join(bin, `${agent}.cmd`), `@"${process.execPath}" "${fake}" ${agent} %*\r\n`);
        else {
            writeFileSync(join(bin, agent), `#!/bin/sh\nexec "${process.execPath}" "${fake}" ${agent} "$@"\n`);
            chmodSync(join(bin, agent), 0o755);
        }
    }
    writeFileSync(join(dir, 'state.json'), '{}');
    writeFileSync(join(dir, 'calls.log'), '');
    mkdirSync(join(dir, 'claude'));
    mkdirSync(join(dir, 'codex'));
    env = {
        ...process.env,
        // Only the stand-ins: the computer's own claude and codex stay out of it.
        PATH: bin,
        CLAUDE_CONFIG_DIR: join(dir, 'claude'),
        CODEX_HOME: join(dir, 'codex'),
        CODERS_TALK_HOME: join(dir, 'ct'),
        FAKE_AGENT_STATE: join(dir, 'state.json'),
        FAKE_AGENT_LOG: join(dir, 'calls.log'),
        CODERS_TALK_NO_UPDATE_CHECK: '1',
    };
    delete env.Path;
    delete env.CODERS_TALK_URL;
    delete env.CODERS_TALK_AUTO;
});

test('enable asks first: without a terminal it needs --yes', async () => {
    const r = await cli(['enable']);
    assert.equal(r.ok, false);
    assert.match(r.out, /asks before it changes anything: run it in a terminal, or add --yes/);
    assert.equal(existsSync(plugin()), false);
    assert.deepEqual(calls(), []);
});

test('enable lays the plugin out and installs it in both agents from the local marketplace', async () => {
    const r = await cli(['enable', '--yes']);
    assert.equal(r.ok, true, r.out);
    assert.match(r.out, /Claude Code +\S+claude(\.cmd)?; no Coders Talk plugin/);
    assert.match(r.out, /- Claude Code: install coders-talk@coders-talk-local/);
    assert.match(r.out, /- Auto mode: off \(as it is\)/);
    assert.match(r.out, /Claude Code: coders-talk@coders-talk-local \S+ is installed\. Restart Claude Code/);
    assert.match(r.out, /Not signed in to https:\/\/coders\.talk yet: run coders-talk login\./);

    const [program, fixed] = coders([]);
    const hooks = JSON.parse(readFileSync(join(plugin(), 'hooks', 'hooks.json'), 'utf8')).hooks;
    assert.deepEqual(hooks.Stop[0].hooks[0], { type: 'command', command: program, args: [...fixed, 'hook', 'claude-code', 'stop'], timeout: 10 });
    assert.ok(existsSync(join(plugin(), '.mcp.json')));
    assert.ok(existsSync(join(plugin(), 'codex', 'skills', 'build', 'SKILL.md')));

    const state = agentState();
    assert.deepEqual(Object.keys(state.claude.plugins), ['coders-talk@coders-talk-local']);
    assert.deepEqual(Object.keys(state.codex.plugins), ['coders-talk@coders-talk-local']);
    assert.equal(state.claude.marketplaces['coders-talk-local'], plugin());

    // Again: the marketplace is there already, the plugin is updated.
    writeFileSync(join(dir, 'calls.log'), '');
    assert.match((await cli(['enable', '--yes'])).out, /- Claude Code: update coders-talk@coders-talk-local/);
    const again = calls().map((c) => `${c.agent} ${c.args.join(' ')}`);
    assert.ok(again.includes('claude plugin update coders-talk@coders-talk-local'), again.join('\n'));
    assert.ok(!again.some((c) => c.includes('marketplace add')), 'added once');

    const status = await cli(['status']);
    assert.match(status.out, /Claude Code +coders-talk@coders-talk-local \S+; auto mode off/);
    assert.match(status.out, /Codex +coders-talk@coders-talk-local \S+; auto mode off/);
});

test('the plugin from GitHub is replaced, and a server added by hand removed or kept', async () => {
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ claude: { plugins: { 'coders-talk@coders-talk': '0.10.0' }, marketplaces: { 'coders-talk': '/x' }, mcp: ['library'] }, codex: { plugins: {}, marketplaces: {}, mcp: ['ct'] } }));
    writeFileSync(join(dir, 'claude', '.claude.json'), JSON.stringify({ mcpServers: { library: { type: 'http', url: 'https://coders.talk/mcp' }, other: { url: 'https://example.com/mcp' } }, projects: { [dir]: { mcpServers: { lib2: { type: 'http', url: 'https://coders.talk/mcp/' } } } } }));
    writeFileSync(join(dir, 'codex', 'config.toml'), '[mcp_servers.ct]\nurl = "https://coders.talk/mcp"\n\n[mcp_servers.other]\nurl = "https://example.com/mcp"\n');

    const status = await cli(['status']);
    assert.match(status.out, /Claude Code +coders-talk@coders-talk 0\.10\.0; MCP server added by hand: library, lib2 \(in .+\)/);

    const kept = await cli(['enable', '--yes']);
    assert.equal(kept.ok, true, kept.out);
    assert.match(kept.out, /- Claude Code: uninstall coders-talk@coders-talk\n/);
    assert.match(kept.out, /- Claude Code: install coders-talk@coders-talk-local, without its MCP server/);
    assert.equal(existsSync(join(plugin(), '.mcp.json')), false);
    assert.equal(JSON.parse(readFileSync(join(plugin(), '.codex-plugin', 'plugin.json'), 'utf8')).mcpServers, undefined);
    assert.deepEqual(Object.keys(agentState().claude.plugins), ['coders-talk@coders-talk-local']);
    assert.deepEqual(agentState().claude.mcp, ['library'], 'kept by default');

    const removed = await cli(['enable', '--yes', '--mcp=remove']);
    assert.equal(removed.ok, true, removed.out);
    assert.deepEqual(agentState().claude.mcp, []);
    assert.deepEqual(agentState().codex.mcp, []);
    const local = calls().find((c) => c.args.join(' ') === 'mcp remove lib2 --scope local');
    assert.equal(local.cwd.toLowerCase(), dir.toLowerCase(), 'a local-scope server is removed in its project');
    assert.ok(existsSync(join(plugin(), '.mcp.json')), 'the plugin brings its own now');
});

test('auto mode is one choice for both agents; push needs the git hooks', async () => {
    const push = await cli(['enable', '--yes', '--auto=push']);
    assert.match(push.out, /Auto mode is push: .*only those whose commits you push/);
    assert.match(push.out, /Push mode sends from repositories with the Coders Talk git hooks: run coders-talk enable --git-hooks in each of them\./);
    assert.doesNotMatch(push.out, /trust the three Coders Talk hooks/, 'push mode needs no agent hooks');
    assert.match((await cli(['enable', '--yes', '--auto=sometimes'])).out, /--auto takes off, on, team or push/);

    const r = await cli(['enable', '--yes', '--auto=team']);
    assert.equal(r.ok, true, r.out);
    assert.match(r.out, /Auto mode is team/);
    assert.match(r.out, /type \/hooks in Codex and trust the three Coders Talk hooks/);
    const auto = JSON.parse(readFileSync(join(dir, 'ct', 'auto.json'), 'utf8'))[SITE];
    assert.equal(auto.mode, 'team');
    assert.equal(auto.codex.mode, 'team');

    await cli(['enable', '--yes', '--auto=off']);
    assert.equal(JSON.parse(readFileSync(join(dir, 'ct', 'auto.json'), 'utf8'))[SITE], undefined);
});

test('only the agents asked for; one without its command gets the steps to do by hand', async () => {
    const r = await cli(['enable', '--yes', '--agent=codex']);
    assert.equal(r.ok, true, r.out);
    assert.equal(agentState().claude, undefined);
    assert.deepEqual(Object.keys(agentState().codex.plugins), ['coders-talk@coders-talk-local']);

    // Claude Code's folder is here, its command is not.
    rmSync(join(dir, 'bin', process.platform === 'win32' ? 'claude.cmd' : 'claude'));
    const hand = await cli(['enable', '--yes']);
    assert.equal(hand.ok, true, hand.out);
    assert.match(hand.out, /Claude Code +\S+claude, but not its command; no Coders Talk plugin/);
    assert.match(hand.out, /Inside Claude Code: \/plugin marketplace add .+, then \/plugin install coders-talk@coders-talk-local\./);
    assert.equal(agentState().claude, undefined);
});

test('disable takes it all off and keeps the sign-in; refresh lays it out again where it is installed', async () => {
    await cli(['enable', '--yes']);
    writeFileSync(join(dir, 'calls.log'), '');
    const refreshed = await cli(['refresh-plugin']);
    assert.equal(refreshed.ok, true, refreshed.out);
    assert.equal(refreshed.out, '');
    const again = calls().map((c) => `${c.agent} ${c.args.join(' ')}`);
    assert.ok(again.includes('claude plugin update coders-talk@coders-talk-local'), again.join('\n'));
    assert.ok(again.includes('codex plugin add coders-talk@coders-talk-local'), again.join('\n'));

    writeFileSync(join(dir, 'ct', 'credentials.json'), JSON.stringify({ [SITE]: { token: 'ct_x', username: 'mara' } }));
    assert.match((await cli(['disable'])).out, /asks before it changes anything/);
    const off = await cli(['disable', '--yes']);
    assert.equal(off.ok, true, off.out);
    assert.match(off.out, /- Claude Code: uninstall coders-talk@coders-talk-local and its marketplace/);
    assert.deepEqual(agentState().claude, { plugins: {}, marketplaces: {}, mcp: [] });
    assert.deepEqual(agentState().codex, { plugins: {}, marketplaces: {}, mcp: [] });
    assert.equal(existsSync(plugin()), false);
    assert.ok(existsSync(join(dir, 'ct', 'credentials.json')));
    assert.match((await cli(['status'])).out, /signed in as @mara/);

    // Nothing laid out: refresh does nothing.
    writeFileSync(join(dir, 'calls.log'), '');
    await cli(['refresh-plugin']);
    assert.deepEqual(calls(), []);
    assert.match((await cli(['disable', '--yes'])).out, /is not installed here; nothing to take off/);
});
