/**
 * Auto mode (/coders-talk:auto): whether this computer sends Claude Code sessions to a Coders Talk site by itself
 * when they end. Off unless the person turns it on here, per site: a team can ask for it, never switch it on.
 *
 *   all   every session: to the team's space when the repository is one of the person's teams', else to their
 *         private Builds
 *   team  only sessions in repositories of teams that ask for it (auto_capture); everything else stays here
 *
 * ~/.coders-talk/auto.json holds the choice; ~/.coders-talk/auto.log says what happened to each session, so the
 * person can always check what left the machine without being asked.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { home } from './credentials.mjs';

export const AUTO_MODES = ['all', 'team'];
const LOG_LINES = 500;

const configFile = (dir) => join(dir, 'auto.json');
export const logFile = (dir = home()) => join(dir, 'auto.log');

function read(dir) {
    try {
        return JSON.parse(readFileSync(configFile(dir), 'utf8'));
    } catch {
        return {};
    }
}

/** 'all', 'team', or null when auto mode is off for this site (or CODERS_TALK_AUTO=0 turns it off for a shell). */
export function autoMode(site, dir = home(), env = process.env) {
    if (env.CODERS_TALK_AUTO === '0') return null;
    const mode = read(dir)[site]?.mode;

    return AUTO_MODES.includes(mode) ? mode : null;
}

export function setAutoMode(site, mode, dir = home()) {
    const all = read(dir);
    if (mode) all[site] = { mode, since: new Date().toISOString() };
    else delete all[site];
    mkdirSync(dir, { recursive: true });
    writeFileSync(configFile(dir), JSON.stringify(all, null, 2));
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
