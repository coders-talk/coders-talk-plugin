#!/usr/bin/env node
/**
 * Coders Talk for Claude Code: sends the current session to https://coders.talk as a draft Build.
 *
 *   node coders-talk.mjs login [--wait]         opens the browser sign-in; --wait waits for Connect and saves the token
 *   node coders-talk.mjs preview [session-id]   trims the session, saves it next to the temp dir, prints what would go
 *   node coders-talk.mjs send [session-id]      sends what preview saved, waits for the import, prints the draft link
 *   node coders-talk.mjs whoami | logout
 *   --site=https://…                            another Coders Talk (the plugin's "url" option)
 *
 * Two steps to send on purpose: the person sees the summary and says yes before anything leaves the machine,
 * and what is sent is exactly what they saw. Nothing is published: that happens on the site.
 * The token never passes through the model: the browser sign-in hands it straight to this script.
 * Needs Node.js 20 or newer and nothing else.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { pluginOption } from './lib/config.mjs';
import { clearPendingLogin, forgetToken, pendingLogin, savedToken, savePendingLogin, saveToken } from './lib/credentials.mjs';
import { gitContext } from './lib/git.mjs';
import { SESSION_ID, cutOwnCommand, findTranscript, formatBytes, formatDuration, summarize } from './lib/session.mjs';
import { readSidecar } from './lib/sidecar.mjs';
import { slimJsonl } from './lib/slim.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8')).version;
const MAX_UPLOAD = 20 * 1024 * 1024;
const PREPARED_TTL_MS = 30 * 60 * 1000;
const POLL_MS = Number(process.env.CODERS_TALK_POLL_MS) || 2000;
const POLL_FOR_MS = 3 * 60 * 1000;
// Claude Code stops a command after about two minutes; a login still waiting then picks up again on the next run.
const LOGIN_WAIT_MS = Number(process.env.CODERS_TALK_LOGIN_WAIT_MS) || 100_000;
const STAGES = { fetching: 'Reading the session', scanning: 'Scanning for secrets', labeling: 'Proposing moments', saving: 'Saving the draft' };

class Failure extends Error {}

const env = process.env;
const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [command, argId] = args.filter((a) => !a.startsWith('--'));

// --site for scripts and tests, then the environment, then the plugin's "url" option as Claude Code saved it.
const isUrl = (value) => typeof value === 'string' && /^https?:\/\/[^\s$]+$/.test(value);
const site = [option('site'), env.CODERS_TALK_URL, pluginOption('url'), 'https://coders.talk'].find(isUrl).replace(/\/+$/, '');
const token = env.CODERS_TALK_TOKEN || env.CLAUDE_PLUGIN_OPTION_TOKEN || savedToken(site) || '';

try {
    if (Number(process.versions.node.split('.')[0]) < 20) {
        throw new Failure(`The Coders Talk plugin needs Node.js 20 or newer (this is ${process.version}). Or upload the session at ${site}/new.`);
    }
    if (command === 'preview') preview(sessionId());
    else if (command === 'send') await send(sessionId());
    else if (command === 'login') await login();
    else if (command === 'whoami') await whoami();
    else if (command === 'logout') logout();
    else throw new Failure('Usage: coders-talk.mjs login | preview [session-id] | send [session-id] | whoami | logout [--site=URL]');
} catch (e) {
    console.error(e instanceof Failure ? e.message : `Unexpected error: ${e?.message ?? e}`);
    process.exit(1);
}

function sessionId() {
    const id = argId || env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || '';
    if (!SESSION_ID.test(id)) throw new Failure('Could not tell which session this is. Run the command from inside a Claude Code session.');

    return id;
}

function notConnected() {
    return new Failure(`This computer is not connected to ${site} yet. Run /coders-talk:login first: it signs you in through the browser.`);
}

function prepared(id) {
    const dir = join(tmpdir(), 'coders-talk');
    mkdirSync(dir, { recursive: true });

    return { file: join(dir, `${id}.jsonl.gz`), meta: join(dir, `${id}.json`) };
}

function preview(id) {
    const path = findTranscript(id);
    if (!path) throw new Failure(`Could not find this session's transcript (${id}.jsonl) under the Claude Code config folder.`);

    const raw = readFileSync(path, 'utf8');
    const { text } = cutOwnCommand(raw);
    const stats = summarize(text);
    const slim = slimJsonl(text);
    if (slim === null) throw new Failure('This session file is not in the format Claude Code writes, so it cannot be sent.');
    if (slim.trim() === '' || stats.prompts === 0) throw new Failure('There is nothing to send yet: the session has no prompts before this command.');

    const gz = gzipSync(Buffer.from(slim, 'utf8'));
    if (gz.length > MAX_UPLOAD) {
        throw new Failure(`Even trimmed and compressed this session is ${formatBytes(gz.length)}, over the 20 MB limit. Split the work into shorter sessions, or upload it at ${site}/new.`);
    }

    const sidecar = readSidecar(id);
    const git = gitContext(sidecar?.cwd ?? stats.cwd, sidecar?.head ?? null, stats.startedAt);

    const out = prepared(id);
    writeFileSync(out.file, gz);
    writeFileSync(out.meta, JSON.stringify({ session_id: id, created_at: Date.now(), git }));

    console.log(`Ready to send to ${site}. Nothing is published: you review and publish the draft on the site.`);
    console.log(`  Project:    ${stats.project ?? 'unknown'}`);
    console.log(`  Prompts:    ${stats.prompts}, tool calls: ${stats.toolCalls}`);
    console.log(`  Time span:  ${formatDuration(stats.durationSec)}`);
    console.log(`  Size:       ${formatBytes(Buffer.byteLength(raw))} session → ${formatBytes(Buffer.byteLength(slim))} without images and long tool output → ${formatBytes(gz.length)} compressed`);
    if (git) console.log(`  Git:        ${describeGit(git)}`);
    console.log('Secrets are replaced with [REDACTED] on the server before a model sees anything, and you check each one before publishing.');
    if (!token) console.log(`Not connected to ${site} yet: run /coders-talk:login before sending.`);
}

async function send(id) {
    if (!token) throw notConnected();

    const out = prepared(id);
    if (!existsSync(out.file) || Date.now() - statSync(out.file).mtimeMs > PREPARED_TTL_MS) {
        throw new Failure('Nothing prepared to send. Run the preview step first, then confirm.');
    }

    const meta = JSON.parse(readFileSync(out.meta, 'utf8'));
    const form = new FormData();
    form.append('agent', 'claude-code');
    form.append('session_id', id);
    form.append('client_version', VERSION);
    if (meta.git) form.append('git', JSON.stringify(meta.git));
    form.append('file', new Blob([readFileSync(out.file)], { type: 'application/gzip' }), `${id}.jsonl.gz`);

    const started = await api('POST', '/api/v1/imports', form);
    rmSync(out.file, { force: true });
    rmSync(out.meta, { force: true });

    console.log(`${started.reused ? 'Updating the draft of this session' : 'Draft created'}: ${started.edit_url}`);

    let state = started;
    let stage = null;
    const deadline = Date.now() + POLL_FOR_MS;
    while (state.status === 'queued' || state.status === 'running') {
        if (Date.now() > deadline) {
            console.log(`Still importing. The draft page shows the progress: ${started.edit_url}`);
            return;
        }
        await sleep(POLL_MS);
        state = await api('GET', new URL(started.status_url).pathname);
        if (state.stage && state.stage !== stage) {
            stage = state.stage;
            console.log(`  ${STAGES[stage] ?? stage}…`);
        }
    }

    if (state.status === 'failed') throw new Failure(`The import failed: ${state.error} The draft is still there: ${started.edit_url}`);

    const r = state.result ?? {};
    const secrets = (r.secrets ?? 0) + (r.warnings ?? 0);
    console.log(`Imported ${r.turns ?? 0} turns${r.moments_created ? ', with suggested moments' : ''}.`);
    if (r.label_skipped) console.log('The draft already had a timeline, so it was kept as it is; the new turns are waiting in its side rail.');
    if (r.label_error) console.log(`No suggestions this time (${r.label_error}); the timeline can be built by hand.`);
    if (secrets) console.log(`${secrets} possible secret${secrets === 1 ? '' : 's'} redacted: check them on the draft before publishing.`);
    console.log(`Review and publish: ${started.edit_url}`);
}

/**
 * Browser sign-in in two steps, because Claude Code shows a command's output only when it ends:
 * login opens the approval page and returns at once, login --wait then waits for the click.
 * The page and this output show the same short code, so a link from someone else is easy to spot.
 */
