/**
 * Tokens the browser sign-in saved, per site: ~/.coders-talk/credentials.json, readable by this user only.
 * Kept out of Claude Code's own settings on purpose: nothing here ever passes through the model.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function home(env = process.env) {
    return env.CODERS_TALK_HOME || join(homedir(), '.coders-talk');
}

function read(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return {};
    }
}

function write(path, data) {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
    try {
        chmodSync(path, 0o600);
    } catch {
        // Windows keeps the user profile private already.
    }
}

const credentialsFile = (dir) => join(dir, 'credentials.json');
const pendingFile = (dir) => join(dir, 'login-pending.json');

export function savedToken(site, dir = home()) {
    return read(credentialsFile(dir))[site]?.token ?? null;
}

export function saveToken(site, token, username, dir = home()) {
    const all = read(credentialsFile(dir));
    all[site] = { token, username, saved_at: new Date().toISOString() };
    write(credentialsFile(dir), all);
}

export function forgetToken(site, dir = home()) {
    const all = read(credentialsFile(dir));
    if (!all[site]) return false;
    delete all[site];
    write(credentialsFile(dir), all);

    return true;
}

/** A sign-in waiting for approval in the browser, so running login again keeps the same code. */
export function pendingLogin(site, dir = home(), now = Date.now()) {
    const pending = read(pendingFile(dir));

    return pending.site === site && pending.expires_at > now ? pending : null;
}

export function savePendingLogin(pending, dir = home()) {
    write(pendingFile(dir), pending);
}

export function clearPendingLogin(dir = home()) {
    if (existsSync(pendingFile(dir))) rmSync(pendingFile(dir), { force: true });
}
