#!/usr/bin/env node
/**
 * SessionStart hook: remembers HEAD at the start of the session, so /coders-talk:build can tell which commits
 * the session made. Sends nothing anywhere and prints nothing (a SessionStart hook's output would reach the model).
 * Never fails the session: every error is swallowed.
 */
import { currentHead } from './lib/git.mjs';
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
} catch {
    // A missing git, an unreadable home folder or odd input must not get in the way of the session.
}
