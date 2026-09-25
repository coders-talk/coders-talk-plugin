/**
 * The person's own privacy settings, on this computer only (~/.coders-talk):
 *
 *   privacy.json  {"redact": ["Globex", "billing-core"]}  words to hide as [REDACTED:TERM] in every session: client
 *                 names, internal services. Written by hand; the plugin only reads it.
 *   kept.json     {"sha256": ["…"]}  values the person chose to send as they are (preview --keep). Hashes only, so
 *                 the file holds no secret; the same hashes go to the site, whose own check then leaves those alone.
 *
 * The check itself is privacy.mjs, generated from coders.talk's resources/js/lib/privacyScan.ts.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { home } from './credentials.mjs';
import { PrivacyScan } from './privacy.mjs';

export const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

function read(name) {
    try {
        return JSON.parse(readFileSync(join(home(), name), 'utf8'));
    } catch {
        return {};
    }
}

export function terms() {
    const list = read('privacy.json').redact;

    return Array.isArray(list) ? list.filter((t) => typeof t === 'string') : [];
}

export function keptHashes() {
    const list = read('kept.json').sha256;

    return new Set(Array.isArray(list) ? list.filter((h) => /^[0-9a-f]{64}$/.test(h)) : []);
}

export function keep(hashes) {
    const all = [...new Set([...keptHashes(), ...hashes])];
    mkdirSync(home(), { recursive: true });
    writeFileSync(join(home(), 'kept.json'), JSON.stringify({ sha256: all }, null, 2) + '\n');
}

/** A check with the person's words and kept values; kept values are matched by their hash. */
export function privacyScan() {
    const kept = keptHashes();

    return new PrivacyScan({ terms: terms(), keep: (value) => kept.has(sha256(value)) });
}

/** What goes to the site: counts, and the hashes of the kept values found in this session. Never a value. */
export function privacySummary(scan) {
    return scan.summary(scan.findings().filter((f) => f.kept).map((f) => sha256(f.value)));
}
