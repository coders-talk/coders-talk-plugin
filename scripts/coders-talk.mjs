#!/usr/bin/env node
/**
 * Coders Talk for Claude Code and Codex: sends the current session to https://coders.talk as a draft Build.
 *
 *   node coders-talk.mjs login [--wait]         opens the browser sign-in; --wait waits for Connect and saves the token
 *   node coders-talk.mjs preview [session-id]   trims the session, saves it next to the temp dir, prints what would go
 *   node coders-talk.mjs send [session-id]      sends what preview saved, waits for the import, prints the draft link
 *     --continues=<slug or link>                  the draft continues that Build of yours: they become a series
 *   node coders-talk.mjs whoami | logout
 *   --site=https://…                            another Coders Talk (the plugin's "url" option)
 *   --agent=codex                               a Codex session: the id defaults to CODEX_THREAD_ID
 *
 * Two steps to send on purpose: the person sees the summary and says yes before anything leaves the machine,
 * and what is sent is exactly what they saw. Nothing is published: that happens on the site.
 * The token never passes through the model: the browser sign-in hands it straight to this script.
 * Needs Node.js 20 or newer and nothing else.
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { pluginOption } from './lib/config.mjs';
import { clearPendingLogin, forgetToken, pendingLogin, savedToken, savePendingLogin, saveToken } from './lib/credentials.mjs';
import { gitContext } from './lib/git.mjs';
import { SESSION_ID, cutOwnCommand, findRollout, findTranscript, formatBytes, formatDuration, summarize } from './lib/session.mjs';
import { readSidecar } from './lib/sidecar.mjs';
import { slimLine } from './lib/slim.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Both manifests carry the same version; whichever the installed copy has.
const VERSION = JSON.parse(readFileSync(join(ROOT, ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json'].find((p) => existsSync(join(ROOT, p))) ?? '.claude-plugin/plugin.json'), 'utf8')).version;
const MAX_UPLOAD = 20 * 1024 * 1024;
const PREPARED_TTL_MS = 30 * 60 * 1000;
const POLL_MS = Number(process.env.CODERS_TALK_POLL_MS) || 2000;
const POLL_FOR_MS = 3 * 60 * 1000;
// Agents stop a command after a couple of minutes; a login still waiting then picks up again on the next run.
const LOGIN_WAIT_MS = Number(process.env.CODERS_TALK_LOGIN_WAIT_MS) || 100_000;
const STAGES = { fetching: 'Reading the session', scanning: 'Scanning for secrets', labeling: 'Proposing moments', saving: 'Saving the draft' };

class Failure extends Error {}

const env = process.env;
const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [command, argId] = args.filter((a) => !a.startsWith('--'));

// The same script serves both plugins; the Codex skills pass --agent=codex.
const CODEX = option('agent') === 'codex';
const AGENT = CODEX ? { id: 'codex', name: 'Codex', client: 'codex-plugin' } : { id: 'claude-code', name: 'Claude Code', client: 'claude-plugin' };
/** How the person runs one of the plugin's commands in this agent. */
const run = (name) => (CODEX ? `$coders-talk:${name}` : `/coders-talk:${name}`);

// --site for scripts and tests, then the environment, then the plugin's "url" option as Claude Code saved it.
// That option belongs to the Claude Code plugin: in Codex it would silently point at whatever was set there.
const isUrl = (value) => typeof value === 'string' && /^https?:\/\/[^\s$]+$/.test(value);
const site = [option('site'), env.CODERS_TALK_URL, CODEX ? null : pluginOption('url'), 'https://coders.talk'].find(isUrl).replace(/\/+$/, '');
const token = env.CODERS_TALK_TOKEN || env.CLAUDE_PLUGIN_OPTION_TOKEN || savedToken(site) || '';

try {
    if (Number(process.versions.node.split('.')[0]) < 20) {
        throw new Failure(`The Coders Talk plugin needs Node.js 20 or newer (this is ${process.version}). Or upload the session at ${site}/new.`);
    }
    if (command === 'preview') await preview(sessionId());
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
    const id = argId || (CODEX ? env.CODEX_THREAD_ID : env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID) || '';
    if (!SESSION_ID.test(id)) throw new Failure(`Could not tell which session this is. Run the command from inside a ${AGENT.name} session.`);

    return id;
}

function notConnected() {
    return new Failure(`This computer is not connected to ${site} yet. Run ${run('login')} first: it signs you in through the browser.`);
}

function prepared(id) {
    const dir = join(tmpdir(), 'coders-talk');
    mkdirSync(dir, { recursive: true });

    return { file: join(dir, `${id}.jsonl.gz`), meta: join(dir, `${id}.json`) };
}

