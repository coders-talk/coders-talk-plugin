// The files `npm run plugin:sync` in coders.talk writes here are the site's: slimming, the privacy check and token
// counting must work exactly like the browser and the server. An edit made here would be lost at the next sync, or
// worse, a sync would quietly undo it. So each file carries the hash of its code, the fixtures a list of theirs, and
// this test fails when they no longer match: change the site's file and sync again instead.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

/** Line endings do not count: git may check the plugin out with CRLF on Windows. */
const digest = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

for (const file of ['slim.mjs', 'usage.mjs', 'privacy.mjs', 'grouping.mjs']) {
    test(`scripts/lib/${file} is the site's, as synced`, () => {
        const text = read(`../scripts/lib/${file}`);
        const header = text.match(/^(?:\/\/.*\n)*?\/\/ sha256:([0-9a-f]{64})\n\n/);
        assert.ok(header, `${file} has no hash: it was not written by npm run plugin:sync`);
        assert.equal(digest(text.slice(header[0].length)), header[1], `${file} was edited here: change the site's file and run npm run plugin:sync`);
    });
}

test('the shared fixtures are the site\'s, as synced', () => {
    const hashes = JSON.parse(read('./fixtures/generated.json'));
    const present = ['slim', 'privacy', 'grouping'].flatMap((kind) => readdirSync(new URL(`./fixtures/${kind}/`, import.meta.url)).map((name) => `${kind}/${name}`));

    assert.deepEqual(present.sort(), Object.keys(hashes).sort(), 'fixtures were added or removed here: add them on the site and sync');
    for (const [name, hash] of Object.entries(hashes)) {
        assert.equal(digest(read(`./fixtures/${name}`)), hash, `fixtures/${name} was edited here: change the site's fixture and sync`);
    }
});