async function login() {
    if (token && !args.includes('--wait')) {
        try {
            const me = await api('GET', '/api/v1/me');
            console.log(`Already connected to ${site} as @${me.username}. To connect again, run: logout, then login.`);
            return;
        } catch {
            // The saved token no longer works: sign in again below.
        }
    }

    if (args.includes('--wait')) return waitForApproval();

    // Always a fresh request: continuing an earlier one is what --wait is for.
    const codes = await api('POST', '/api/v1/device/codes', json({ client_name: `Claude Code on ${hostname()}`.slice(0, 60), client_version: VERSION }), false);
    const pending = {
        site,
        device_code: codes.device_code,
        user_code: codes.user_code,
        url: codes.verification_url_complete ?? codes.verification_url,
        interval: codes.interval,
        expires_at: Date.now() + codes.expires_in * 1000,
    };
    savePendingLogin(pending);
    openBrowser(pending.url);

    console.log(`Opened ${pending.url} in the browser. Check that the page shows the code ${pending.user_code} and press Connect.`);
    console.log('If no browser opened, open that link yourself.');
}

async function waitForApproval() {
    const pending = pendingLogin(site);
    if (!pending) {
        if (token) return console.log(`Connected to ${site}.`);
        throw new Failure('Nothing to wait for: run /coders-talk:login to start.');
    }

    const deadline = Math.min(Date.now() + LOGIN_WAIT_MS, pending.expires_at);
    while (Date.now() < deadline) {
        const state = await api('POST', '/api/v1/device/token', json({ device_code: pending.device_code }), false);
        if (state.status === 'approved') {
            saveToken(site, state.token, state.username);
            clearPendingLogin();
            console.log(`Connected to ${site} as @${state.username}. /coders-talk:build can send sessions now.`);
            return;
        }
        if (state.status !== 'pending') {
            clearPendingLogin();
            throw new Failure(state.status === 'denied' ? 'The connection was cancelled in the browser. Run /coders-talk:login to try again.' : 'The link expired. Run /coders-talk:login for a new one.');
        }
        await sleep(Math.max(POLL_MS, (pending.interval ?? 5) * 1000));
    }

    console.log(`Still waiting for Connect at ${pending.url} (code ${pending.user_code}).`);
}

