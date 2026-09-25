#!/usr/bin/env node
/**
 * SessionEnd hook. With auto mode off (the default) it does nothing at all. With auto mode on for this computer
 * (/coders-talk:auto), it hands the session to `coders-talk.mjs auto-send` in the background and returns at once, so
 * the session closes without waiting for the upload. Prints nothing; never fails the session.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoMode } from './lib/auto.mjs';
import { siteUrl } from './lib/config.mjs';
import { SESSION_ID } from './lib/session.mjs';

try {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const event = JSON.parse(input);

    if (SESSION_ID.test(event.session_id ?? '') && autoMode(siteUrl())) {
        const script = join(dirname(fileURLToPath(import.meta.url)), 'coders-talk.mjs');
        spawn(process.execPath, [script, 'auto-send', event.session_id], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env }).unref();
    }
} catch {
    // Odd input, an unreadable home folder: the session ends as it would without the plugin.
}
