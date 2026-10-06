#!/usr/bin/env node
/**
 * PostToolUse hook, after every tool call of Claude Code, which does not wait for it (async in hooks/hooks.json): auto
 * mode's sync of a running session (lib/auto.mjs, syncIfDue), so a long turn is sent while the agent works on it, not
 * only once it answers. Loads only what that needs: it runs far more often than the other hooks. Prints nothing and
 * never fails the session.
 */
import { syncIfDue } from './lib/auto.mjs';
import { siteUrl } from './lib/config.mjs';
import { readEvent } from './lib/event.mjs';
import { SESSION_ID } from './lib/session.mjs';

try {
    const event = await readEvent();
    // Cursor runs the hooks of a Claude Code plugin it imported too, with its own input: its own hooks serve it.
    if (typeof event.cursor_version !== 'string' && SESSION_ID.test(event.session_id ?? '')) {
        syncIfDue(siteUrl(null, false), event.session_id, { path: event.transcript_path, agent: 'claude-code' });
    }
} catch {
    // Odd input, an unreadable home folder: the session goes on as it would without the plugin.
}
