// The handoff to another agent when a limit is near (handoff plan, stage 47): the limits read from a Codex rollout, the
// threshold and "once per crossing", the brief built from each agent's session file without a model, the command that
// starts the next agent on it, and the Stop hook's line for Codex.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildBrief, codexLimits, handoffDue, handoffMessage, handoffOn, handoffThreshold, nearLimit, setHandoff, startCommand, windowLabel } from '../scripts/lib/handoff.mjs';
import { hookCommand } from './helpers.mjs';

const fixtures = fileURLToPath(new URL('./fixtures/slim/', import.meta.url));
const fresh = () => mkdtempSync(join(tmpdir(), 'ct-handoff-'));

const tokenCount = (primary, secondary, extra = {}) =>
    JSON.stringify({ timestamp: '2026-10-08T10:00:00.000Z', type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: { limit_id: 'codex', primary: { used_percent: primary, window_minutes: 300, resets_at: 1791430840 }, secondary: { used_percent: secondary, window_minutes: 10080, resets_at: 1792017640 }, ...extra } } });

test('the limits of a Codex rollout are the last token_count event\'s, named as Claude Code names them', () => {
    const dir = fresh();
    const file = join(dir, 'rollout.jsonl');
    writeFileSync(file, [JSON.stringify({ type: 'session_meta', payload: { id: 'x', cwd: '/w' } }), tokenCount(15, 2), JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'rate_limits in a prompt' }] } }), tokenCount(92.5, 3)].join('\n'));
    assert.deepEqual(codexLimits(file), [
        { kind: 'five_hour', percentUsed: 92.5, resetsAt: new Date(1791430840 * 1000).toISOString() },
        { kind: 'seven_day', percentUsed: 3, resetsAt: new Date(1792017640 * 1000).toISOString() },
    ]);

    // A rollout without any, or gone: nothing.
    writeFileSync(file, `${JSON.stringify({ type: 'session_meta', payload: {} })}\n`);
    assert.deepEqual(codexLimits(file), []);
    assert.deepEqual(codexLimits(join(dir, 'missing.jsonl')), []);
});

test('the tail of a large rollout is enough', () => {
    const dir = fresh();
    const file = join(dir, 'big.jsonl');
    const filler = JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'x'.repeat(10_000) }] } });
    writeFileSync(file, [tokenCount(10, 1), ...Array(60).fill(filler), tokenCount(95, 4), filler].join('\n'));
    assert.equal(nearLimit(codexLimits(file), 90)?.percentUsed, 95);
});

test('nearLimit picks the window furthest past the threshold', () => {
    const limits = [{ kind: 'five_hour', percentUsed: 91 }, { kind: 'seven_day', percentUsed: 96 }];
    assert.equal(nearLimit(limits, 90).kind, 'seven_day');
    assert.equal(nearLimit(limits, 97), null);
    assert.equal(nearLimit([], 1), null);
    assert.equal(nearLimit(null, 1), null);
    assert.equal(windowLabel('five_hour'), '5-hour');
});

test('the switch and the percent', () => {
    const dir = fresh();
    assert.equal(handoffOn(dir, {}), true);
    assert.equal(handoffThreshold(dir, {}), 90);
    assert.equal(handoffOn(dir, { KEEPPLAIN_HANDOFF: '0' }), false);
    setHandoff('off', dir);
    assert.equal(handoffOn(dir, {}), false);
    setHandoff('85', dir);
    assert.equal(handoffOn(dir, {}), true);
    assert.equal(handoffThreshold(dir, {}), 85);
    assert.equal(handoffThreshold(dir, { KEEPPLAIN_HANDOFF_AT: '70' }), 70);
    assert.throws(() => setHandoff('300', dir), /1 to 100/);
});

test('a crossing is said once, and again after the window reset', () => {
    const dir = fresh();
    const hit = { kind: 'five_hour', percentUsed: 92, resetsAt: '2026-10-08T14:00:00.000Z' };
    assert.equal(handoffDue('codex', 't1', hit, dir), true);
    assert.equal(handoffDue('codex', 't1', { ...hit, percentUsed: 97 }, dir), false);
    assert.equal(handoffDue('codex', 't2', hit, dir), true, 'another session');
    assert.equal(handoffDue('codex', 't1', { ...hit, resetsAt: '2026-10-08T19:00:00.000Z' }, dir), true, 'the window reset and filled again');
    assert.equal(handoffDue('codex', 't1', null, dir), false);
});

