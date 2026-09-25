#!/usr/bin/env node
/**
 * SessionEnd hook (Claude Code, or Codex with --agent=codex, where it also fires after 30 idle minutes). With auto mode
 * off (the default) it does nothing at all. With auto mode on for this computer (/coders-talk:auto), it hands the
 * session to `coders-talk.mjs auto-send` in the background and returns, so the session closes without waiting for the
 * upload. Codex ends its hooks' processes when it exits, so there the hook waits for the upload as long as its own
 * timeout allows. Prints nothing; never fails the session.
 */
import { autoMode, inBackground, trackSession, waitForSend } from './lib/auto.mjs';
import { readHook } from './lib/hook.mjs';

/** Codex gives a SessionEnd hook three seconds at most (codex/hooks.json asks for all of them). */
const CODEX_WAIT_MS = 2500;

try {
    const { event, agent, site, id, agentArgs } = await readHook();

    if (id && autoMode(site, agent)) {
        const session = trackSession(site, id, { path: event.transcript_path, agent });
        if (!session.skip) {
            const started = Date.now();
            trackSession(site, id, { tried: started });
            inBackground(['auto-send', id, ...agentArgs]);
            if (agent === 'codex') await waitForSend(site, id, started, CODEX_WAIT_MS);
        }
    }
} catch {
    // Odd input, an unreadable home folder: the session ends as it would without the plugin.
}
