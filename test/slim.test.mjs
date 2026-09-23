// scripts/lib/slim.mjs against the fixtures shared with the site (copied by `npm run plugin:sync` in coders.talk).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { slimJsonl } from '../scripts/lib/slim.mjs';

const dir = new URL('./fixtures/slim/', import.meta.url);
const read = (name) => readFileSync(new URL(name, dir), 'utf8');
const parse = (text) => text.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));

for (const name of ['claude-code', 'codex']) {
    test(`${name}.jsonl slims like the site does`, () => {
        assert.deepEqual(parse(slimJsonl(read(`${name}.jsonl`))), parse(read(`${name}.slim.jsonl`)));
    });
}

test('text that is not JSON lines is not slimmed', () => {
    assert.equal(slimJsonl(read('not-jsonl.txt')), null);
});