async function preview(id) {
    const path = CODEX ? findRollout(id) : findTranscript(id);
    if (!path) {
        throw new Failure(CODEX
            ? `Could not find this session's rollout (rollout-…-${id}.jsonl) under the Codex sessions folder.`
            : `Could not find this session's transcript (${id}.jsonl) under the Claude Code config folder.`);
    }

    const session = await readSession(path);
    if (session === null) throw new Failure(`This session file is not in the format ${AGENT.name} writes, so it cannot be sent.`);
    const { text: slim } = cutOwnCommand(session.lines.join('\n'));
    const stats = summarize(slim, session.cwd);
    if (slim.trim() === '' || stats.prompts === 0) throw new Failure('There is nothing to send yet: the session has no prompts before this command.');

    const gz = gzipSync(Buffer.from(slim, 'utf8'));
    if (gz.length > MAX_UPLOAD) {
        throw new Failure(`Even trimmed and compressed this session is ${formatBytes(gz.length)}, over the 20 MB limit. Split the work into shorter sessions, or upload it at ${site}/new.`);
    }

    // HEAD at the start: Claude Code's SessionStart hook remembered it, Codex writes it into the session itself.
    const sidecar = CODEX ? null : readSidecar(id);
    const git = gitContext(sidecar?.cwd ?? stats.cwd, sidecar?.head ?? session.headStart, stats.startedAt);

    const out = prepared(id);
    writeFileSync(out.file, gz);
    writeFileSync(out.meta, JSON.stringify({ session_id: id, created_at: Date.now(), git }));

    console.log(`Ready to send to ${site}. Nothing is published: you review and publish the draft on the site.`);
    console.log(`  Project:    ${stats.project ?? 'unknown'}`);
    console.log(`  Prompts:    ${stats.prompts}, tool calls: ${stats.toolCalls}`);
    console.log(`  Time span:  ${formatDuration(stats.durationSec)}`);
    console.log(`  Size:       ${formatBytes(session.bytes)} session → ${formatBytes(Buffer.byteLength(slim))} without images and long tool output → ${formatBytes(gz.length)} compressed`);
    if (git) console.log(`  Git:        ${describeGit(git)}`);
    console.log('Secrets are replaced with [REDACTED] on the server before a model sees anything, and you check each one before publishing.');
    if (!token) console.log(`Not connected to ${site} yet: run ${run('login')} before sending.`);
}

/**
 * The session slimmed line by line as it is read: Codex rollouts with screenshots run to hundreds of megabytes,
 * more than fits in one string. Null when the file is not JSON lines. Also keeps what slimming drops: where the
 * session ran and, for Codex, HEAD at its start (session_meta).
 */
async function readSession(path) {
    const lines = [];
    let cwd = null;
    let headStart = null;
    let total = 0;
    let parsed = 0;
    for await (const line of createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity })) {
        if (line.trim() === '') continue;
        total++;
        let d;
        try {
            d = JSON.parse(line);
        } catch {
            continue;
        }
        parsed++;
        if (!d || typeof d !== 'object' || Array.isArray(d)) continue;

        if (d.type === 'session_meta') {
            cwd ??= typeof d.payload?.cwd === 'string' ? d.payload.cwd : null;
            headStart ??= typeof d.payload?.git?.commit_hash === 'string' ? d.payload.git.commit_hash : null;
        }
        cwd ??= typeof d.cwd === 'string' && d.cwd ? d.cwd : null;
        const slim = slimLine(d);
        if (slim) lines.push(JSON.stringify(slim));
    }

    return total < 2 || parsed < total * 0.8 ? null : { lines, cwd, headStart, bytes: statSync(path).size };
}

async function send(id) {
    if (!token) throw notConnected();

    const out = prepared(id);
    if (!existsSync(out.file) || Date.now() - statSync(out.file).mtimeMs > PREPARED_TTL_MS) {
        throw new Failure('Nothing prepared to send. Run the preview step first, then confirm.');
    }

    const meta = JSON.parse(readFileSync(out.meta, 'utf8'));
    const form = new FormData();
    form.append('agent', AGENT.id);
    form.append('session_id', id);
    form.append('client_version', VERSION);
    if (meta.git) form.append('git', JSON.stringify(meta.git));
    // The Build this session continues, as a slug or a link: the draft becomes its next part (a series).
    const continues = option('continues');
    if (continues) form.append('continues', continues);
    form.append('file', new Blob([readFileSync(out.file)], { type: 'application/gzip' }), `${id}.jsonl.gz`);

    const started = await api('POST', '/api/v1/imports', form);
    rmSync(out.file, { force: true });
    rmSync(out.meta, { force: true });

    console.log(`${started.reused ? 'Updating the draft of this session' : 'Draft created'}: ${started.edit_url}`);
    if (started.series) console.log(`Linked as the next part of the series "${started.series.title}": ${started.series.url}`);
    else if (continues) console.log(`Could not link it to "${continues}": use the link or slug of one of your own Builds. You can link it in the draft instead.`);

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
 * Browser sign-in in two steps, because the agent shows a command's output only when it ends:
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
    const codes = await api('POST', '/api/v1/device/codes', json({ client_name: `${AGENT.name} on ${hostname()}`.slice(0, 60), client_version: VERSION }), false);
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
        throw new Failure(`Nothing to wait for: run ${run('login')} to start.`);
    }

    const deadline = Math.min(Date.now() + LOGIN_WAIT_MS, pending.expires_at);
    while (Date.now() < deadline) {
        const state = await api('POST', '/api/v1/device/token', json({ device_code: pending.device_code }), false);
        if (state.status === 'approved') {
            saveToken(site, state.token, state.username);
            clearPendingLogin();
            console.log(`Connected to ${site} as @${state.username}. ${run('build')} can send sessions now.`);
            return;
        }
        if (state.status !== 'pending') {
            clearPendingLogin();
            throw new Failure(state.status === 'denied' ? `The connection was cancelled in the browser. Run ${run('login')} to try again.` : `The link expired. Run ${run('login')} for a new one.`);
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
    // Codex runs commands in a sandbox that may have no network: say so instead of a bare connection error.
    if (CODEX && env.CODEX_SANDBOX_NETWORK_DISABLED === '1') {
        throw new Failure(`Codex ran this command without network access, so it cannot reach ${site}. Run the same command again with network access (approve the request when Codex asks).`);
    }
    const headers = { Accept: 'application/json', 'User-Agent': `${AGENT.client}/${VERSION}` };
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
    if (response.status === 401) throw new Failure(`The saved token was not accepted (revoked or from another site). Run ${run('login')} to connect again.`);
    throw new Failure(`${error.message ?? `The site answered ${response.status}.`}${link}`);
}
