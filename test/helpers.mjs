// Shared by the tests; not a test file itself.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A throwaway repository with commits at fixed dates; returns the hashes in order. */
export function makeRepo(remote = 'git@github.com:mara/shop.git') {
    const dir = mkdtempSync(join(tmpdir(), 'ct-repo-'));
    const run = (args, date) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
        cwd: dir,
        env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
        stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();

    run(['init', '-q', '-b', 'main']);
    if (remote) run(['remote', 'add', 'origin', remote]);
    const hashes = [];
    for (const [i, date] of ['2026-09-01T09:00:00Z', '2026-09-01T10:10:00Z', '2026-09-01T10:40:00Z'].entries()) {
        writeFileSync(join(dir, 'app.txt'), `line\n`.repeat(i + 1));
        run(['add', '.'], date);
        run(['commit', '-q', '-m', ['Initial commit', 'Add a limiter keyed by email', 'Cover the limiter with tests'][i]], date);
        hashes.push(run(['rev-parse', 'HEAD'], date));
    }

    return { dir, hashes };
}
