// Where the app finds its updates (src/main/updates.mjs): its own releases, never the CLI's in the same repository.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { channelFile, feedUrl, isUpdate, latestAppRelease, releasesUrl } from '../src/main/updates.mjs';

const release = (tag, files = ['latest.yml'], more = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets: files.map((name) => ({ name })), ...more });

test('the newest app release with its update file, skipping the CLI\'s, drafts, pre-releases and ones still uploading', () => {
    const list = [
        release('coders-talk--v0.16.0', ['coders-talk-windows-x64.exe', 'SHA256SUMS']),
        release('desktop--v0.3.0', ['latest.yml'], { draft: true }),
        release('desktop--v0.2.5', ['latest.yml'], { prerelease: true }),
        release('desktop--v0.2.1', ['latest-mac.yml']),
        release('desktop--v0.2.0'),
        release('desktop--v0.10.0', []),
        release('desktop--v0.1.9'),
        release('desktop--vnext'),
    ];
    assert.deepEqual(latestAppRelease(list, 'win32'), { tag: 'desktop--v0.2.0', version: '0.2.0' });
    assert.deepEqual(latestAppRelease(list, 'darwin'), { tag: 'desktop--v0.2.1', version: '0.2.1' });
    assert.equal(latestAppRelease([release('coders-talk--v0.15.0')], 'win32'), null);
    assert.equal(latestAppRelease({ message: 'API rate limit exceeded' }, 'win32'), null);
});

test('an update is a newer version only', () => {
    assert.equal(isUpdate({ version: '0.2.0' }, '0.1.0'), true);
    assert.equal(isUpdate({ version: '0.1.0' }, '0.1.0'), false);
    assert.equal(isUpdate({ version: '0.0.9' }, '0.1.0'), false);
    assert.equal(isUpdate(null, '0.1.0'), false);
});

test('the feed is the release\'s download folder; the tests point both addresses elsewhere', () => {
    assert.equal(feedUrl('desktop--v0.2.0', {}), 'https://github.com/coders-talk/coders-talk-plugin/releases/download/desktop--v0.2.0');
    assert.equal(feedUrl('desktop--v0.2.0', { CODERS_TALK_APP_DOWNLOADS_URL: 'http://127.0.0.1:9/dl/' }), 'http://127.0.0.1:9/dl/desktop--v0.2.0');
    assert.equal(releasesUrl({}), 'https://api.github.com/repos/coders-talk/coders-talk-plugin/releases?per_page=50');
    assert.equal(channelFile('win32'), 'latest.yml');
    assert.equal(channelFile('darwin'), 'latest-mac.yml');
});
