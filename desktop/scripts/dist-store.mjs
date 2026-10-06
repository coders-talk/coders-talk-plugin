#!/usr/bin/env node
/**
 * The Microsoft Store package (MSIX, out/*.appx), as the workflow builds it: the coders-talk file staged, then
 * electron-builder's appx target with the makeappx of the newest Windows SDK here. electron-builder's own copy of
 * makeappx may not start on a newer Windows ("side-by-side configuration is incorrect"); the SDK's does. The Store signs
 * the package, so no certificate is needed. The package identity is build.appx in package.json (Partner Center → Product
 * identity); a placeholder one is refused, as in the workflow.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, env = {}) => {
    const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: HERE, shell: process.platform === 'win32', env: { ...process.env, ...env } });
    if (r.status !== 0) process.exit(r.status ?? 1);
};

if (process.platform !== 'win32') {
    console.error('The Store package is built on Windows.');
    process.exit(1);
}
const { appx } = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).build;
if (appx.publisher.includes('00000000-0000') && !process.argv.includes('--placeholder')) {
    console.error('build.appx in package.json still has the placeholder identity: copy Name, Publisher and PublisherDisplayName from Partner Center → Product identity (or pass --placeholder for a local try).');
    process.exit(1);
}

const bin = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
const kits = existsSync(bin)
    ? readdirSync(bin)
          .filter((v) => /^10\.\d+\.\d+\.\d+$/.test(v) && existsSync(join(bin, v, 'x64', 'makeappx.exe')))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : [];
if (!kits.length) {
    console.error(`No Windows SDK with makeappx.exe under ${bin}: install the Windows SDK.`);
    process.exit(1);
}

run(process.execPath, [join(HERE, 'scripts', 'stage-cli.mjs')]);
run('npx', ['electron-builder', '--win', 'appx', '--publish', 'never'], { ELECTRON_BUILDER_WINDOWS_KITS_PATH: join(bin, kits.at(-1), 'x64'), CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
