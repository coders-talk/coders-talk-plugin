/**
 * The coders-talk program the app runs, and how it runs it. No Electron here: the tests load this file under Node.
 *
 * The app carries the single coders-talk file of its own version (resources/bin, staged by scripts/stage-cli.mjs) and
 * puts it where install.sh and install.ps1 do, ~/.coders-talk/bin, unless the one there is newer or the same file. The
 * agents' hooks call the file by its path once `enable` laid the plugin out, so it must outlive the app: moved to the
 * Trash, the app leaves the agents working. A newer file there (coders-talk update) is kept.
 *
 * Every command runs with --json (scripts/coders-talk.mjs): one JSON object a line on stdout, {"error": "…"} on failure.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

export const CLI_NAME = process.platform === 'win32' ? 'coders-talk.exe' : 'coders-talk';

/** What the agents put in the environment of the commands they run: inherited by the app, they would make it pass for one. */
const AGENT_VARIABLES = ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'PI_SESSION_FILE', 'CURSOR_AGENT', 'CURSOR_TRACE_ID', 'CURSOR_TRANSCRIPT_PATH', 'ELECTRON_RUN_AS_NODE'];

export const ctHome = (env = process.env) => env.CODERS_TALK_HOME || join(homedir(), '.coders-talk');
export const installedCli = (env = process.env) => join(ctHome(env), 'bin', CLI_NAME);

/** Whether version $a is newer than $b (x.y.z), as lib/update.mjs compares them. */
export function newer(a, b) {
    const [x, y] = [a, b].map((v) => String(v).split('.').map((n) => parseInt(n, 10) || 0));
    for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);

    return false;
}

/** The version a coders-talk file says it is ("coders-talk 0.14.7"), or null when it does not run. */
export function versionOf(file, env = process.env) {
    if (!file || !existsSync(file)) return null;
    const r = spawnSync(file, ['version'], { encoding: 'utf8', timeout: 15_000, windowsHide: true, env });

    return r.status === 0 ? (r.stdout.match(/coders-talk (\d+\.\d+\.\d+)/)?.[1] ?? null) : null;
}

/**
 * Whether a coders-talk file answers the way the app reads it (--json, from 0.15): a quick command that only reads a
 * setting. An older file prints a sentence instead, and every screen of the app would fail on it.
 */
export function speaksJson(file, env = process.env) {
    const r = spawnSync(file, ['nudge', '--json'], { encoding: 'utf8', timeout: 15_000, windowsHide: true, env });
    try {
        return r.status === 0 && typeof JSON.parse(r.stdout.trim().split('\n').at(-1)).nudge === 'boolean';
    } catch {
        return false;
    }
}

/** The file's SHA-256: two builds under one version number differ in their bytes. */
function fileHash(file) {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * The file to run: {path, version, action}. action: 'dev' (CODERS_TALK_APP_CLI), 'kept' (the one in ~/.coders-talk/bin is
 * newer, or the very same file), 'installed' (there was none), 'updated' (the app's is newer, or another build under the
 * same number: the release before --json, or an earlier build of the app, which the app's own fixes would never reach
 * otherwise). Only a newer number wins over the app's copy: what `coders-talk update` installed. A running file cannot be
 * overwritten on Windows, but it can be renamed: the old one goes aside as <file>.old, which coders-talk removes at its
 * next start.
 */
export function ensureCli({ bundled, env = process.env }) {
    if (env.CODERS_TALK_APP_CLI) return { path: env.CODERS_TALK_APP_CLI, version: versionOf(env.CODERS_TALK_APP_CLI, env), action: 'dev' };

    const target = installedCli(env);
    const current = versionOf(target, env);
    const own = bundled && existsSync(bundled) ? versionOf(bundled, env) : null;
    if (!current && !own) throw new Error(`Could not find the coders-talk program: neither ${target} nor the copy inside the app runs.`);
    const same = current && own && current === own && fileHash(target) === fileHash(bundled);
    if (current && (!own || newer(current, own) || same)) {
        if (!speaksJson(target, env)) throw new Error(`coders-talk ${current} at ${target} is older than this app. Run "coders-talk update" in a terminal, or install the app again.`);
        return { path: target, version: current, action: 'kept' };
    }

    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) {
        try {
            rmSync(`${target}.old`, { force: true });
        } catch {
            // An older .old still running: renaming onto it fails below and says so.
        }
        renameSync(target, `${target}.old`);
    }
    copyFileSync(bundled, target);
    if (process.platform !== 'win32') chmodSync(target, 0o755);
    try {
        rmSync(`${target}.old`, { force: true });
    } catch {
        // Still running (a hook): coders-talk removes it at its next start.
    }

    return { path: target, version: own, action: current ? 'updated' : 'installed' };
}

