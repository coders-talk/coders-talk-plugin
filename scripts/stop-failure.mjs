#!/usr/bin/env node
/**
 * StopFailure hook of Claude Code, for a turn that ended on the rate limit (hooks/hooks.json, matcher rate_limit): one
 * line with the agents on this computer to go on in, and the handoff command (lib/hooks.mjs, stopFailure). Prints
 * nothing else and never fails the session.
 */
import { runHook } from './lib/hooks.mjs';

await runHook('claude-code', 'stop-failure', { snapshot: false });
