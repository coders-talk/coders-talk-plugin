/**
 * Git context of a session: which repository, which commits the session made, how big the change was.
 * Never the diff itself: its content is already in the transcript, and more of it would only mean more secrets.
 * Everything here is best effort: no git, no repository or a failing command gives null, never an error.
 */
import { execFileSync } from 'node:child_process';

export const MAX_SUBJECTS = 20;

function git(cwd, args) {
    try {
        return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
    } catch {
        return null;
    }
}

export function currentHead(cwd) {
    return cwd ? git(cwd, ['rev-parse', 'HEAD']) : null;
}

/**
 * https://github.com/{owner}/{repo} for any GitHub form of the origin address (https, ssh, scp-like, with or without
 * .git or credentials); null for every other host, which the site does not link to.
 */
export function normalizeRemote(url) {
    if (!url) return null;
    const match = url.trim().match(/^(?:(?:https?|ssh|git):\/\/)?(?:[^@/\s]+@)?(?:www\.)?github\.com[:/]+([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i);

    return match ? `https://github.com/${match[1]}/${match[2]}` : null;
}

/** "12 files changed, 340 insertions(+), 85 deletions(-)" as numbers. */
export function parseShortstat(line) {
    if (!line) return null;
    const count = (pattern) => Number(line.match(pattern)?.[1] ?? 0);

    return { files: count(/(\d+) files? changed/), insertions: count(/(\d+) insertions?\(\+\)/), deletions: count(/(\d+) deletions?\(-\)/) };
}

/**
 * @param cwd        the session's working folder
 * @param headStart  HEAD when the session started (the SessionStart hook), or null
 * @param startedAt  the session's first timestamp in ms, to estimate headStart when the hook did not run
 */
export function gitContext(cwd, headStart, startedAt) {
    if (!cwd || git(cwd, ['rev-parse', '--is-inside-work-tree']) !== 'true') return null;

    const headEnd = currentHead(cwd);
    if (!headEnd) return null;

    // Installed mid-session, or the hook could not run: the last commit before the session began is the best guess.
    let estimated = false;
    if (!headStart && startedAt) {
        headStart = git(cwd, ['rev-list', '-1', `--before=${new Date(startedAt).toISOString()}`, 'HEAD']) || null;
        estimated = headStart !== null;
    }

    const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const context = {
        remote: normalizeRemote(git(cwd, ['remote', 'get-url', 'origin'])),
        branch: branch && branch !== 'HEAD' ? branch : null,
        head_start: headStart,
        head_end: headEnd,
        commits: { count: 0, subjects: [] },
        shortstat: null,
    };
    if (estimated) context.head_start_estimated = true;

    if (headStart && headStart !== headEnd) {
        const range = `${headStart}..${headEnd}`;
        const subjects = git(cwd, ['log', '--format=%s', `--max-count=${MAX_SUBJECTS}`, range]);
        context.commits = {
            count: Number(git(cwd, ['rev-list', '--count', range]) ?? 0),
            subjects: subjects ? subjects.split('\n').map((s) => s.slice(0, 200)) : [],
        };
        context.shortstat = parseShortstat(git(cwd, ['diff', '--shortstat', headStart, headEnd]));
    }

    return context;
}
