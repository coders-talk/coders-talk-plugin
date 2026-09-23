import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cutOwnCommand, findTranscript, summarize } from '../scripts/lib/session.mjs';

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
