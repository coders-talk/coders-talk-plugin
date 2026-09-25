#!/usr/bin/env node
/**
 * SessionEnd hook. With auto mode off (the default) it does nothing at all. With auto mode on for this computer
 * (/coders-talk:auto), it hands the session to `coders-talk.mjs auto-send` in the background and returns at once, so
 * the session closes without waiting for the upload. Prints nothing; never fails the session.
 */
import { autoMode, inBackground, trackSession } from './lib/auto.mjs';
import { siteUrl } from './lib/config.mjs';
import { SESSION_ID } from './lib/session.mjs';

try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const event = JSON.parse(input);
    const site = siteUrl();

    if (SESSION_ID.test(event.session_id ?? '') && autoMode(site)) {
        const session = trackSession(site, event.session_id, { path: event.transcript_path });
        if (!session.skip) {
            trackSession(site, event.session_id, { tried: Date.now() });
            inBackground(['auto-send', event.session_id]);
        }
    }
} catch {
    // Odd input, an unreadable home folder: the session ends as it would without the plugin.
}
