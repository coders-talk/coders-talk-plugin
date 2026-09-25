#!/usr/bin/env node
/**
 * Stop hook, after each answer of the agent (Claude Code, or Codex with --agent=codex). With auto mode off (the
 * default) it does nothing at all. With auto mode on, it sends the session in the background as still going when it
 * grew and the last send is ten minutes old (lib/auto.mjs, syncDue), so a team sees work in progress and a crash loses
 * at most those minutes. The site saves such a send without asking the model; moments come once, when the session is
 * over. Prints nothing (Codex takes only JSON from a Stop hook); never fails the session.
 */
import { autoMode, inBackground, syncDue, trackSession } from './lib/auto.mjs';
import { readHook } from './lib/hook.mjs';

try {
    const { event, agent, site, id, agentArgs } = await readHook();

    // Auto mode turned on in the middle of a session starts with it from here.
    if (id && autoMode(site, agent)) {
        const session = trackSession(site, id, { path: event.transcript_path, agent });
        if (syncDue(session)) {
            trackSession(site, id, { tried: Date.now() });
            inBackground(['auto-send', id, '--sync', ...agentArgs]);
        }
    }
} catch {
    // Odd input, an unreadable home folder: the session goes on as it would without the plugin.
}
