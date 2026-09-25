#!/usr/bin/env node
/**
 * Stop hook, after each answer of the agent. With auto mode off (the default) it does nothing at all. With auto mode
 * on, it sends the session in the background as still going when it grew and the last send is ten minutes old
 * (lib/auto.mjs, syncDue), so a team sees work in progress and a crash loses at most those minutes. The site saves
 * such a send without asking the model; moments come once, when the session is over. Prints nothing; never fails
 * the session.
 */
import { autoMode, inBackground, syncDue, trackSession } from './lib/auto.mjs';
import { siteUrl } from './lib/config.mjs';
import { SESSION_ID } from './lib/session.mjs';

try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const event = JSON.parse(input);
    const site = siteUrl();

    // Auto mode turned on in the middle of a session starts with it from here.
    if (SESSION_ID.test(event.session_id ?? '') && autoMode(site)) {
        const session = trackSession(site, event.session_id, { path: event.transcript_path });
        if (syncDue(session)) {
            trackSession(site, event.session_id, { tried: Date.now() });
            inBackground(['auto-send', event.session_id, '--sync']);
        }
    }
} catch {
    // Odd input, an unreadable home folder: the session goes on as it would without the plugin.
}
