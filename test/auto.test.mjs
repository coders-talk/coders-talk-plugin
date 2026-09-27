import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { catchUp, logAuto, removeStaleTemps, setAutoMode, settled, stillHeld, syncDue, trackSession } from '../scripts/lib/auto.mjs';
import { saveToken } from '../scripts/lib/credentials.mjs';
import { markSent } from '../scripts/lib/sessions.mjs';

const DAY = 86_400_000;
const POSIX = process.platform !== 'win32';

test('the auto log keeps 500 lines, none older than 30 days', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-log-'));
    const log = join(dir, 'auto.log');
    const now = new Date('2026-09-27T12:00:00Z');
    const old = new Date(now.getTime() - 31 * DAY).toISOString();
    const recent = new Date(now.getTime() - 29 * DAY).toISOString();
    writeFileSync(log, `${old} a1 sent to your private Builds\n${recent} a2 sent to your private Builds\n`);
    logAuto('a3 sent to Acme', dir, now);
    assert.deepEqual(readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')[1]), ['a2', 'a3']);

    writeFileSync(log, Array.from({ length: 600 }, (_, i) => `${recent} s${i} sent`).join('\n') + '\n');
    logAuto('last sent', dir, now);
    const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 500);
    assert.match(lines[499], /last sent$/);
});

test('sent.json forgets sends older than 90 days', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-sent-'));
    const before = process.env.CODERS_TALK_HOME;
    process.env.CODERS_TALK_HOME = dir;
    t.after(() => (before === undefined ? delete process.env.CODERS_TALK_HOME : (process.env.CODERS_TALK_HOME = before)));
    const now = Date.parse('2026-09-27T12:00:00Z');
    writeFileSync(join(dir, 'sent.json'), JSON.stringify({ [SITE]: { old: { at: now - 91 * DAY, url: 'u1' }, kept: { at: now - 89 * DAY, url: 'u2' } }, 'https://other.test': { gone: { at: now - 100 * DAY } } }));

    markSent(SITE, 'new', 'u3', now);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'sent.json'), 'utf8')), { [SITE]: { kept: { at: now - 89 * DAY, url: 'u2' }, new: { at: now, url: 'u3' } } });
});

test('~/.coders-talk is this user\'s only: the folder 0700, every file in it 0600', { skip: !POSIX && 'Windows has no file modes' }, () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'ct-home-')), '.coders-talk');
    saveToken(SITE, 'ct_token', 'mara', dir);
    setAutoMode(SITE, 'all', 'claude-code', dir);
    trackSession(SITE, 'a1b2c3d4-0000-4000-8000-0000000000a9', { agent: 'claude-code' }, dir);
    logAuto('a line', dir);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    for (const name of readdirSync(dir)) assert.equal(statSync(join(dir, name)).mode & 0o777, 0o600, name);
});

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
