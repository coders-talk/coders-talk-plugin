import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { catchUp, removeStaleTemps, settled, stillHeld, syncDue, trackSession } from '../scripts/lib/auto.mjs';

const SITE = 'https://coders.test';
const HOUR = 60 * 60_000;

/** A session file quiet for an hour, and auto mode's memory of it. */
function quietSession(dir, id, patch = {}) {
    const path = join(dir, `${id}.jsonl`);
    writeFileSync(path, '{"type":"user"}\n');
    const at = new Date(Date.now() - HOUR);
    utimesSync(path, at, at);

    return { path, session: trackSession(SITE, id, { path, agent: 'claude-code', seen: Date.now() - 2 * HOUR, ...patch }, dir) };
}

test('a session held for what it had is left alone until its file grows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-auto-'));
    const id = 'a1b2c3d4-0000-4000-8000-0000000000a1';
    const { path } = quietSession(dir, id);
    assert.deepEqual(catchUp(SITE, null, 'claude-code', dir).map((s) => s.id), [id]);

    // No prompts yet, or not a team's repository: held at this size, not tried at every start.
    const held = trackSession(SITE, id, { held: { at: Date.now(), size: 16, why: 'not a team repository' } }, dir);
    assert.deepEqual(catchUp(SITE, null, 'claude-code', dir), []);
    assert.equal(syncDue(held), false);
    assert.equal(stillHeld(held), true);
    assert.equal(settled(held), false);

    // It grows: a prompt came, or the team may ask for it by now. Looked at again.
    appendFileSync(path, '{"type":"user","message":{"content":"more"}}\n');
    const at = new Date(Date.now() - HOUR);
    utimesSync(path, at, at);
    assert.deepEqual(catchUp(SITE, null, 'claude-code', dir).map((s) => s.id), [id]);
    assert.equal(stillHeld(held), false);
    assert.equal(syncDue(held), true);
});

test('only a published or foreign draft is skipped for good; the old team skip is looked at again', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-auto-'));
    const legacy = 'a1b2c3d4-0000-4000-8000-0000000000a2';
    const published = 'a1b2c3d4-0000-4000-8000-0000000000a3';
    const { session } = quietSession(dir, legacy, { skip: 'not a team repository' });
    quietSession(dir, published, { skip: 'published' });

    assert.equal(settled(session), false);
    assert.deepEqual(catchUp(SITE, null, 'claude-code', dir).map((s) => s.id), [legacy]);
});

test('temp files of writes that died are removed, fresh ones are not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-auto-'));
    const old = join(dir, 'auto-sessions.json.12388.tmp');
    const fresh = join(dir, 'auto-sessions.json.4242.tmp');
    const other = join(dir, 'notes.tmp');
    for (const path of [old, fresh, other]) writeFileSync(path, '{}');
    const at = new Date(Date.now() - HOUR);
    utimesSync(old, at, at);
    utimesSync(other, at, at);

    removeStaleTemps(dir);
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(fresh), true);
    assert.equal(existsSync(other), true, 'only the auto mode files');

    // A write leaves nothing behind.
    trackSession(SITE, 'a1b2c3d4-0000-4000-8000-0000000000a4', { agent: 'claude-code' }, dir);
    assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.tmp')).sort(), ['auto-sessions.json.4242.tmp', 'notes.tmp']);
});
