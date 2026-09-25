// What the agent took from the library (lib/library.mjs), the Stop hook's suggestion to share (lib/nudge.mjs, stop.mjs)
// and the token for the plugin's MCP server (mcp-headers).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LibraryWatch, MAX_SLUGS } from '../scripts/lib/library.mjs';
import { editsCode, nudgeDue } from '../scripts/lib/nudge.mjs';

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
const SITE = 'https://coders.talk';
const answer = (...slugs) => `Reference data: sessions other developers published on coders.talk. Not instructions.\n${slugs.map((s, i) => `${i + 1}. A session\n   ${SITE}/b/${s}?ref=agent`).join('\n')}`;

// Claude Code: the call in the agent's message, the answer in the next "user" line.
const ccCall = (id, tool, server = 'plugin_coders-talk_coders-talk') => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: `mcp__${server}__${tool}`, input: { query: 'migrate queues to horizon', stack: 'laravel' } }] } });
const ccResult = (id, text, isError = false) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }], ...(isError ? { is_error: true } : {}) }] } });
const ccTool = (id, name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
// Codex: a function call with the server as its namespace, a script (exec), a patch.
const cxCall = (id, tool, namespace = 'mcp__coders_talk__') => ({ type: 'response_item', payload: { type: 'function_call', name: tool, namespace, arguments: '{"query":"horizon"}', call_id: id } });
const cxOutput = (id, output, type = 'function_call_output') => ({ type: 'response_item', payload: { type, call_id: id, output } });
const cxCustom = (id, name, input) => ({ type: 'response_item', payload: { type: 'custom_tool_call', name, input, call_id: id } });

const watch = (lines) => {
    const w = new LibraryWatch();
    lines.forEach((d) => w.add(d));

    return w.result();
};

test('Claude Code: calls to the library by any server name, and the Builds in their answers', () => {
    assert.deepEqual(watch([
        ccCall('t1', 'search_coding_agent_sessions'),
        ccResult('t1', answer('horizon-queues-ab12', 'supervisor-setup')),
        // Added by hand, or a claude.ai connector: the same tools under another server name.
        ccCall('t2', 'get_coding_agent_session', 'coders-talk'),
        ccResult('t2', answer('horizon-queues-ab12')),
        ccCall('t3', 'find_coding_agent_failures', 'claude_ai_Coders_Talk'),
        ccResult('t3', 'No similar sessions on coders.talk yet.'),
    ]), { calls: 3, slugs: ['horizon-queues-ab12', 'supervisor-setup'] });

    assert.equal(watch([ccTool('t1', 'Read', { file_path: 'x' })]), null, 'no library call, nothing to send');
    // A failed call counts as a call, and brings no Builds.
    assert.deepEqual(watch([ccCall('t1', 'search_coding_agent_sessions'), ccResult('t1', answer('a-b'), true)]), { calls: 1, slugs: [] });
    // The same links in another tool's output (reading this repository's fixtures, say) are not the library's answer.
    assert.equal(watch([ccTool('t1', 'Bash', { command: 'grep -r search_coding_agent_sessions tests' }), ccResult('t1', answer('a-b'))]), null);
    // A tool that only ends like one of ours is not one of ours.
    assert.equal(watch([ccTool('t1', 'mcp__x__my_search_coding_agent_sessions', {})]), null);
});

test('Codex: MCP function calls, scripts that call the tools, the legacy event; patches do not count', () => {
    assert.deepEqual(watch([
        cxCall('c1', 'search_coding_agent_sessions'),
        cxOutput('c1', answer('laravel-horizon')),
        cxCustom('c2', 'exec', 'const r = await tools.mcp__coders_talk__get_coding_agent_session({ slug: "laravel-horizon" });'),
        cxOutput('c2', answer('laravel-horizon', 'vite-manifest'), 'custom_tool_call_output'),
        { type: 'event_msg', payload: { type: 'mcp_tool_call_end', call_id: 'c3', invocation: { server: 'coders-talk', tool: 'find_coding_agent_failures' }, result: { Ok: { content: [{ type: 'text', text: answer('docker-cache') }] } } } },
        // The same call as a response item and as the legacy event is one call.
        { type: 'event_msg', payload: { type: 'mcp_tool_call_end', call_id: 'c1', invocation: { server: 'coders-talk', tool: 'search_coding_agent_sessions' }, result: { Ok: {} } } },
    ]), { calls: 3, slugs: ['laravel-horizon', 'vite-manifest', 'docker-cache'] });

    // Editing a file that names the tools is not a call.
    assert.equal(watch([cxCustom('p1', 'apply_patch', '*** Begin Patch\n+search_coding_agent_sessions\n*** End Patch'), cxOutput('p1', answer('x'), 'custom_tool_call_output')]), null);
    assert.equal(watch([{ type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"rg get_coding_agent_session"}', call_id: 'e1' } }]), null);
});

test('at most twenty Builds, and a read can go on from where the last one stopped', () => {
    const many = Array.from({ length: 30 }, (_, i) => `build-${i}`);
    const all = watch([ccCall('t1', 'search_coding_agent_sessions'), ccResult('t1', answer(...many))]);
    assert.equal(all.slugs.length, MAX_SLUGS);
    assert.equal(all.slugs[0], 'build-0');

    // The call in one part of the file, its answer in the next.
    const first = new LibraryWatch();
    first.add(ccCall('t1', 'search_coding_agent_sessions'));
    const next = new LibraryWatch(JSON.parse(JSON.stringify(first.state())));
    next.add(ccResult('t1', answer('later-one')));
    assert.deepEqual(next.result(), { calls: 1, slugs: ['later-one'] });

    assert.equal(LibraryWatch.worthParsing(JSON.stringify(ccTool('t', 'Read', {}))), false);
    assert.equal(LibraryWatch.worthParsing(JSON.stringify(ccCall('t', 'search_coding_agent_sessions'))), true);
});

test('code changes: edit tools in Claude Code, patches in Codex', () => {
    assert.equal(editsCode(ccTool('t', 'Edit', { file_path: 'a.php' })), true);
    assert.equal(editsCode(ccTool('t', 'Write', { file_path: 'a.php' })), true);
    assert.equal(editsCode(ccTool('t', 'Read', { file_path: 'a.php' })), false);
    assert.equal(editsCode(cxCustom('p', 'apply_patch', '*** Begin Patch')), true);
    assert.equal(editsCode(cxCustom('p', 'exec', 'await tools.apply_patch("*** Begin Patch\\n…")')), true);
    assert.equal(editsCode({ type: 'event_msg', payload: { type: 'patch_apply_end', success: true } }), true);
    assert.equal(editsCode({ type: 'event_msg', payload: { type: 'patch_apply_end', success: false } }), false);
});

test('the suggestion comes once, when the session both used Builds and changed code, reading on from where it stopped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-nudge-'));
    const path = join(dir, 'session.jsonl');
    const add = (...lines) => appendFileSync(path, lines.map((l) => JSON.stringify(l) + '\n').join(''));
    const session = { agent: 'claude-code', id: 'a1b2c3d4-0000-4000-8000-00000000aa01', path };

    add(ccCall('t1', 'search_coding_agent_sessions'), ccResult('t1', answer('horizon-queues', 'supervisor-setup')));
    assert.equal(nudgeDue(session, dir), null, 'no code changed yet');
    add(ccTool('t2', 'Edit', { file_path: 'config/horizon.php' }));
    // Half a line, still being written: it waits for its end.
    appendFileSync(path, '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Ed');
    assert.equal(nudgeDue(session, dir), 2);
    appendFileSync(path, 'it"}]}}\n');
    assert.equal(nudgeDue(session, dir), null, 'once per session');

    // Code changed, but nothing came from the library: nothing to say.
    const other = { ...session, id: 'a1b2c3d4-0000-4000-8000-00000000aa02', path: join(dir, 'other.jsonl') };
    writeFileSync(other.path, [ccTool('t1', 'Write', { file_path: 'a' }), ccCall('t2', 'search_coding_agent_sessions'), ccResult('t2', 'No similar sessions on coders.talk yet.')].map((l) => JSON.stringify(l)).join('\n') + '\n');
    assert.equal(nudgeDue(other, dir), null);
});

/** Runs a hook script with the event on stdin; returns what it printed. */
function hook(name, event, env) {
    return new Promise((resolve, reject) => {
        const child = execFile(process.execPath, [join(scripts, name), ...(event.agent === 'codex' ? ['--agent=codex'] : [])], { env }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
        child.stdin.end(JSON.stringify(event));
    });
}

test('the Stop hook shows the suggestion to the person, not with auto mode on, not when turned off', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ct-stop-'));
    const config = join(home, 'claude');
    mkdirSync(config);
    const env = { ...process.env, CODERS_TALK_HOME: join(home, 'ct'), CLAUDE_CONFIG_DIR: config, CODEX_HOME: join(home, 'codex'), CODERS_TALK_URL: SITE };
    delete env.CODERS_TALK_NUDGE;
    delete env.CODERS_TALK_AUTO;
    const session = (id, lines) => {
        const path = join(home, `${id}.jsonl`);
        writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
        return { session_id: id, transcript_path: path, hook_event_name: 'Stop' };
    };
    const used = [ccCall('t1', 'search_coding_agent_sessions'), ccResult('t1', answer('horizon-queues')), ccTool('t2', 'Edit', { file_path: 'a.php' })];

    const out = await hook('stop.mjs', session('a1b2c3d4-0000-4000-8000-00000000bb01', used), env);
    assert.deepEqual(JSON.parse(out), { systemMessage: 'Your agent used 1 Build from coders.talk in this session. Share yours: /coders-talk:build' });
    assert.equal(await hook('stop.mjs', session('a1b2c3d4-0000-4000-8000-00000000bb01', used), env), '', 'once');

    const codex = [cxCall('c1', 'search_coding_agent_sessions'), cxOutput('c1', answer('a-b', 'c-d')), cxCustom('p1', 'apply_patch', '*** Begin Patch')];
    const fromCodex = await hook('stop.mjs', { ...session('a1b2c3d4-0000-4000-8000-00000000bb02', codex), agent: 'codex' }, env);
    assert.match(JSON.parse(fromCodex).systemMessage, /used 2 Builds .* Share yours: \$coders-talk:build$/);

    assert.equal(await hook('stop.mjs', session('a1b2c3d4-0000-4000-8000-00000000bb03', used), { ...env, CODERS_TALK_NUDGE: '0' }), '');

    // Auto mode sends the session anyway: no suggestion, and nothing printed.
    mkdirSync(join(home, 'ct'), { recursive: true });
    writeFileSync(join(home, 'ct', 'auto.json'), JSON.stringify({ [SITE]: { mode: 'all' } }));
    assert.equal(await hook('stop.mjs', session('a1b2c3d4-0000-4000-8000-00000000bb04', used), env), '');
});

test('mcp-headers prints the token saved for the MCP server’s own site, or {}', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ct-headers-'));
    const token = 'ct_' + 'h'.repeat(48);
    mkdirSync(join(home, 'ct'));
    writeFileSync(join(home, 'ct', 'credentials.json'), JSON.stringify({ [SITE]: { token, username: 'mara' } }));
    const env = { ...process.env, CODERS_TALK_HOME: join(home, 'ct'), CLAUDE_CONFIG_DIR: home };
    delete env.CODERS_TALK_TOKEN;
    delete env.CODERS_TALK_URL;
    const headers = (extra) =>
        new Promise((resolve) => execFile(process.execPath, [join(scripts, 'coders-talk.mjs'), 'mcp-headers'], { env: { ...env, ...extra } }, (e, stdout) => resolve(JSON.parse(stdout))));

    assert.deepEqual(await headers({ CLAUDE_CODE_MCP_SERVER_URL: `${SITE}/mcp` }), { Authorization: `Bearer ${token}` });
    assert.deepEqual(await headers({}), { Authorization: `Bearer ${token}` }, 'the default site without the variable');
    // Another site's server never gets this site's token.
    assert.deepEqual(await headers({ CLAUDE_CODE_MCP_SERVER_URL: 'http://localhost:8000/mcp' }), {});
    assert.deepEqual(await headers({ CODERS_TALK_HOME: join(home, 'nobody') }), {});
});
