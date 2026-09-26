/* global CODERS_TALK_VERSION */
/**
 * How this copy runs: as the plugin's scripts under Node, or as the single coders-talk file (plan, stage 13.1), which
 * scripts/build.mjs makes with `bun build --compile` and CODERS_TALK_VERSION defined. The two differ only in where the
 * version comes from and in how they run themselves again in the background.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The version of the single file, or null under Node. */
export const BINARY_VERSION = typeof CODERS_TALK_VERSION === 'string' ? CODERS_TALK_VERSION : null;

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The plugin's version: built into the file, or read from whichever manifest the installed copy has (both carry it). */
export function version() {
    if (BINARY_VERSION) return BINARY_VERSION;
    const root = join(SCRIPTS, '..');
    const manifest = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json'].find((p) => existsSync(join(root, p))) ?? '.claude-plugin/plugin.json';

    return JSON.parse(readFileSync(join(root, manifest), 'utf8')).version;
}

/** What runs coders-talk, by absolute path: the file itself, or Node and the script. */
export function selfProgram() {
    return BINARY_VERSION ? [process.execPath] : [process.execPath, join(SCRIPTS, 'coders-talk.mjs')];
}

/** The program and arguments that run `coders-talk <args>`. */
export function selfCommand(args) {
    const [program, ...fixed] = selfProgram();

    return [program, [...fixed, ...args]];
}
