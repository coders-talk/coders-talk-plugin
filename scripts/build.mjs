#!/usr/bin/env node
/**
 * The single coders-talk file (plan, stage 13.1): the same scripts, compiled with Bun into one executable per platform,
 * so installing needs no Node.js. Needs bun in PATH (or BUN=<path>).
 *
 *   node scripts/build.mjs                       this platform
 *   node scripts/build.mjs linux-x64 darwin-arm64 …   those, or "all"
 *
 * Writes dist/coders-talk-<platform>-<arch>[.exe] (the release file names, lib/update.mjs assetName) and, with more
 * than one, dist/SHA256SUMS. The version comes from .claude-plugin/plugin.json. The plugin's skills, manifests and hooks go
 * in as CODERS_TALK_PLUGIN_SOURCES: `coders-talk enable` lays the plugin out from them (lib/plugin.mjs).
 *
 * x64 builds use Bun's baseline runtime, which runs on CPUs without AVX2. A standalone Bun file would read .env and
 * bunfig.toml from the folder it runs in, which is the person's repository here: both are turned off. macOS files must
 * be signed after the build (codesign -s -, see .github/workflows/release.yml), or they do not start on Apple silicon.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSources } from './lib/plugin.mjs';
import { assetName } from './lib/update.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = {
    'linux-x64': 'bun-linux-x64-baseline',
    'linux-arm64': 'bun-linux-arm64',
    'darwin-x64': 'bun-darwin-x64-baseline',
    'darwin-arm64': 'bun-darwin-arm64',
    'windows-x64': 'bun-windows-x64-baseline',
};

const version = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8')).version;
const sources = JSON.stringify(readSources(ROOT));
const here = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
const asked = process.argv.slice(2);
const targets = asked.includes('all') ? Object.keys(TARGETS) : asked.length ? asked : [here];
const unknown = targets.filter((t) => !TARGETS[t]);
if (unknown.length) {
    console.error(`Unknown platform ${unknown.join(', ')}. Use: ${Object.keys(TARGETS).join(', ')} or all.`);
    process.exit(1);
}

const out = join(ROOT, 'dist');
mkdirSync(out, { recursive: true });
const sums = [];
for (const target of targets) {
    const [platform, arch] = target.split('-');
    const name = assetName(platform === 'windows' ? 'win32' : platform, arch);
    const args = [
        'build', join(ROOT, 'scripts/coders-talk.mjs'),
        '--compile', `--target=${TARGETS[target]}`, `--outfile=${join(out, name)}`,
        `--define=CODERS_TALK_VERSION=${JSON.stringify(version)}`,
        `--define=CODERS_TALK_PLUGIN_SOURCES=${sources}`,
        '--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig',
    ];
    // Bun sets these only when it builds on Windows; they name the file in Task Manager and the file's properties.
    if (platform === 'windows' && process.platform === 'win32') {
        args.push('--windows-title=Coders Talk', '--windows-publisher=Coders Talk', `--windows-version=${version}.0`, '--windows-description=Coders Talk CLI');
    }
    console.log(`${name} (${TARGETS[target]}, ${version})`);
    const result = spawnSync(process.env.BUN || 'bun', args, { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
    sums.push(`${createHash('sha256').update(readFileSync(join(out, name))).digest('hex')}  ${name}`);
}
if (targets.length > 1) writeFileSync(join(out, 'SHA256SUMS'), sums.join('\n') + '\n');
