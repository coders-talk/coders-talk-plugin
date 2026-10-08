#!/usr/bin/env node
/**
 * Puts the single keepplain file for this computer where the app's build takes it from (package.json, build.extraResources):
 * resources/bin/<mac|win|linux>-<arch>/keepplain[.exe]. Builds it first with ../scripts/build.mjs when ../dist has none,
 * so the app always carries the CLI of the same commit.
 *
 *   node scripts/stage-cli.mjs            this computer's platform and arch
 *   node scripts/stage-cli.mjs --rebuild  build the file again even when dist has one
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const platform = process.platform;
const arch = process.env.KEEPPLAIN_ARCH || process.arch;
const target = `${platform === 'win32' ? 'windows' : platform}-${arch}`;
const built = join(ROOT, 'dist', platform === 'win32' ? `keepplain-windows-${arch}.exe` : `keepplain-${platform}-${arch}`);

if (process.argv.includes('--rebuild') || !existsSync(built)) {
    console.log(`Building keepplain for ${target}…`);
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), target], { stdio: 'inherit', cwd: ROOT });
    if (r.status !== 0) process.exit(r.status ?? 1);
}

const os = { darwin: 'mac', win32: 'win' }[platform] ?? platform;
const dir = join(HERE, '..', 'resources', 'bin', `${os}-${arch}`);
const name = platform === 'win32' ? 'keepplain.exe' : 'keepplain';
// The folder goes whole into the package: nothing but this file, not one left from an earlier name or build.
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
copyFileSync(built, join(dir, name));
if (platform !== 'win32') chmodSync(join(dir, name), 0o755);
console.log(`Staged ${built} as ${join(dir, name)}`);
