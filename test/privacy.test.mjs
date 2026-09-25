// scripts/lib/privacy.mjs against the cases shared with the site (copied by `npm run plugin:sync` in coders.talk):
// the check here must redact what App\Services\Import\SecretScanner would, or the site's second look finds it first.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PrivacyScan } from '../scripts/lib/privacy.mjs';

const cases = JSON.parse(readFileSync(new URL('./fixtures/privacy/cases.json', import.meta.url), 'utf8'));

for (const c of cases) {
    test(`redacts like the site: ${c.name}`, () => {
        assert.equal(new PrivacyScan().text(c.text), c.redacted);
    });
}
