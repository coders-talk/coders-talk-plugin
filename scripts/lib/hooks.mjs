/**
 * The plugin's hooks, by event. Claude Code runs hooks/hooks.json, Codex runs codex/hooks.json (with --agent=codex);
 * each script there runs one of these. The single coders-talk file runs them as `coders-talk hook <agent> <event>`
 * (plan, stage 13.1), one command per event, git snapshot included.
 *
 * Every event the agent writes on stdin carries the same fields that matter here: session_id, transcript_path and cwd.
 * A hook prints nothing but the Stop hook's one suggestion, and never fails the session: every error is swallowed.
 *
 *   session-start  Claude Code: HEAD at the start of the session, so /coders-talk:build can tell which commits it made
 *                  (Codex writes HEAD into the session itself). Auto mode: catches up in the background on this agent's
 *                  sessions that never said they ended (a crash, a closed terminal) and remembers this one.
 *   stop           after each answer. Auto mode: sends the session in the background as still going when it grew and
 *                  the last send is ten minutes old (lib/auto.mjs, syncDue). Otherwise, once per session that used
 *                  Builds from the library and changed code, one line suggesting to share it (lib/nudge.mjs): a JSON
 *                  systemMessage, which both agents show to the person, and the only output Codex takes from a Stop hook.
 *   session-end    auto mode only: hands the session to `auto-send` in the background and returns. Codex ends its hooks'
 *                  processes when it exits, so there the hook waits for the upload as long as its own timeout allows.
 *   prompt         Claude Code's git snapshot only.
 *
 * Git snapshots (lib/snapshots.mjs) are Claude Code's: at the start, at each prompt and after each answer.
 */
import { autoMode, catchUp, inBackground, RUNNING_MODES, syncDue, trackSession, waitForSend } from './auto.mjs';
import { siteUrl } from './config.mjs';
import { currentHead } from './git.mjs';
import { nudgeDue, nudgeMessage, nudgeOn } from './nudge.mjs';
import { findRollout, findTranscript, SESSION_ID } from './session.mjs';
import { pruneSidecars, writeSidecar } from './sidecar.mjs';
import { pruneSnapshots, takeSnapshot } from './snapshots.mjs';

export const HOOK_EVENTS = ['session-start', 'prompt', 'stop', 'session-end'];

/** Codex gives a SessionEnd hook three seconds at most (codex/hooks.json asks for all of them). */
const CODEX_WAIT_MS = 2500;

/** What the snapshot of each event is called in the session's chain. */
const SNAPSHOTS = { 'session-start': 'start', prompt: 'prompt', stop: 'stop' };

/** The event the agent wrote on stdin. */
export async function readEvent(input = process.stdin) {
    let text = '';
    for await (const chunk of input) text += chunk;

    return JSON.parse(text);
}

/**
 * Runs the hook of $name for $agent ('claude-code' or 'codex'). $snapshot takes Claude Code's git snapshot of the event
 * in the same run; the scripts of hooks/hooks.json leave it to snapshot.mjs, which Claude Code runs alongside.
 */
export async function runHook(agent, name, { snapshot = agent === 'claude-code', event = null } = {}) {
    try {
        event ??= await readEvent();
    } catch {
        return;
    }
    // First: an answer's code is in the chain before a sync of the session reads it.
    if (snapshot && SNAPSHOTS[name]) takeSnapshotOf(event, SNAPSHOTS[name]);

    try {
        const context = {
            event,
            agent,
            site: siteUrl(null, agent === 'codex'),
            id: SESSION_ID.test(event.session_id ?? '') ? event.session_id : null,
            /** What `coders-talk` needs to be told to read this agent's sessions. */
            agentArgs: agent === 'codex' ? ['--agent=codex'] : [],
        };
        if (name === 'session-start') sessionStart(context);
        else if (name === 'stop') stop(context);
        else if (name === 'session-end') await sessionEnd(context);
    } catch {
        // A missing git, an unreadable home folder or odd input must not get in the way of the session.
    }
}

/** snapshot.mjs start|prompt|stop, and the snapshot part of a run of the single file. */
export function takeSnapshotOf(event, kind) {
    try {
        // A resumed or compacted session starts again with the same id: its chain goes on.
        takeSnapshot(event, kind);
        if (kind === 'start') pruneSnapshots(event.cwd);
    } catch {
        // No git, odd input, an unreadable home folder: the session goes on as it would without the plugin.
    }
}

function sessionStart({ event, agent, site, id, agentArgs }) {
    if (agent === 'claude-code') {
        writeSidecar({
            session_id: event.session_id,
            cwd: event.cwd ?? null,
            transcript_path: event.transcript_path ?? null,
            head: currentHead(event.cwd),
            started_at: Date.now(),
        });
        pruneSidecars();
    }

    if (id && RUNNING_MODES.includes(autoMode(site, agent))) {
        trackSession(site, id, { path: event.transcript_path, agent });
        if (catchUp(site, id, agent).length) inBackground(['auto-catch-up', id, ...agentArgs]);
    }
}

function stop({ event, agent, site, id, agentArgs }) {
    const mode = autoMode(site, agent);
    // Push mode sends at the push; it needs no suggestion either.
    if (id && mode === 'push') return;
    if (id && mode) {
        // Auto mode turned on in the middle of a session starts with it from here.
        const session = trackSession(site, id, { path: event.transcript_path, agent });
        if (syncDue(session)) {
            trackSession(site, id, { tried: Date.now() });
            inBackground(['auto-send', id, '--sync', ...agentArgs]);
        }
    } else if (id && nudgeOn()) {
        const path = event.transcript_path || (agent === 'codex' ? findRollout(id) : findTranscript(id));
        const builds = path ? nudgeDue({ agent, id, path }) : null;
        if (builds) {
            console.log(JSON.stringify({ systemMessage: nudgeMessage(builds, agent === 'codex' ? '$coders-talk:build' : '/coders-talk:build') }));
        }
    }
}

async function sessionEnd({ event, agent, site, id, agentArgs }) {
    if (!id || !RUNNING_MODES.includes(autoMode(site, agent))) return;
    const session = trackSession(site, id, { path: event.transcript_path, agent });
    if (session.skip) return;

    const started = Date.now();
    trackSession(site, id, { tried: started });
    inBackground(['auto-send', id, ...agentArgs]);
    if (agent === 'codex') await waitForSend(site, id, started, CODEX_WAIT_MS);
}
