#!/usr/bin/env node
/**
 * SessionStart, UserPromptSubmit and Stop hook: a git snapshot of the working tree (lib/snapshots.mjs), so
 * /coders-talk:build can show which code each turn changed and what the person changed by hand in between.
 * Runs next to the other hooks of the same events. Sends nothing, prints nothing (UserPromptSubmit output would reach
 * the model) and never fails the session: every error is swallowed.
 *
 *   node snapshot.mjs start|prompt|stop
 */
import { pruneSnapshots, takeSnapshot } from './lib/snapshots.mjs';

const kind = process.argv[2];

try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const event = JSON.parse(input);

    if (['start', 'prompt', 'stop'].includes(kind)) {
        // A resumed or compacted session starts again with the same id: its chain goes on.
        takeSnapshot(event, kind);
        if (kind === 'start') pruneSnapshots(event.cwd);
    }
} catch {
    // No git, odd input, an unreadable home folder: the session goes on as it would without the plugin.
}