function logout() {
    const forgot = forgetToken(site);
    clearPendingLogin();
    console.log(forgot
        ? `Signed out of ${site} on this computer. The token still exists on the site: remove it under Settings → Agent plugins.`
        : `This computer was not signed in to ${site}.`);
}

/** The repository address goes with the session, so the person sees it here; the diff never does. */
function describeGit(git) {
    const where = git.remote ? `${git.remote} (linked on the Build only if the repository is public)` : 'no GitHub remote, the address is not sent';
    const n = git.commits.count;
    const made = n ? `${n} commit${n === 1 ? '' : 's'} in this session` : 'no commits in this session';
    const files = git.shortstat?.files;
    const size = git.shortstat ? `, ${files} file${files === 1 ? '' : 's'} +${git.shortstat.insertions} −${git.shortstat.deletions}` : '';

    return `${where}${git.branch ? `, branch ${git.branch}` : ''}; ${made}${size}. Commit titles are sent, the diff is not.`;
}

async function whoami() {
    if (!token) throw notConnected();
    const me = await api('GET', '/api/v1/me');
    console.log(`Connected to ${site} as @${me.username} (token "${me.token.name}").`);
}

/** Best effort: if no browser opens, the printed link is there. */
function openBrowser(url) {
    if (env.CODERS_TALK_NO_BROWSER) return;
    const [cmd, cmdArgs] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
    try {
        spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
    } catch {
        // The link is printed anyway.
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(data) {
    return { json: data };
}

async function api(method, path, body, authorized = true) {
    const headers = { Accept: 'application/json', 'User-Agent': `cloud-plugin/${VERSION}` };
    if (authorized) headers.Authorization = `Bearer ${token}`;
    if (body?.json) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body.json);
    }

    let response;
    try {
        response = await fetch(site + path, { method, body, headers });
    } catch (e) {
        throw new Failure(`Could not reach ${site}: ${e.cause?.message ?? e.message}`);
    }

    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;

    const error = data.error ?? {};
    const link = error.edit_url ? ` ${error.edit_url}` : '';
    if (response.status === 401) throw new Failure(`The saved token was not accepted (revoked or from another site). Run /coders-talk:login to connect again.`);
    throw new Failure(`${error.message ?? `The site answered ${response.status}.`}${link}`);
}
