/**
 * The sessions of this folder, for `coders-talk sessions` and `coders-talk build` in a terminal (plan, stage 13.4): from
 * a terminal nobody knows the session id, which inside a session only the agent has.
 *
 *   Claude Code  <config>/projects/<the folder with every character but letters and digits as "-">/<id>.jsonl
 *   Codex        the rollouts of the last days whose session_meta names the folder as cwd
 *
 * A folder inside a repository also finds the sessions run at the repository's top. What was sent is remembered in
 * ~/.coders-talk/sent.json (the send step) and in auto mode's auto-sessions.json.
 */
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { autoSession } from './auto.mjs';
import { home } from './credentials.mjs';
import { repositoryRoot } from './git.mjs';
import { codexHome, configDir, isCodexPrompt, isPrompt } from './session.mjs';

const CODEX_DAYS = 30;
const ROLLOUT = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_[A-Za-z0-9-]+)?\.jsonl$/i;

const sentFile = () => join(home(), 'sent.json');
const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const normal = (path) => resolve(path).replace(/[\\/]+$/, '');

/** Both agents' sessions of $folder (and of its repository's top), newest first: [{agent, id, path, mtimeMs}]. */
export function folderSessions(folder, { env = process.env, now = Date.now() } = {}) {
    const folders = [...new Set([folder, repositoryRoot(folder)].filter(Boolean).map(normal))];
    const found = [...claudeSessions(folders, configDir(env)), ...codexSessions(folders, codexHome(env), now)];
    // A Codex thread reverted has several rollouts: the newest stands for it.
    const newest = new Map();
    for (const s of found.sort((a, b) => b.mtimeMs - a.mtimeMs)) if (!newest.has(`${s.agent}:${s.id}`)) newest.set(`${s.agent}:${s.id}`, s);

    return [...newest.values()];
}

function claudeSessions(folders, dir) {
    const projects = join(dir, 'projects');
    let names;
    try {
        names = readdirSync(projects);
    } catch {
        return [];
    }
    const wanted = folders.map((f) => f.replace(/[^a-zA-Z0-9]/g, '-'));

    return names
        .filter((name) => wanted.some((w) => samePath(w, name)))
        .flatMap((name) => files(join(projects, name)).filter((f) => f.endsWith('.jsonl')).map((f) => ({ agent: 'claude-code', id: f.slice(0, -6), path: join(projects, name, f) })))
        .map(withTime)
        .filter(Boolean);
}

function codexSessions(folders, dir, now) {
    const oldest = new Date(now - CODEX_DAYS * 86_400_000).toISOString().slice(0, 10);
    const found = [];
    const root = join(dir, 'sessions');
    for (const year of files(root)) {
        for (const month of files(join(root, year))) {
            for (const day of files(join(root, year, month))) {
                if (`${year}-${month}-${day}` < oldest) continue;
                for (const name of files(join(root, year, month, day))) {
                    const id = name.match(ROLLOUT)?.[1];
                    const path = join(root, year, month, day, name);
                    const cwd = id ? rolloutCwd(path) : null;
                    if (cwd && folders.some((f) => samePath(f, normal(cwd)))) found.push({ agent: 'codex', id, path });
                }
            }
        }
    }

    return found.map(withTime).filter(Boolean);
}

/** The cwd in the rollout's first line (session_meta), read from its start only: rollouts run to hundreds of megabytes. */
function rolloutCwd(path) {
    const buffer = Buffer.alloc(256 * 1024);
    let fd;
    try {
        fd = openSync(path, 'r');
        const text = buffer.toString('utf8', 0, readSync(fd, buffer, 0, buffer.length, 0));
        const raw = text.split('\n')[0].match(/"type":"session_meta".*?"cwd":"((?:[^"\\]|\\.)*)"/)?.[1];

        return raw === undefined ? null : JSON.parse(`"${raw}"`);
    } catch {
        return null;
    } finally {
        if (fd !== undefined) closeSync(fd);
    }
}

/** What the list shows of a session: {prompts, firstPrompt}. Reads the file line by line, parsing only the person's lines. */
export async function describeSession({ agent, path }) {
    const marker = agent === 'codex' ? '"role":"user"' : '"type":"user"';
    let prompts = 0;
    let firstPrompt = null;
    for await (const line of createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity })) {
        if (!line.includes(marker)) continue;
        let d;
        try {
            d = JSON.parse(line);
        } catch {
            continue;
        }
        const text = agent === 'codex' ? codexPrompt(d) : claudePrompt(d);
        if (text === null) continue;
        prompts++;
        firstPrompt ??= text.replace(/\s+/g, ' ').trim();
    }

    return { prompts, firstPrompt };
}

function claudePrompt(d) {
    const content = d?.message?.content;
    if (d?.type !== 'user' || d.isMeta || !isPrompt(content)) return null;

    return typeof content === 'string' ? content : content.filter((b) => b?.type === 'text').map((b) => b.text).join(' ');
}

function codexPrompt(d) {
    const p = d?.type === 'response_item' ? d.payload : null;
    if (p?.type !== 'message' || p.role !== 'user' || !isCodexPrompt(p.content)) return null;

    return p.content.filter((b) => typeof b?.text === 'string' && !b.text.trimStart().startsWith('<')).map((b) => b.text).join(' ');
}

/** When a session was sent to $site last, by the send step or auto mode, or null. */
export function sentAt(site, id) {
    const manual = readSent()[site]?.[id]?.at ?? 0;
    const auto = autoSession(site, id)?.sent?.at ?? 0;

    return Math.max(manual, auto) || null;
}

/** Remembered after the send step: the draft's link and when. */
export function markSent(site, id, url, now = Date.now()) {
    const all = readSent();
    (all[site] ??= {})[id] = { at: now, url };
    mkdirSync(home(), { recursive: true });
    writeFileSync(sentFile(), JSON.stringify(all, null, 2));
}

function readSent() {
    try {
        return existsSync(sentFile()) ? JSON.parse(readFileSync(sentFile(), 'utf8')) : {};
    } catch {
        return {};
    }
}

function files(dir) {
    try {
        return readdirSync(dir);
    } catch {
        return [];
    }
}

function withTime(s) {
    try {
        return { ...s, mtimeMs: statSync(s.path).mtimeMs };
    } catch {
        return null;
    }
}
