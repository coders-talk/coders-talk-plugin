#!/usr/bin/env node
/**
 * Coders Talk for Claude Code and Codex: sends the current session to https://coders.talk as a draft Build.
 *
 *   node coders-talk.mjs login [--wait]         opens the browser sign-in; --wait waits for Connect and saves the token
 *   node coders-talk.mjs preview [session-id]   trims the session, saves it next to the temp dir, prints what would go and where
 *     --private | --team=<slug>                   only you see the draft / that team does; by default the site decides by the
 *                                                 repository: a team's repositories go to the team, the rest stays private
 *   node coders-talk.mjs send [session-id]      sends what preview saved, waits for the import, prints the draft link
 *     --continues=<slug or link>                  the draft continues that Build of yours: they become a series
 *   node coders-talk.mjs auto [on|team|off]     auto mode for this computer and agent: send sessions by themselves while
 *                                                 they run and when they end (all of them, or only those in repositories of
 *                                                 teams that ask); Claude Code and Codex are switched separately
 *   node coders-talk.mjs auto-send <session-id> what the SessionEnd hook runs in the background when auto mode is on
 *     --sync                                      the Stop hook's send of a session that is still going
 *   node coders-talk.mjs auto-catch-up <session-id>  what the SessionStart hook runs: sends the sessions that never said
 *                                                 they ended (lib/auto.mjs, catchUp), other than the one starting
 *   node coders-talk.mjs whoami | logout
 *   --site=https://…                            another Coders Talk (the plugin's "url" option)
 *   --agent=codex                               a Codex session: the id defaults to CODEX_THREAD_ID
 *
 * Two steps to send on purpose: the person sees the summary and says yes before anything leaves the machine,
 * and what is sent is exactly what they saw, going where they saw. Nothing is published: that happens on the site,
 * and a draft is visible only to its sender, or to the team whose repository the session ran in.
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
import { AUTO_MODES, autoMode, catchUp, logAuto, logFile, recentAuto, setAutoMode, trackSession } from './lib/auto.mjs';
import { siteUrl } from './lib/config.mjs';
import { clearPendingLogin, forgetToken, pendingLogin, savedToken, savePendingLogin, saveToken } from './lib/credentials.mjs';
import { gitContext } from './lib/git.mjs';
import { request } from './lib/http.mjs';
import { SESSION_ID, cutOwnCommand, findRollout, findTranscript, formatBytes, formatDuration, summarize } from './lib/session.mjs';
import { readSidecar } from './lib/sidecar.mjs';
import { agentTimes, gitChangeLines, withGitLines } from './lib/snapshots.mjs';
import { slimLine } from './lib/slim.mjs';
import { UsageCounter } from './lib/usage.mjs';

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
// The end of a session is sent again when the site is busy with its last sync, throttled or unreachable. The first
// retry comes quickly: a sync takes a second or two to import, and Codex ends a session-end hook's upload when it exits.
const RETRY_MS = Number(process.env.CODERS_TALK_RETRY_MS) ? [Number(process.env.CODERS_TALK_RETRY_MS)] : [1500, 5000, 15000];
const AUTO_TRIES = 4;

class Failure extends Error {}

const env = process.env;
const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [command, argId] = args.filter((a) => !a.startsWith('--'));

// Where the draft goes: "personal" (--private), a team's slug (--team=acme), or null to let the site decide by the repository.
const SPACE = args.includes('--private') ? 'personal' : option('team')?.trim().toLowerCase() || null;

// The same script serves both plugins; the Codex skills pass --agent=codex.
const CODEX = option('agent') === 'codex';
const AGENT = CODEX ? { id: 'codex', name: 'Codex', client: 'codex-plugin' } : { id: 'claude-code', name: 'Claude Code', client: 'claude-plugin' };
/** How the person runs one of the plugin's commands in this agent. */
const run = (name) => (CODEX ? `$coders-talk:${name}` : `/coders-talk:${name}`);

const site = siteUrl(option('site'), CODEX);
const token = env.CODERS_TALK_TOKEN || env.CLAUDE_PLUGIN_OPTION_TOKEN || savedToken(site) || '';

