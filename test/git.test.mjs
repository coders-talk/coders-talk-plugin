import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { folderGitContexts, gitContext, normalizeRemote, parseShortstat } from '../scripts/lib/git.mjs';
import { readSidecar } from '../scripts/lib/sidecar.mjs';
import { makeRepo } from './helpers.mjs';

test('only GitHub remotes become a link, in one form', () => {
    for (const url of ['git@github.com:mara/shop.git', 'https://github.com/mara/shop', 'https://github.com/mara/shop.git/', 'ssh://git@github.com/mara/shop.git', 'https://mara:ghp_secret@github.com/mara/shop.git']) {
        assert.equal(normalizeRemote(url), 'https://github.com/mara/shop', url);
    }
    assert.equal(normalizeRemote('git@gitlab.com:mara/shop.git'), null);
    assert.equal(normalizeRemote('https://github.com.evil.io/mara/shop'), null);
    assert.equal(normalizeRemote(null), null);
});

test('shortstat becomes numbers', () => {
    assert.deepEqual(parseShortstat(' 12 files changed, 340 insertions(+), 85 deletions(-)'), { files: 12, insertions: 340, deletions: 85 });
    assert.deepEqual(parseShortstat(' 1 file changed, 1 insertion(+)'), { files: 1, insertions: 1, deletions: 0 });
});

test('the commits made since HEAD at the start of the session', () => {
    const { dir, hashes } = makeRepo();

    assert.deepEqual(gitContext(dir, hashes[0], null), {
        remote: 'https://github.com/mara/shop',
        branch: 'main',
        head_start: hashes[0],
        head_end: hashes[2],
        commits: { count: 2, subjects: ['Cover the limiter with tests', 'Add a limiter keyed by email'], shas: [hashes[2], hashes[1]] },
        shortstat: { files: 1, insertions: 2, deletions: 0 },
    });
});

test('without the hook, HEAD at the start is estimated from the session start time', () => {
    const { dir, hashes } = makeRepo(null);
    const context = gitContext(dir, null, Date.parse('2026-09-01T10:00:00Z'));

    assert.equal(context.head_start, hashes[0]);
    assert.equal(context.head_start_estimated, true);
    assert.equal(context.remote, null);
    assert.equal(context.commits.count, 2);
});

test('folders added to the session get their own git context, when they are a repository of their own', () => {
    const own = makeRepo();
    const api = makeRepo('git@github.com:mara/shop-api.git');
    const inside = join(own.dir, 'packages');
    mkdirSync(inside);
    const folders = [
        { dir: inside, label: 'packages' },
        { dir: mkdtempSync(join(tmpdir(), 'ct-plain-')), label: 'notes' },
        { dir: api.dir, label: 'shop-api' },
    ];

    const contexts = folderGitContexts(folders, own.dir, Date.parse('2026-09-01T10:00:00Z'));

    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].folder, 'shop-api');
    assert.equal(contexts[0].remote, 'https://github.com/mara/shop-api');
    // Only the session's own folder has a hook that saw HEAD at the start.
    assert.equal(contexts[0].head_start, api.hashes[0]);
    assert.equal(contexts[0].head_start_estimated, true);
    assert.deepEqual(contexts[0].commits.shas, [api.hashes[2], api.hashes[1]]);
});

test('outside a repository there is no git context', () => {
    assert.equal(gitContext(mkdtempSync(join(tmpdir(), 'ct-plain-')), null, null), null);
});

test('the SessionStart hook remembers HEAD once, silently', async () => {
    const { dir, hashes } = makeRepo();
    const home = mkdtempSync(join(tmpdir(), 'ct-home-'));
    const hook = fileURLToPath(new URL('../scripts/session-start.mjs', import.meta.url));
    const fire = (event) => new Promise((resolve) => {
        const child = execFile(process.execPath, [hook], { env: { ...process.env, CODERS_TALK_HOME: home } }, (error, stdout) => resolve({ error, stdout }));
        child.stdin.end(JSON.stringify(event));
    });

    const id = '1c5851b0-1738-4777-b917-b06bd4e11b88';
    const first = await fire({ session_id: id, cwd: dir, transcript_path: '/x.jsonl', hook_event_name: 'SessionStart', source: 'startup' });
    assert.equal(first.error, null);
    assert.equal(first.stdout, '');
    assert.equal(readSidecar(id, join(home, 'sessions')).head, hashes[2]);

    // Resume and compact keep the id: the start of the session stays what it was.
    await fire({ session_id: id, cwd: mkdtempSync(join(tmpdir(), 'ct-other-')), source: 'resume' });
    assert.equal(readSidecar(id, join(home, 'sessions')).cwd, dir);

    // Garbage in, nothing out, and still no failure.
    const bad = await fire('not json');
    assert.equal(bad.error, null);
    assert.equal(bad.stdout, '');
    assert.equal(JSON.parse(readFileSync(join(home, 'sessions', `${id}.json`), 'utf8')).session_id, id);
});
