#!/usr/bin/env node
/**
 * SessionStart, UserPromptSubmit and Stop hook: a git snapshot of the working tree (lib/snapshots.mjs), so
 * /coders-talk:build can show which code each turn changed and what the person changed by hand in between.
 * Runs next to the other hooks of the same events. Sends nothing, prints nothing (UserPromptSubmit output would reach
 * the model) and never fails the session: every error is swallowed.
 *
 *   node snapshot.mjs start|prompt|stop
 */
import { readEvent, takeSnapshotOf } from './lib/hooks.mjs';

const kind = process.argv[2];

try {
    if (['start', 'prompt', 'stop'].includes(kind)) takeSnapshotOf(await readEvent(), kind);
} catch {
    // Odd input: the session goes on as it would without the plugin.
}
