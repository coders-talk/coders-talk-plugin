#!/usr/bin/env node
/**
 * UserPromptSubmit hook: the repository's stack rules this prompt is about, for the agent's context (lib/hooks.mjs,
 * prompt; KeepPlain personal rules, stage 41). Claude Code runs it from hooks/hooks.json next to snapshot.mjs prompt,
 * Codex from codex/hooks.json with --agent=codex. Prints nothing else and never fails the prompt.
 */
import { runHook } from './lib/hooks.mjs';

await runHook(process.argv.includes('--agent=codex') ? 'codex' : 'claude-code', 'prompt', { snapshot: false });
