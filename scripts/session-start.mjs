#!/usr/bin/env node
/**
 * SessionStart hook: remembers HEAD at the start of the session, so /coders-talk:build can tell which commits
 * the session made. With auto mode on (/coders-talk:auto), it also catches up in the background on sessions that
 * never said they ended (a crash, a closed terminal) and remembers this one. Prints nothing (a SessionStart hook's
 * output would reach the model) and never fails the session: every error is swallowed.
 */
import { autoMode, catchUp, inBackground, trackSession } from './lib/auto.mjs';
import { siteUrl } from './lib/config.mjs';
import { currentHead } from './lib/git.mjs';
import { SESSION_ID } from './lib/session.mjs';
import { pruneSidecars, writeSidecar } from './lib/sidecar.mjs';

try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const event = JSON.parse(input);

    writeSidecar({
        session_id: event.session_id,
        cwd: event.cwd ?? null,
        transcript_path: event.transcript_path ?? null,
        head: currentHead(event.cwd),
        started_at: Date.now(),
    });
    pruneSidecars();

    const site = siteUrl();
    if (SESSION_ID.test(event.session_id ?? '') && autoMode(site)) {
        trackSession(site, event.session_id, { path: event.transcript_path });
        if (catchUp(site, event.session_id).length) inBackground(['auto-catch-up', event.session_id]);
    }
} catch {
    // A missing git, an unreadable home folder or odd input must not get in the way of the session.
}
