#!/usr/bin/env node
/**
 * Stop hook, after each answer: auto mode's sync of a running session, or one suggestion to share it (lib/hooks.mjs).
 * Claude Code runs it from hooks/hooks.json, Codex from codex/hooks.json with --agent=codex. The git snapshot of the
 * same event is snapshot.mjs, which Claude Code runs alongside. Prints nothing else and never fails the session.
 */
import { runHook } from './lib/hooks.mjs';

await runHook(process.argv.includes('--agent=codex') ? 'codex' : 'claude-code', 'stop', { snapshot: false });
