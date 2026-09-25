#!/usr/bin/env node
/**
 * Stop hook, after each answer of the agent (Claude Code, or Codex with --agent=codex).
 *
 * With auto mode on, it sends the session in the background as still going when it grew and the last send is ten
 * minutes old (lib/auto.mjs, syncDue), so a team sees work in progress and a crash loses at most those minutes. The
 * site saves such a send without asking the model; moments come once, when the session is over.
 *
 * With auto mode off (the default) it sends nothing. Once per session, when the agent used Builds from the Coders Talk
 * library and the session changed code, it shows the person one line suggesting to share the session
 * (lib/nudge.mjs). That line is the only thing it ever prints: a JSON systemMessage, which both agents show to the
 * person, and the only output Codex takes from a Stop hook. Never fails the session.
 */
import { autoMode, inBackground, syncDue, trackSession } from './lib/auto.mjs';
import { readHook } from './lib/hook.mjs';
import { nudgeDue, nudgeMessage, nudgeOn } from './lib/nudge.mjs';
import { findRollout, findTranscript } from './lib/session.mjs';

try {
    const { event, agent, site, id, agentArgs } = await readHook();

    if (id && autoMode(site, agent)) {
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
} catch {
    // Odd input, an unreadable home folder: the session goes on as it would without the plugin.
}