try {
    if (Number(process.versions.node.split('.')[0]) < 20) {
        throw new Failure(`The Coders Talk plugin needs Node.js 20 or newer (this is ${process.version}). Or upload the session at ${site}/new.`);
    }
    if (command === 'preview') await preview(sessionId());
    else if (command === 'send') await send(sessionId());
    else if (command === 'auto') await auto(argId);
    else if (command === 'auto-send') await autoSend(argId, { final: !args.includes('--sync') });
    else if (command === 'auto-catch-up') await autoCatchUp(argId);
    else if (command === 'login') await login();
    else if (command === 'whoami') await whoami();
    else if (command === 'logout') logout();
    else throw new Failure('Usage: coders-talk.mjs login | preview [session-id] | send [session-id] | auto [on|team|off] | whoami | logout [--site=URL]');
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

/**
 * The session read, slimmed and packed, with what goes along with it: the git context and the tokens it spent.
 * The preview and auto mode send the same thing. A command run cuts itself off the end ($cut); a session that ended
 * by itself has no command in it to cut, and cutting at an earlier /coders-talk:build would lose the rest.
 */
async function prepare(id, cut = true) {
    const path = CODEX ? findRollout(id) : findTranscript(id);
    if (!path) {
        throw new Failure(CODEX
            ? `Could not find this session's rollout (rollout-…-${id}.jsonl) under the Codex sessions folder.`
            : `Could not find this session's transcript (${id}.jsonl) under the Claude Code config folder.`);
    }

    const session = await readSession(path);
    if (session === null) throw new Failure(`This session file is not in the format ${AGENT.name} writes, so it cannot be sent.`);
    const kept = cut ? cutOwnCommand(session.lines.join('\n')).text : session.lines.join('\n');
    // What the git snapshots saw at each turn (Claude Code hooks, lib/snapshots.mjs), put into the session by time.
    const gitLines = CODEX ? [] : gitChangeLines(id, agentTimes(session.lines));
    const slim = withGitLines(kept.split('\n'), gitLines).join('\n');
    if (gitLines.length) session.code = gitCode(gitLines);
    const stats = summarize(kept, session.cwd);
    if (slim.trim() === '' || stats.prompts === 0) throw new Failure('There is nothing to send yet: the session has no prompts before this command.');

    const gz = gzipSync(Buffer.from(slim, 'utf8'));
    if (gz.length > MAX_UPLOAD) {
        throw new Failure(`Even trimmed and compressed this session is ${formatBytes(gz.length)}, over the 20 MB limit. Split the work into shorter sessions, or upload it at ${site}/new.`);
    }

    // HEAD at the start: Claude Code's SessionStart hook remembered it, Codex writes it into the session itself.
    const sidecar = CODEX ? null : readSidecar(id);
    const git = gitContext(sidecar?.cwd ?? stats.cwd, sidecar?.head ?? session.headStart, stats.startedAt);

    return { session, slim, stats, gz, git, usage: session.usage };
}

async function preview(id) {
    if (SPACE && !/^[a-z0-9-]{1,40}$/.test(SPACE)) throw new Failure(`"${SPACE}" is not a team address. Use the part after /t/ in the team's link.`);
    const { session, slim, stats, gz, git, usage } = await prepare(id);

    const goesTo = await destination(git);

    const out = prepared(id);
    writeFileSync(out.file, gz);
    writeFileSync(out.meta, JSON.stringify({ session_id: id, created_at: Date.now(), git, space: SPACE, usage }));

    console.log(`Ready to send to ${site}. Nothing is published: you review and publish the draft on the site.`);
    console.log(`  Project:    ${stats.project ?? 'unknown'}`);
    console.log(`  Prompts:    ${stats.prompts}, tool calls: ${stats.toolCalls}`);
    console.log(`  Time span:  ${formatDuration(stats.durationSec)}`);
    console.log(`  Size:       ${formatBytes(session.bytes)} session → ${formatBytes(Buffer.byteLength(slim))} without images and long tool output → ${formatBytes(gz.length)} compressed`);
    if (git) console.log(`  Git:        ${describeGit(git)}`);
    if (session.code.files.size) console.log(`  Code:       ${describeCode(session.code)}`);
    if (usage) console.log(`  Tokens:     ${describeUsage(usage)}`);
    console.log(`  Goes to:    ${goesTo}`);
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
    const usage = new UsageCounter();
    // Shared by every line: slimming learns the session folder from it, to make changed paths relative (plan, stage 11.1).
    const ctx = {};
    const code = { files: new Set(), additions: 0, deletions: 0, withheld: new Set() };
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
        // Counted before slimming drops the lines that carry it; only the counts leave the machine.
        usage.add(d);
        const slim = slimLine(d, ctx);
        if (slim) {
            lines.push(JSON.stringify(slim));
            countChanges(slim, code);
        }
    }

    return total < 2 || parsed < total * 0.8 ? null : { lines, cwd, headStart, bytes: statSync(path).size, usage: usage.result(), code };
}

