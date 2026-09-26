// Shared by the tests; not a test file itself.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * CODERS_TALK_BIN=dist/coders-talk-… runs the commands and hooks of the tests on the single file built by
 * scripts/build.mjs instead of the scripts (npm run test:binary): the same checks, under Bun (plan, stage 13.1).
 */
export const BINARY = process.env.CODERS_TALK_BIN ? resolve(process.env.CODERS_TALK_BIN) : null;
const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));

/** [program, arguments] that run `coders-talk <args>`. */
export const coders = (args) => (BINARY ? [BINARY, args] : [process.execPath, [join(scripts, 'coders-talk.mjs'), ...args]]);

/** [program, arguments] that run a hook as the agent does: session-start, stop or session-end; --agent=codex for Codex. */
export function hookCommand(name, args = []) {
    if (!BINARY) return [process.execPath, [join(scripts, `${name}.mjs`), ...args]];

    return [BINARY, ['hook', args.includes('--agent=codex') ? 'codex' : 'claude-code', name]];
}

/**
 * Waits until check() is true, for something a hook left running in the background: an upload, a line in a log.
 * A deadline, not a number of tries: a loaded CI runner is slow, and its slowness is not a failure.
 */
export async function waitFor(check, ms = 30_000) {
    const until = Date.now() + ms;
    while (!check() && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
}

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
