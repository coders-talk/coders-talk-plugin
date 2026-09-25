/**
 * What every auto-mode hook starts with: the event the agent wrote on stdin, which agent runs it, and the site.
 * Claude Code runs hooks/hooks.json; Codex runs codex/hooks.json, whose commands add --agent=codex. Both send the same
 * fields that matter here: session_id, transcript_path and cwd.
 */
import { siteUrl } from './config.mjs';
import { SESSION_ID } from './session.mjs';

export async function readHook(argv = process.argv) {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const event = JSON.parse(input);
    const codex = argv.includes('--agent=codex');

    return {
        event,
        agent: codex ? 'codex' : 'claude-code',
        site: siteUrl(null, codex),
        id: SESSION_ID.test(event.session_id ?? '') ? event.session_id : null,
        /** What coders-talk.mjs needs to be told to read this agent's sessions. */
        agentArgs: codex ? ['--agent=codex'] : [],
    };
}