test('the message names the limit and every target with its command', () => {
    const targets = [{ id: 'claude-code', name: 'Claude Code', cli: 'claude' }, { id: 'pi', name: 'Pi', cli: 'pi' }];
    const text = handoffMessage('codex', { kind: 'five_hour', percentUsed: 92 }, targets);
    assert.match(text, /Codex's 5-hour limit is 92% used\. Continue in Claude Code or Pi: \$keepplain:handoff claude-code, \$keepplain:handoff pi\./);
    assert.match(handoffMessage('claude-code', { kind: 'five_hour', percentUsed: 100 }, targets.slice(1), { reason: 'failed' }), /Claude Code hit its limit\. Continue in Pi: \/keepplain:handoff pi\./);
    assert.equal(handoffMessage('codex', { kind: 'five_hour', percentUsed: 92 }, []), null);
});

test('the start command puts the brief first, for a shell and for PowerShell', () => {
    const codex = { id: 'codex', name: 'Codex', cli: 'codex' };
    assert.equal(startCommand(codex, '/home/you/.keepplain/handoff/claude-code-s1.md', 'linux'), `codex "$(cat '/home/you/.keepplain/handoff/claude-code-s1.md')"`);
    assert.equal(startCommand({ id: 'claude-code', name: 'Claude Code', cli: 'claude' }, 'C:\\Users\\you\\.keepplain\\handoff\\codex-t1.md', 'win32'), `claude (Get-Content -Raw 'C:\\Users\\you\\.keepplain\\handoff\\codex-t1.md')`);
    assert.equal(startCommand({ id: 'cursor', name: 'Cursor', cli: null }, '/x.md', 'linux'), null, 'the IDE alone takes no first message');
});

test('the brief of a Claude Code session: the task, the files, the commands, where it stopped', async () => {
    const { text, prompts, files, commands } = await buildBrief({ agent: 'claude-code', id: 's1', path: join(fixtures, 'claude-code.jsonl'), cwd: '/nowhere/that/exists' });
    assert.equal(prompts[0], 'Add rate limiting to /api/login. Keep the tests green.');
    assert.match(text, /^# Handoff from Claude Code/);
    assert.match(text, /## Task\n\nAdd rate limiting to \/api\/login\. Keep the tests green\./);
    assert.ok(files.includes('routes/api.php') && files.includes('tests/LoginThrottleTest.php'), files.join());
    assert.match(text, /- `routes\/api\.php` \(edited, \+1 −1\)/);
    assert.match(text, /## Where it stopped\n\nLast answer of Claude Code:\n\n> Switched to a named limiter keyed by email\. 14 tests pass\./);
    assert.doesNotMatch(text, /<command-name>/, "Claude Code's own commands are not prompts");
    assert.doesNotMatch(text, /secret|password/i);
    assert.ok(text.length <= 8000);
    assert.match(text, /keepplain login/);
    // The withheld Bash call is not a command, and no results leak the .env.
    assert.equal(commands.length, 0);
});

test('the brief of a Codex session: the shell commands and which failed', async () => {
    const { text, commands, files } = await buildBrief({ agent: 'codex', id: 't1', path: join(fixtures, 'codex.jsonl') });
    assert.match(text, /^# Handoff from Codex/);
    assert.match(text, /## Task\n\nFix the flaky checkout test\./);
    const named = commands.map((c) => `${c.command}${c.failed ? ' !' : ''}`);
    assert.ok(named.includes('npm test !'), named.join(' | '));
    assert.ok(named.includes('npm run build !'), named.join(' | '));
    assert.ok(named.some((c) => c === 'npm test'), named.join(' | '));
    assert.ok(files.includes('src/cart.ts'), files.join());
    assert.match(text, /## What was asked along the way\n\n- Now make the cart page match this\./);
    assert.match(text, /> Totals now update without touching the header\./);
    assert.doesNotMatch(text, /environment_context|<skill>/);
    assert.match(text, /\$keepplain:resume/);
});

test('the briefs of Pi and Cursor sessions', async () => {
    const pi = await buildBrief({ agent: 'pi', id: 'p1', path: join(fixtures, 'pi.jsonl') });
    assert.match(pi.text, /## Task\n\nAdd rate limiting/);
    assert.ok(pi.files.includes('config/auth.php'), pi.files.join());
    assert.match(pi.text, /> The limiter is in place/);

    const cursor = await buildBrief({ agent: 'cursor', id: 'c1', path: join(fixtures, 'cursor.jsonl') });
    assert.match(cursor.text, /## Task\n\nAdd rate limiting/);
    assert.match(cursor.text, /- One more thing: log the rejected attempts\./);
    assert.ok(cursor.commands.some((c) => c.command === 'php artisan test'), cursor.commands.map((c) => c.command).join());
    assert.match(cursor.text, /> Added a warning log line\./);
});

test('the brief says what the repository looks like now', async () => {
    const dir = fresh();
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    if (git('init', '-q').status !== 0) return;
    git('config', 'user.email', 'a@b.c');
    git('config', 'user.name', 'a');
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    git('add', '.');
    git('commit', '-qm', 'first');
    writeFileSync(join(dir, 'b.txt'), 'b\n');
    const session = join(fresh(), 'session.jsonl');
    writeFileSync(session, `${JSON.stringify({ type: 'user', uuid: 'u1', cwd: dir, message: { role: 'user', content: 'Do a thing' }, timestamp: '2026-10-08T10:00:00.000Z' })}\n`);
    const { text } = await buildBrief({ agent: 'claude-code', id: 's2', path: session });
    assert.match(text, /## Repository now\n\n- Branch `[^`]+`, HEAD `[0-9a-f]+ first`\n- 1 uncommitted change:\n {2}- `\?\? b\.txt`/);
    assert.match(text, /\(nothing answered yet\)/);
});

test('the Stop hook of Codex says once where to go on when a limit is past the threshold', () => {
    const dir = fresh();
    const home = join(dir, 'kp');
    const rollout = join(dir, 'rollout.jsonl');
    writeFileSync(rollout, [JSON.stringify({ type: 'session_meta', payload: { id: 'thread-1', cwd: dir } }), tokenCount(95, 4)].join('\n'));
    // The targets come from what is installed: a fake claude on PATH makes Claude Code one of them.
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, process.platform === 'win32' ? 'claude.cmd' : 'claude'), '', { mode: 0o755 });
    const env = { ...process.env, KEEPPLAIN_HOME: home, PATH: bin, Path: bin, CLAUDE_CONFIG_DIR: join(dir, 'no-claude'), CODEX_HOME: join(dir, 'no-codex'), KEEPPLAIN_NUDGE: '0' };
    const event = JSON.stringify({ hook_event_name: 'Stop', session_id: 'thread-1', transcript_path: rollout, cwd: dir });
    const [program, programArgs] = hookCommand('stop', ['--agent=codex']);
    const first = spawnSync(program, programArgs, { input: event, env, encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const out = JSON.parse(first.stdout.trim());
    assert.match(out.systemMessage, /Codex's 5-hour limit is 95% used \(resets .+\)\. Continue in Claude Code: \$keepplain:handoff claude-code\./);
    assert.ok(existsSync(join(home, 'handoffs', 'codex-thread-1.json')));

    const again = spawnSync(program, programArgs, { input: event, env, encoding: 'utf8' });
    assert.equal(again.stdout.trim(), '', 'said once');

    // Off: nothing, whatever the figure.
    writeFileSync(join(home, 'handoff.json'), JSON.stringify({ off: true }));
    const other = JSON.stringify({ ...JSON.parse(event), session_id: 'thread-2' });
    assert.equal(spawnSync(program, programArgs, { input: other, env, encoding: 'utf8' }).stdout.trim(), '');
    assert.equal(JSON.parse(readFileSync(join(home, 'handoffs', 'codex-thread-1.json'), 'utf8')).said.length, 1);
});
