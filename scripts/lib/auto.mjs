/**
 * Auto mode (/coders-talk:auto): whether this computer sends Claude Code sessions to a Coders Talk site by itself.
 * Off unless the person turns it on here, per site: a team can ask for it, never switch it on.
 *
 *   all   every session: to the team's space when the repository is one of the person's teams', else to their
 *         private Builds
 *   team  only sessions in repositories of teams that ask for it (auto_capture); everything else stays here
 *
 * A session goes while it runs (the Stop hook syncs it every SYNC_EVERY_MS of work), once more when it ends
 * (SessionEnd), and at the next start if it never said it ended: a crash, a closed terminal (SessionStart catches up).
 * The site asks the model for moments once, when the session is over.
 *
 * ~/.coders-talk/auto.json holds the choice; ~/.coders-talk/auto.log says what happened to each session, so the
 * person can always check what left the machine without being asked; ~/.coders-talk/auto-sessions.json remembers,
 * for the sessions auto mode saw, where their file is and how much of it went. Never anything from the conversation.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { home } from './credentials.mjs';

export const AUTO_MODES = ['all', 'team'];
const LOG_LINES = 500;

/** A session that is still going is sent again at most this often. */
export const SYNC_EVERY_MS = 10 * 60_000;
/** Quiet this long, a session is over; the site waits as long before it asks for moments. */
export const IDLE_MS = 30 * 60_000;
/** Written to this recently, the session is still open somewhere: its own hooks send it. */
const BUSY_MS = 2 * 60_000;
/** Sessions caught up at one start, oldest first; the rest wait for the next one. */
const CATCH_UP = 3;
const KEEP_MS = 14 * 86_400_000;

const configFile = (dir) => join(dir, 'auto.json');
const sessionsFile = (dir) => join(dir, 'auto-sessions.json');
export const logFile = (dir = home()) => join(dir, 'auto.log');

function read(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return {};
    }
}

/** Written whole and renamed into place: hooks of several sessions may write at once, and a torn file loses them all. */
function write(path, data) {
    mkdirSync(join(path, '..'), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(data, null, 2));
    renameSync(temp, path);
}

/** 'all', 'team', or null when auto mode is off for this site (or CODERS_TALK_AUTO=0 turns it off for a shell). */
export function autoMode(site, dir = home(), env = process.env) {
    if (env.CODERS_TALK_AUTO === '0') return null;
    const mode = read(configFile(dir))[site]?.mode;

    return AUTO_MODES.includes(mode) ? mode : null;
}

/** Turning it off also forgets the sessions it saw: turned on again later, it never sends what grew in between. */
export function setAutoMode(site, mode, dir = home()) {
    const all = read(configFile(dir));
    if (mode) all[site] = { mode, since: new Date().toISOString() };
    else delete all[site];
    mkdirSync(dir, { recursive: true });
    writeFileSync(configFile(dir), JSON.stringify(all, null, 2));

    if (!mode) {
        const sessions = read(sessionsFile(dir));
        if (sessions[site]) {
            delete sessions[site];
            write(sessionsFile(dir), sessions);
        }
    }
}

/** What auto mode remembers about one session of this site, or null. */
export function autoSession(site, id, dir = home()) {
    return read(sessionsFile(dir))[site]?.[id] ?? null;
}

/**
 * Remembers a session auto mode has seen (a hook ran for it while auto mode was on) and merges $patch in:
 *   path      the transcript
 *   seen      when auto mode first saw it
 *   tried     when a send last started
 *   sent      {at, size, final} of the last send the site took
 *   skip      why it is not sent again (published, not a team repository)
 */
export function trackSession(site, id, patch = {}, dir = home(), now = Date.now()) {
    const all = read(sessionsFile(dir));
    const sessions = (all[site] ??= {});
    sessions[id] = { seen: now, ...sessions[id], ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    for (const [other, s] of Object.entries(sessions)) {
        if (now - Math.max(s.seen ?? 0, s.tried ?? 0, s.sent?.at ?? 0) > KEEP_MS) delete sessions[other];
    }
    write(sessionsFile(dir), all);

    return sessions[id];
}

function fileStat(path) {
    try {
        return statSync(path);
    } catch {
        return null;
    }
}

/**
 * Whether the Stop hook sends this session now: it grew since the last send, and the last send (or the start) is
 * SYNC_EVERY_MS ago. A short session is never synced: its end sends it.
 */
export function syncDue(session, now = Date.now()) {
    if (!session?.path || session.skip) return false;
    const file = fileStat(session.path);
    if (!file || file.size <= (session.sent?.size ?? 0)) return false;

    return now - Math.max(session.seen ?? 0, session.tried ?? 0) >= SYNC_EVERY_MS;
}

/**
 * The sessions to send at a start, other than the one starting: those that grew since their last send and are not
 * being written to. One quiet for IDLE_MS goes as ended; a fresher one as still going, and the site finishes it when
 * nothing more comes. Oldest first, at most CATCH_UP.
 *
 * @return {{id: string, final: boolean}[]}
 */
export function catchUp(site, current, dir = home(), now = Date.now()) {
    const sessions = read(sessionsFile(dir))[site] ?? {};

    return Object.entries(sessions)
        .filter(([id, s]) => id !== current && s.path && !s.skip)
        .map(([id, s]) => ({ id, file: fileStat(s.path), sent: s.sent }))
        .filter(({ file, sent }) => file && file.size > (sent?.size ?? 0) && now - file.mtimeMs >= BUSY_MS)
        .sort((a, b) => a.file.mtimeMs - b.file.mtimeMs)
        .slice(0, CATCH_UP)
        .map(({ id, file }) => ({ id, final: now - file.mtimeMs >= IDLE_MS }));
}

/** Runs coders-talk.mjs with $args after the hook has returned: the agent never waits for an upload. */
export function inBackground(args, env = process.env) {
    const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'coders-talk.mjs');
    spawn(process.execPath, [script, ...args], { detached: true, stdio: 'ignore', windowsHide: true, env }).unref();
}

/** One line per session auto mode looked at; the file keeps the last few hundred. */
export function logAuto(line, dir = home(), now = new Date()) {
    mkdirSync(dir, { recursive: true });
    const path = logFile(dir);
    appendFileSync(path, `${now.toISOString()} ${line.replace(/\s+/g, ' ').trim()}\n`);
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    if (lines.length > LOG_LINES) writeFileSync(path, lines.slice(-LOG_LINES).join('\n') + '\n');
}

/** The last lines of the log, newest last. */
export function recentAuto(count = 5, dir = home()) {
    if (!existsSync(logFile(dir))) return [];

    return readFileSync(logFile(dir), 'utf8').split('\n').filter(Boolean).slice(-count);
}
