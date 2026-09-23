import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cutOwnCommand, findRollout, findTranscript, summarize } from '../scripts/lib/session.mjs';

const line = (d) => JSON.stringify(d);
const prompt = (text, s) => line({ type: 'user', cwd: '/home/you/code/shop', message: { role: 'user', content: text }, timestamp: `2026-09-01T10:${String(s).padStart(2, '0')}:00Z` });
const command = (name) => line({ type: 'user', message: { role: 'user', content: `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>` } });

test('the plugin run and everything after it is cut from the session', () => {
    const text = [prompt('Fix the tests', 0), command('coders-talk:build'), line({ type: 'user', isMeta: true, message: { role: 'user', content: 'skill body' } })].join('\n');
    assert.deepEqual(cutOwnCommand(text), { text: prompt('Fix the tests', 0), cut: true });

    // Only the last run is cut: an earlier /coders-talk:share stays part of the work.
    const twice = [prompt('a', 0), command('coders-talk:share'), prompt('b', 5), command('coders-talk:build')].join('\n');
    assert.equal(cutOwnCommand(twice).text.split('\n').length, 3);

    // Other commands are not ours.
    assert.equal(cutOwnCommand([prompt('a', 0), command('loop')].join('\n')).cut, false);
});

test('the summary counts prompts typed by the person, tool calls and the time span', () => {
    const text = [
        prompt('Add rate limiting', 0),
        line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'Read', input: {} }, { type: 'tool_use', name: 'Edit', input: {} }] }, timestamp: '2026-09-01T10:01:00Z' }),
        line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'done' }] }, timestamp: '2026-09-01T10:02:00Z' }),
        line({ type: 'user', message: { role: 'user', content: '[Request interrupted by user]' } }),
        command('clear'),
        line({ type: 'user', isMeta: true, message: { role: 'user', content: 'Caveat: generated' } }),
        line({ type: 'user', message: { role: 'user', content: '<task-notification>\n<task-id>x</task-id>\n</task-notification>' } }),
        // Pasted text is wrapped in a tag too, but the person typed (or pasted) it.
        line({ type: 'user', message: { role: 'user', content: '<pasted_content id="1">the spec</pasted_content>\nReview this' } }),
        prompt('Key it by email', 45),
    ].join('\n');

    assert.deepEqual(summarize(text), {
        cwd: '/home/you/code/shop',
        project: 'shop',
        prompts: 3,
        toolCalls: 2,
        startedAt: Date.parse('2026-09-01T10:00:00Z'),
        durationSec: 2700,
    });
});

test('the transcript is found by session id in any project folder', () => {
    const config = mkdtempSync(join(tmpdir(), 'ct-config-'));
    mkdirSync(join(config, 'projects', 'C--code-shop'), { recursive: true });
    mkdirSync(join(config, 'projects', '-home-you-other'), { recursive: true });
    const id = '1c5851b0-1738-4777-b917-b06bd4e11b88';
    writeFileSync(join(config, 'projects', 'C--code-shop', `${id}.jsonl`), prompt('x', 0));

    assert.equal(findTranscript(id, config), join(config, 'projects', 'C--code-shop', `${id}.jsonl`));
    assert.equal(findTranscript('00000000-0000-0000-0000-000000000000', config), null);
    // An id is never allowed to walk out of the projects folder.
    assert.equal(findTranscript('../../etc/passwd', config), null);
});

// Codex rollouts: {timestamp, type, payload}.
const codex = (payload, s = 0, type = 'response_item') => line({ timestamp: `2026-09-01T10:${String(s).padStart(2, '0')}:00Z`, type, payload });
const said = (text, s) => codex({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] }, s);
const skill = (name) => said(`<skill>\n<name>${name}</name>\n<path>/p/codex/skills/build/SKILL.md</path>\nbody\n</skill>`);

test('in Codex the skill message and what the person typed to call it are cut', () => {
    const work = [
        codex({ id: 't1', cwd: '/home/you/shop', git: { commit_hash: 'abc' } }, 0, 'session_meta'),
        said('Fix the flaky test', 0),
        codex({ type: 'function_call', name: 'shell', arguments: '{}' }, 1),
        codex({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Fixed.' }] }, 2),
    ];
    const text = [...work, said('<environment_context>\n<cwd>/home/you/shop</cwd>\n</environment_context>', 3), said('$coders-talk:build', 3), skill('coders-talk:build'), codex({ type: 'function_call', name: 'shell', arguments: '{}' }, 4)].join('\n');
    assert.deepEqual(cutOwnCommand(text), { text: work.join('\n'), cut: true });

    // Another skill is part of the work.
    assert.equal(cutOwnCommand([...work, skill('frontend-review')].join('\n')).cut, false);

    assert.deepEqual(summarize(text), {
        cwd: '/home/you/shop',
        project: 'shop',
        prompts: 2,
        toolCalls: 2,
        startedAt: Date.parse('2026-09-01T10:00:00Z'),
        durationSec: 240,
    });
});

test('the Codex rollout is found by thread id, a reverted one too', () => {
    const home = mkdtempSync(join(tmpdir(), 'ct-codex-'));
    const id = '01a0b8a6-9f98-7701-8110-1a2556f5b096';
    const day = join(home, 'sessions', '2026', '09', '19');
    mkdirSync(day, { recursive: true });
    writeFileSync(join(day, `rollout-2026-09-19T10-52-02-${id}.jsonl`), said('x', 0));
    writeFileSync(join(day, `rollout-2026-09-19T10-53-00-01a0b8a6-0000-7701-8110-1a2556f5b096.jsonl`), said('other', 0));

    assert.equal(findRollout(id, home), join(day, `rollout-2026-09-19T10-52-02-${id}.jsonl`));
    assert.equal(findRollout('01a0b8a6-1111-7701-8110-1a2556f5b096', home), null);
    assert.equal(findRollout('../x', home), null);

    // After a revert Codex writes <thread id>_<rollout id>; the newest file wins.
    const reverted = join(day, `rollout-2026-09-19T11-00-00-${id}_01a0b8d3-5e84-75d3-90e8-f48386d1883f.jsonl`);
    writeFileSync(reverted, said('y', 0));
    utimesSync(reverted, new Date(), new Date(Date.now() + 1000));
    assert.equal(findRollout(id, home), reverted);
});