/** The files a slimmed line says the agent changed: on a Claude Code tool result, or on a Codex call. */
function countChanges(slim, code) {
    const blocks = Array.isArray(slim.message?.content) ? slim.message.content : [];
    const changes = [...blocks.map((b) => b?.change).filter(Boolean), ...(Array.isArray(slim.payload?.changes) ? slim.payload.changes : [])];
    for (const c of changes) {
        code.files.add(c.path);
        code.additions += c.additions ?? 0;
        code.deletions += c.deletions ?? 0;
        if (c.withheld) code.withheld.add(c.path);
    }
}

/** The code count from git snapshots, which replace the session's own edits on the site. */
function gitCode(gitLines) {
    const code = { files: new Set(), additions: 0, deletions: 0, withheld: new Set(), human: new Set(), commits: 0, git: true };
    for (const line of gitLines) {
        countChanges({ payload: { changes: line.changes } }, code);
        if (line.by === 'human') line.changes.forEach((c) => code.human.add(c.path));
        code.commits += line.commits.length;
    }

    return code;
}

/** "3 files (+40 −12), as diffs from git snapshots, 1 changed by hand; .env by name only" */
function describeCode(code) {
    const source = code.git ? ' from git snapshots' : '';
    const hand = code.human?.size ? `, ${code.human.size} changed by hand` : '';
    const commits = code.commits ? `, ${code.commits} commit${code.commits === 1 ? '' : 's'} with their SHA` : '';
    const files = `${code.files.size} file${code.files.size === 1 ? '' : 's'} (+${code.additions} −${code.deletions}), as diffs${source}${hand}${commits}`;
    const names = [...code.withheld].slice(0, 3).join(", ") + (code.withheld.size > 3 ? ", …" : "");

    return code.withheld.size ? `${files}; ${names} by name only` : files;
}

async function send(id) {
    if (!token) throw notConnected();

    const out = prepared(id);
    if (!existsSync(out.file) || Date.now() - statSync(out.file).mtimeMs > PREPARED_TTL_MS) {
        throw new Failure('Nothing prepared to send. Run the preview step first, then confirm.');
    }

    const meta = JSON.parse(readFileSync(out.meta, 'utf8'));
    // The Build this session continues, as a slug or a link: the draft becomes its next part (a series).
    const continues = option('continues');
    // Only a space the person chose; otherwise the site routes by the repository, as the preview said.
    const form = importForm(id, readFileSync(out.file), { git: meta.git, usage: meta.usage, space: meta.space, continues });

    let started;
    try {
        started = await api('POST', '/api/v1/imports', form);
    } catch (e) {
        if (!e.unavailable) throw e;
        throw uploadByHand(out.file, e);
    }
    rmSync(out.file, { force: true });
    rmSync(out.meta, { force: true });

    const team = started.space?.type === 'team' ? started.space : null;
    const where = team ? ` in ${team.name} (the team sees it, nobody else)` : started.space ? ' (private: only you see it)' : '';
    console.log(`${started.reused ? 'Updating the draft of this session' : 'Draft created'}${where}: ${started.edit_url}`);
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
    console.log(`${team ? 'Review it' : 'Review and publish'}: ${started.edit_url}`);
}

/**
 * Where the draft will go, said before anything is sent. The site decides in the end (TeamRouter), by the same rule:
 * a named team, else the one team whose GitHub owners include the repository's, else the sender's private Builds.
 * The teams come from /api/v1/me; without them (offline, not connected) the rule is spelled out instead.
 */
