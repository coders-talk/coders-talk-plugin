// scripts/lib/privacy.mjs against the cases shared with the site (copied by `npm run plugin:sync` in KeepPlain):
// the check here must redact what App\Services\Import\SecretScanner would, or the site's second look finds it first.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PrivacyScan } from '../scripts/lib/privacy.mjs';

// The texts there are in base64 and their fake keys split by <fake>, so that no file the plugin ships reads as a credential.
const decode = (value) => Buffer.from(value, 'base64').toString('utf8').replaceAll('<fake>', '');
const cases = JSON.parse(readFileSync(new URL('./fixtures/privacy/cases.json', import.meta.url), 'utf8'))
    .map((c) => ({ name: c.name, text: decode(c.text_base64), redacted: decode(c.redacted_base64), types: c.types }));

for (const c of cases) {
    test(`redacts like the site: ${c.name}`, () => {
        assert.equal(new PrivacyScan().text(c.text), c.redacted);
    });
}
