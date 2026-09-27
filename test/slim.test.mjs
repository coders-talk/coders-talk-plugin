// scripts/lib/slim.mjs against the fixtures shared with the site (copied by `npm run plugin:sync` in coders.talk).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { slimJsonl, slimLine } from '../scripts/lib/slim.mjs';

const dir = new URL('./fixtures/slim/', import.meta.url);
const read = (name) => readFileSync(new URL(name, dir), 'utf8');
const parse = (text) => text.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));

for (const name of ['claude-code', 'codex', 'claude-code-folders', 'codex-folders']) {
    test(`${name}.jsonl slims like the site does`, () => {
        assert.deepEqual(parse(slimJsonl(read(`${name}.jsonl`))), parse(read(`${name}.slim.jsonl`)));
    });
}

test('lines of a type the server does not read never reach the slim output, whatever they carry', () => {
    // bridge-session (account and organization ids), frame-link, artifact-* and made-up future types; for Codex a
    // ghost snapshot, an unknown item and an unknown line type.
    for (const name of ['claude-code', 'codex']) {
        const slim = slimJsonl(read(`${name}.jsonl`));

        assert.match(read(`${name}.jsonl`), /leak/, name);
        assert.doesNotMatch(slim, /leak|ownerAccountUuid|ownerOrganizationUuid|bridgeSessionId|frameUrl|ghost_commit|account_id/, name);
    }

    assert.equal(slimLine({ type: 'bridge-session', ownerAccountUuid: 'acc', ownerOrganizationUuid: 'org', bridgeSessionId: 'bridge_1' }), null);
    assert.equal(slimLine({ type: 'some-future-type', secret: 's' }), null);
    assert.equal(slimLine({ type: 'some-future-type', secret: 's', message: { role: 'user', content: 'not a turn' } }), null);
    assert.equal(slimLine({ type: 'future_state', payload: { type: 'message', role: 'user', content: 'x' } }), null);
    assert.equal(slimLine({ type: 'response_item', payload: { type: 'ghost_snapshot', ghost_commit: { id: 'c' } } }), null);
    assert.deepEqual(JSON.parse(JSON.stringify(slimLine({ type: 'user', sessionId: 's', message: { role: 'user', content: 'Hi' } }))), {
        type: 'user',
        message: { role: 'user', content: 'Hi' },
    });
});

test('the git-changes lines the plugin adds survive the server slimming them again', () => {
    const line = { type: 'git-changes', timestamp: '2026-09-01T10:00:05Z', by: 'agent', changes: [{ path: 'a.ts', op: 'update', additions: 1, deletions: 0 }], commits: [] };

    assert.deepEqual(slimLine(line), line);
});

test('text that is not JSON lines is not slimmed', () => {
    assert.equal(slimJsonl(read('not-jsonl.txt')), null);
});
