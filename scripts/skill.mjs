#!/usr/bin/env node
/**
 * The Coders Talk skill for claude.ai: web-skill/SKILL.md and the plugin's scripts, zipped as dist/coders-talk-skill.zip.
 * A person adds it once in claude.ai (Settings → Capabilities → Skills) and cloud sessions (Claude Code on the web)
 * load it by themselves, so a cloud session can send itself through the Coders Talk connector with nothing installed in
 * its environment (App\Services\Import\CloudUploads on the site).
 *
 *   node scripts/skill.mjs            writes dist/coders-talk-skill.zip
 *
 * Inside: coders-talk/SKILL.md, coders-talk/plugin.json (the version, lib/runtime.mjs) and coders-talk/scripts/… (the
 * CLI and its lib). No dependencies: the zip is written here, deflated, with the CRC from node:zlib (Node 22.2 or newer).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'coders-talk';

const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8'));
const files = [
    [`${NAME}/SKILL.md`, readFileSync(join(ROOT, 'web-skill/SKILL.md'))],
    [`${NAME}/plugin.json`, Buffer.from(JSON.stringify({ name: manifest.name, version: manifest.version }, null, 4) + '\n')],
    [`${NAME}/scripts/coders-talk.mjs`, readFileSync(join(ROOT, 'scripts/coders-talk.mjs'))],
    ...readdirSync(join(ROOT, 'scripts/lib'))
        .filter((f) => f.endsWith('.mjs'))
        .sort()
        .map((f) => [`${NAME}/scripts/lib/${f}`, readFileSync(join(ROOT, 'scripts/lib', f))]),
];

mkdirSync(join(ROOT, 'dist'), { recursive: true });
const out = join(ROOT, 'dist', `${NAME}-skill.zip`);
writeFileSync(out, zip(files));
console.log(`${out} (${files.length} files, version ${manifest.version})`);

/** A zip of [name, content] pairs, each deflated. Times are fixed: the same sources make the same file. */
export function zip(entries) {
    const local = [];
    const central = [];
    let offset = 0;
    // 1 January 2026, 00:00, in DOS time.
    const time = 0;
    const date = ((2026 - 1980) << 9) | (1 << 5) | 1;

    for (const [name, content] of entries) {
        const nameBytes = Buffer.from(name, 'utf8');
        const data = deflateRawSync(content);
        const crc = crc32(content);
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(0x0800, 6);
        header.writeUInt16LE(8, 8);
        header.writeUInt16LE(time, 10);
        header.writeUInt16LE(date, 12);
        header.writeUInt32LE(crc, 14);
        header.writeUInt32LE(data.length, 18);
        header.writeUInt32LE(content.length, 22);
        header.writeUInt16LE(nameBytes.length, 26);
        header.writeUInt16LE(0, 28);
        local.push(header, nameBytes, data);

        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(0x02014b50, 0);
        entry.writeUInt16LE(20, 4);
        entry.writeUInt16LE(20, 6);
        entry.writeUInt16LE(0x0800, 8);
        entry.writeUInt16LE(8, 10);
        entry.writeUInt16LE(time, 12);
        entry.writeUInt16LE(date, 14);
        entry.writeUInt32LE(crc, 16);
        entry.writeUInt32LE(data.length, 20);
        entry.writeUInt32LE(content.length, 24);
        entry.writeUInt16LE(nameBytes.length, 28);
        entry.writeUInt32LE(offset, 42);
        central.push(entry, nameBytes);
        offset += header.length + nameBytes.length + data.length;
    }

    const size = central.reduce((n, b) => n + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(offset, 16);

    return Buffer.concat([...local, ...central, end]);
}
