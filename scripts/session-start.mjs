#!/usr/bin/env node
/**
 * SessionStart hook (Claude Code, or Codex with --agent=codex). In Claude Code it remembers HEAD at the start of the
 * session, so /coders-talk:build can tell which commits the session made (Codex writes HEAD into the session itself).
 * With auto mode on (/coders-talk:auto), it also catches up in the background on this agent's sessions that never
 * said they ended (a crash, a closed terminal) and remembers this one. Prints nothing (a SessionStart hook's output
 * would reach the model) and never fails the session: every error is swallowed.
 */
import { autoMode, catchUp, inBackground, trackSession } from './lib/auto.mjs';
import { currentHead } from './lib/git.mjs';
import { readHook } from './lib/hook.mjs';
import { pruneSidecars, writeSidecar } from './lib/sidecar.mjs';

try {
    const { event, agent, site, id, agentArgs } = await readHook();

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

    if (id && autoMode(site, agent)) {
        trackSession(site, id, { path: event.transcript_path, agent });
        if (catchUp(site, id, agent).length) inBackground(['auto-catch-up', id, ...agentArgs]);
    }
} catch {
    // A missing git, an unreadable home folder or odd input must not get in the way of the session.
}