/**
 * PATH as the person's shell has it. An app opened from the Dock or Finder gets launchd's short PATH, without the folders
 * claude, codex and pi are installed in, so coders-talk would find none of them. Windows apps get the user's PATH.
 */
export function shellPath(env = process.env, platform = process.platform) {
    if (platform === 'win32') return env.Path ?? env.PATH ?? '';
    const home = homedir();
    const extra = [join(home, '.local', 'bin'), join(home, '.coders-talk', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', join(home, '.bun', 'bin'), join(home, '.npm-global', 'bin')];
    let fromShell = '';
    const shell = env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
    try {
        // Interactive and login, as a terminal starts it; the markers keep out whatever its rc files print.
        const r = spawnSync(shell, ['-ilc', 'printf "__CT_PATH__%s__CT_PATH__" "$PATH"'], { encoding: 'utf8', timeout: 8_000, env });
        fromShell = r.stdout?.match(/__CT_PATH__(.*)__CT_PATH__/s)?.[1] ?? '';
    } catch {
        // No shell to ask: the usual folders below.
    }

    return [...new Set([...fromShell.split(delimiter), ...(env.PATH ?? '').split(delimiter), ...extra].filter(Boolean))].join(delimiter);
}

/** The environment coders-talk runs in: the app's, with the shell's PATH and nothing that says an agent runs it. */
export function cliEnv(env = process.env, path = shellPath(env)) {
    const clean = { ...env, PATH: path, CODERS_TALK_NO_UPDATE_CHECK: '1' };
    if (process.platform === 'win32') {
        delete clean.Path;
        clean.Path = path;
        delete clean.PATH;
    }
    for (const name of AGENT_VARIABLES) delete clean[name];

    return clean;
}

/**
 * The JSON lines of a command's output, as they come. Lines that are not JSON (a warning an agent's own command printed
 * through) are kept apart, for the details of an error.
 */
export class LineReader {
    constructor(onObject) {
        this.onObject = onObject;
        this.rest = '';
        this.other = [];
    }

    push(chunk) {
        this.rest += chunk;
        const lines = this.rest.split(/\r?\n/);
        this.rest = lines.pop();
        lines.forEach((l) => this.line(l));
    }

    end() {
        if (this.rest) this.line(this.rest);
        this.rest = '';
    }

    line(text) {
        const trimmed = text.trim();
        if (!trimmed) return;
        if (trimmed.startsWith('{')) {
            try {
                return this.onObject(JSON.parse(trimmed));
            } catch {
                // a line that only looks like JSON
            }
        }
        this.other.push(trimmed);
    }
}

/**
 * `coders-talk <args> --json`: {ok, result, events, error, details}. result is the last object that is not an event
 * (status, sessions, preview…); events the {"event"} lines, also handed to onEvent as they come. A run that printed
 * {"error"} or ended with another code is not ok; error says why in the program's words.
 */
export function runCli(program, args, { env, cwd, input = null, onEvent = null, signal = null, timeoutMs = 0 } = {}) {
    return new Promise((resolve) => {
        const events = [];
        let result = null;
        let error = null;
        let details = null;
        const reader = new LineReader((data) => {
            if (data.error !== undefined && data.event === undefined) {
                error = String(data.error);
                details = data.details ?? null;
            } else if (data.event !== undefined) {
                events.push(data);
                onEvent?.(data);
            } else result = data;
        });
        let stderr = '';
        let child;
        try {
            child = spawn(program, [...args, '--json'], { env, cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (e) {
            return resolve({ ok: false, result: null, events, error: `Could not start coders-talk: ${e.message}`, details: null });
        }
        const timer = timeoutMs ? setTimeout(() => child.kill(), timeoutMs) : null;
        const abort = () => child.kill();
        signal?.addEventListener('abort', abort, { once: true });
        child.stdout.setEncoding('utf8').on('data', (c) => reader.push(c));
        child.stderr.setEncoding('utf8').on('data', (c) => (stderr += c));
        child.on('error', (e) => {
            error ??= `Could not start coders-talk: ${e.message}`;
        });
        child.stdin.on('error', () => {});
        child.stdin.end(input ?? '');
        child.on('close', (code) => {
            if (timer) clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            reader.end();
            if (signal?.aborted) return resolve({ ok: false, cancelled: true, result, events, error: 'Cancelled.', details: null });
            const ok = code === 0 && error === null;
            if (!ok && error === null) error = stderr.trim().split('\n').at(-1) || `coders-talk stopped with code ${code}.`;
            const extra = [details, ...reader.other, stderr.trim()].filter(Boolean).join('\n') || null;

            resolve({ ok, result, events, error: ok ? null : error, details: ok ? null : extra });
        });
    });
}
