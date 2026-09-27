// The sessions of a folder (lib/sessions.mjs): in a repository, those of the whole project (grouping plan, 23.1).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { folderSessions } from '../scripts/lib/sessions.mjs';
import { makeRepo } from './helpers.mjs';

const line = JSON.stringify({ type: 'user', message: { role: 'user', content: 'Fix it' } });

test('the main working tree and its worktrees, also removed ones, list each other\'s sessions', () => {
    const home = mkdtempSync(join(tmpdir(), 'ct-list-'));
    const dir = realpathSync(makeRepo().dir);
    const live = join(dir, '.claude', 'worktrees', 'live-one');
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'claude/live-one', live], { cwd: dir, stdio: 'ignore' });
    const gone = join(dir, '.claude', 'worktrees', 'gone-one');
    const other = realpathSync(makeRepo().dir);

    const encode = (f) => f.replace(/[^a-zA-Z0-9]/g, '-');
    const put = (folder, id) => {
        mkdirSync(join(home, 'projects', encode(folder)), { recursive: true });
        writeFileSync(join(home, 'projects', encode(folder), `${id}.jsonl`), `${line}\n`);
    };
    put(dir, 'a0000000-0000-4000-8000-000000000001');
    put(live, 'a0000000-0000-4000-8000-000000000002');
    put(gone, 'a0000000-0000-4000-8000-000000000003');
    put(other, 'a0000000-0000-4000-8000-000000000004');

    const env = { CLAUDE_CONFIG_DIR: home, CODEX_HOME: join(home, 'codex') };
    const ids = (folder) => folderSessions(folder, { env }).map((s) => s.id.slice(-1)).sort().join('');
    assert.equal(ids(dir), '123');
    assert.equal(ids(live), '123');
    assert.equal(ids(other), '4');
});
