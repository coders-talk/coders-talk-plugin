// privacy.json is written by hand, often on Windows: Notepad and PowerShell 5.1 save it with a BOM or as UTF-16.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { Failure } from '../scripts/lib/failure.mjs';
import { privacyScan, terms } from '../scripts/lib/privacy-settings.mjs';

let dir;
const saved = process.env.CODERS_TALK_HOME;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ct-privacy-'));
    process.env.CODERS_TALK_HOME = dir;
});

afterEach(() => {
    if (saved === undefined) delete process.env.CODERS_TALK_HOME;
    else process.env.CODERS_TALK_HOME = saved;
    rmSync(dir, { recursive: true, force: true });
});

const json = '{"redact": ["Globex", "billing-core"]}\r\n';
const write = (bytes) => writeFileSync(join(dir, 'privacy.json'), bytes);

const encodings = {
    'UTF-8': Buffer.from(json, 'utf8'),
    'UTF-8 with BOM (Notepad, Set-Content -Encoding utf8)': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json, 'utf8')]),
    'UTF-16 LE with BOM (PowerShell > and Out-File)': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, 'utf16le')]),
    'UTF-16 BE with BOM': Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(json, 'utf16le').swap16()]),
};

for (const [name, bytes] of Object.entries(encodings)) {
    test(`reads privacy.json saved as ${name}`, () => {
        write(bytes);
        assert.deepEqual(terms(), ['Globex', 'billing-core']);
        assert.ok(!privacyScan().text('deploy for Globex').includes('Globex'));
    });
}

test('no privacy.json: nothing to hide', () => {
    assert.deepEqual(terms(), []);
});

test('a privacy.json that cannot be read stops the send instead of hiding nothing', () => {
    write('{"redact": ["Globex",]}');
    assert.throws(() => terms(), Failure);
    assert.throws(() => privacyScan(), Failure);
});

test('"redact" that is not a list stops the send', () => {
    write('{"redact": "Globex"}');
    assert.throws(() => terms(), Failure);
});