async function destination(git) {
    const own = 'your private Builds: only you see the draft';
    if (SPACE === 'personal') return own;

    let teams = null;
    if (token) {
        try {
            teams = (await api('GET', '/api/v1/me', undefined, true, 5000)).teams ?? [];
        } catch {
            // The send step talks to the site anyway; here the rule is enough.
        }
    }

    if (SPACE) {
        const team = teams?.find((t) => t.slug === SPACE);
        if (teams && !team) throw new Failure(`You are not in a team called "${SPACE}".${teams.length ? ` Your teams: ${teams.map((t) => t.slug).join(', ')}.` : ''}`);

        return `the ${team?.name ?? SPACE} team: the team sees the draft, nobody else`;
    }

    const owner = git?.remote?.match(/^https:\/\/github\.com\/([^/]+)\//)?.[1]?.toLowerCase();
    if (teams === null) {
        return `${own}, or your team's space if ${owner ? `${owner}/* belongs to one of your teams` : 'the site finds the repository belongs to a team'}`;
    }
    const matches = owner ? teams.filter((t) => (t.github_owners ?? []).includes(owner)) : [];
    if (matches.length === 1) {
        return `the ${matches[0].name} team, because ${owner}/* is the team's: the team sees the draft, nobody else. Add --private to keep it to yourself.`;
    }

    return own;
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

/** The multipart body of POST /api/v1/imports: the packed session and what goes with it. */
function importForm(id, gz, { git = null, usage = null, space = null, continues = null, trigger = 'manual', final = true } = {}) {
    const form = new FormData();
    form.append('agent', AGENT.id);
    form.append('session_id', id);
    form.append('client_version', VERSION);
    form.append('trigger', trigger);
    // 0: a session still going; the site keeps it up to date and asks for moments once it is over.
    if (trigger === 'auto') form.append('final', final ? '1' : '0');
    if (git) form.append('git', JSON.stringify(git));
    if (usage) form.append('usage', JSON.stringify(usage));
    if (space) form.append('space', space);
    if (continues) form.append('continues', continues);
    form.append('file', new Blob([gz], { type: 'application/gzip' }), `${id}.jsonl.gz`);

    return form;
}

/** "1.2M (claude-opus-4-5, claude-haiku-4-5); only the count is sent". */
function describeUsage(usage) {
    const models = Object.keys(usage.models);
    const total = Object.values(usage.models).reduce((n, u) => n + u.input + u.output + u.cache_read + u.cache_write, 0);
    const compact = total >= 1_000_000 ? `${(total / 1_000_000).toFixed(1)}M` : total >= 1000 ? `${Math.round(total / 1000)}k` : String(total);

    return `${compact} (${models.join(', ')}); only the counts are sent`;
}

/**
 * Auto mode for this computer and this agent (lib/auto.mjs): the plugin's hooks do the sending, hooks/hooks.json in
 * Claude Code and codex/hooks.json in Codex. Codex runs them only once the person trusted them in /hooks.
 */
async function auto(mode) {
    // Codex ends a session after 30 idle minutes too; its desktop app keeps sessions open otherwise.
    const ends = CODEX ? 'when they end or sit idle for 30 minutes' : 'when they end';
    const endsOne = CODEX ? 'when it ends or sits idle for 30 minutes' : 'when it ends';
    const trust = CODEX ? ` Codex runs a plugin's hooks only once you trust them: type /hooks in Codex and trust the three Coders Talk hooks. Until then nothing is sent.` : '';

    if (!mode) {
        const current = autoMode(site, AGENT.id);
        console.log(current === 'all'
            ? `Auto mode is on for ${site}: every ${AGENT.name} session on this computer is sent while it runs and ${endsOne}.${trust}`
            : current === 'team'
              ? `Auto mode is on for ${site}, for team repositories: ${AGENT.name} sessions in repositories of teams that ask for it are sent while they run and ${ends}.${trust}`
              : `Auto mode is off for ${site} in ${AGENT.name}: sessions are sent only when you run ${run('build')}.`);
        const recent = recentAuto(5);
        if (recent.length) console.log(`Last sessions it looked at (${logFile()}):\n${recent.map((l) => `  ${l}`).join('\n')}`);
        return;
    }

    const chosen = { on: 'all', all: 'all', team: 'team', off: null }[mode];
    if (chosen === undefined) throw new Failure(`Use ${run('auto')} on, ${run('auto')} team or ${run('auto')} off.`);
    if (chosen === null) {
        setAutoMode(site, null, AGENT.id);
        console.log(`Auto mode is off in ${AGENT.name}: nothing is sent unless you run ${run('build')}.`);
        return;
    }
    if (!token) throw notConnected();

    const me = await api('GET', '/api/v1/me');
    const asking = (me.teams ?? []).filter((t) => t.auto_capture);
    setAutoMode(site, chosen, AGENT.id);
    if (chosen === 'all') {
        console.log(`Auto mode is on. ${AGENT.name} sessions on this computer are sent to ${site} as @${me.username} by themselves, every ten minutes while they run and once more ${ends}: to your team's space when the repository is one of your team's, else to your private Builds, where only you see them. Nothing is published. Secrets are redacted on the server, and moments are suggested once a session is over.${trust}`);
    } else {
        console.log(asking.length
            ? `Auto mode is on for team repositories. Sessions in repositories of ${asking.map((t) => `${t.name} (${t.github_owners.map((o) => `${o}/*`).join(', ')})`).join('; ')} are sent to the team while they run and ${ends}. Everything else stays on this computer.${trust}`
            : `Auto mode is on for team repositories, but none of your teams asks for it yet, so nothing will be sent until one does.${trust}`);
    }
    console.log(`Turn it off with ${run('auto')} off. What it sent is listed in ${logFile()}.`);
}

/**
 * Run by the hooks in the background, if auto mode wants the session: SessionEnd sends one that ended ($final), Stop
 * syncs one that is still going, SessionStart catches up on those that never said they ended ($caughtUp). Never
 * prints (nobody is watching); every outcome goes to the auto log instead, and what went to auto-sessions.json.
 */
async function autoSend(id, { final = true, caughtUp = false } = {}) {
    const mode = autoMode(site, AGENT.id);
    if (!mode || !SESSION_ID.test(id ?? '')) return;
    const log = (result) => logAuto(`${CODEX ? 'codex ' : ''}${id} ${result}`);
    const remember = (patch) => trackSession(site, id, patch);
    // Nothing went: the session-end hook stops waiting for it (lib/auto.mjs, waitForSend).
    const giveUp = (result) => (remember({ failed: Date.now() }), log(result));
    if (!token) return giveUp('skipped: this computer is not connected');

    let session;
    try {
        session = await prepare(id, false);
    } catch (e) {
        return giveUp(`skipped: ${e instanceof Failure ? e.message : e}`);
    }

    let space = null;
    if (mode === 'team') {
        let teams;
        try {
            teams = (await api('GET', '/api/v1/me', undefined, true, 15000)).teams ?? [];
        } catch (e) {
            return giveUp(`failed: ${e.message}`);
        }
        const owner = session.git?.remote?.match(/^https:\/\/github\.com\/([^/]+)\//)?.[1]?.toLowerCase();
        const asking = owner ? teams.filter((t) => t.auto_capture && (t.github_owners ?? []).includes(owner)) : [];
        if (asking.length !== 1) {
            remember({ skip: 'not a team repository' });
            return log('skipped: not a repository of a team that asks for automatic sending');
        }
        space = asking[0].slug;
    }

    const form = () => importForm(id, session.gz, { git: session.git, usage: session.usage, space, trigger: 'auto', final });
    // A sync still being imported holds the draft for a moment; the end of the session waits for it rather than get lost.
    for (let attempt = 1; ; attempt++) {
        try {
            const r = await api('POST', '/api/v1/imports', form(), true, 60000);
            if (r.status === 'skipped') {
                remember({ skip: r.reason });
                return log(`skipped: ${r.reason === 'published' ? 'already published' : 'its draft is not yours to change'}`);
            }
            remember({ sent: { at: Date.now(), size: session.session.bytes, final } });
            const where = r.space?.type === 'team' ? r.space.name : 'your private Builds';
            return log(`${final ? 'sent' : 'synced, still going,'} to ${where}${caughtUp ? ' at the next start' : ''}: ${r.edit_url}`);
        } catch (e) {
            if (final && attempt < AUTO_TRIES && (['import_running', 'rate_limited'].includes(e.code) || e.unavailable)) {
                await sleep(RETRY_MS[Math.min(attempt, RETRY_MS.length) - 1]);
                continue;
            }
            return giveUp(`failed: ${e.message}`);
        }
    }
}

/**
 * Run by the SessionStart hook in the background: sends, one after another, the sessions that grew since their last
 * send and never said they ended (lib/auto.mjs, catchUp). $current is the session starting: its own hooks send it.
 */
async function autoCatchUp(current) {
    if (!autoMode(site, AGENT.id)) return;
    for (const { id, final } of catchUp(site, current, AGENT.id)) {
        trackSession(site, id, { tried: Date.now() });
        await autoSend(id, { final, caughtUp: true });
    }
}

/** The repository address goes with the session, so the person sees it here; the diff never does. */
function describeGit(git) {
    const where = git.remote ? `${git.remote} (linked on the Build only if the repository is public)` : 'no GitHub remote, the address is not sent';
    const n = git.commits.count;
    const made = n ? `${n} commit${n === 1 ? '' : 's'} in this session` : 'no commits in this session';
    const files = git.shortstat?.files;
    const size = git.shortstat ? `, ${files} file${files === 1 ? '' : 's'} +${git.shortstat.insertions} −${git.shortstat.deletions}` : '';

    return `${where}${git.branch ? `, branch ${git.branch}` : ''}; ${made}${size}. Commit titles are sent, not the commits.`;
}

async function whoami() {
    if (!token) throw notConnected();
    const me = await api('GET', '/api/v1/me');
    console.log(`Connected to ${site} as @${me.username} (token "${me.token.name}").`);
}

/**
 * The site is down or unreachable: the same prepared file can still go through the upload page.
 * A browser page cannot be handed a local file, so the page and the file's folder open side by side for a drag.
 */
function uploadByHand(file, cause) {
    openBrowser(`${site}/new`);
    revealFile(file);

    return new Failure(`${cause.message}\nUpload it by hand instead: open ${site}/new and drop this file on the page (its folder should have opened):\n  ${file}\nThe file is kept for ${PREPARED_TTL_MS / 60000} minutes, so running the send step again also works once the site is back.`);
}

/** Best effort: if no browser opens, the printed link is there. */
function openBrowser(url) {
    if (process.platform === 'win32') launch('rundll32', ['url.dll,FileProtocolHandler', url]);
    else launch(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
}

/** The file manager with the file selected where it can (only the folder on Linux). */
function revealFile(file) {
    // Explorer wants /select,"path" as one argument, quoted its own way.
    if (process.platform === 'win32') launch('explorer', [`/select,"${file}"`], { windowsVerbatimArguments: true, windowsHide: false });
    else if (process.platform === 'darwin') launch('open', ['-R', file]);
    else launch('xdg-open', [dirname(file)]);
}

function launch(cmd, cmdArgs, options = {}) {
    if (env.CODERS_TALK_NO_BROWSER) return;
    try {
        spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore', windowsHide: true, ...options }).on('error', () => {}).unref();
    } catch {
        // The link and the path are printed anyway.
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(data) {
    return { json: data };
}

async function api(method, path, body, authorized = true, timeoutMs = null) {
    // The sandbox flag can survive escalation; only a failed request proves a network error.
    const headers = { Accept: 'application/json', 'User-Agent': `${AGENT.client}/${VERSION}` };
    if (authorized) headers.Authorization = `Bearer ${token}`;
    if (body?.json) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body.json);
    }

    let response;
    try {
        response = await request(site + path, { method, body, headers, ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}) });
    } catch (e) {
        const denied = (error) => error && (['EACCES', 'EPERM'].includes(error.code) || denied(error.cause) || error.errors?.some(denied));
        if (CODEX && denied(e)) {
            throw new Failure(`Network access to ${site} was denied. Run the same command again with network access (approve the request when Codex asks).`);
        }
        throw unavailable(`Could not reach ${site}: ${e.cause?.message ?? e.message}`);
    }

    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;

    const error = data.error ?? {};
    const link = error.edit_url ? ` ${error.edit_url}` : '';
    if (response.status === 401) throw new Failure(`The saved token was not accepted (revoked or from another site). Run ${run('login')} to connect again.`);
    const message = `${error.message ?? `The site answered ${response.status}.`}${link}`;
    // The status and code say whether trying again later can help (auto mode does).
    throw Object.assign(response.status >= 500 ? unavailable(message) : new Failure(message), { status: response.status, code: error.code });
}

/** The request did not go through for reasons on the way or on the server's side, not because of what was sent. */
function unavailable(message) {
    return Object.assign(new Failure(message), { unavailable: true });
}
