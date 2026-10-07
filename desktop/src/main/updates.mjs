/**
 * Where the app finds its updates. No Electron here: the tests load this file under Node.
 *
 * The app's releases live in the plugin's repository beside the CLI's, tagged desktop--vX.Y.Z and never marked latest:
 * install.sh, install.ps1 and `keepplain update` take the CLI from the repository's latest release. So the app does not
 * ask GitHub for "the latest release" (electron-updater's GitHub provider does, and would get the CLI's): it lists the
 * releases, takes the newest desktop--v one that has its update file (latest.yml on Windows, latest-mac.yml on macOS: a
 * release still uploading has none yet), and hands electron-updater that release's download folder as a generic feed.
 */
import { newer } from './cli.mjs';

export const REPOSITORY = 'keepplain/keepplain-plugin';
export const TAG_PREFIX = 'desktop--v';

/** The GitHub API list of releases, and the folder a release's files download from (env overrides, for the tests). */
export const releasesUrl = (env = process.env) => env.KEEPPLAIN_APP_RELEASES_URL || `https://api.github.com/repos/${REPOSITORY}/releases?per_page=50`;
export const feedUrl = (tag, env = process.env) => `${(env.KEEPPLAIN_APP_DOWNLOADS_URL || `https://github.com/${REPOSITORY}/releases/download`).replace(/\/+$/, '')}/${tag}`;

/** The update file electron-updater reads on this platform. */
export const channelFile = (platform = process.platform) => (platform === 'darwin' ? 'latest-mac.yml' : platform === 'linux' ? 'latest-linux.yml' : 'latest.yml');

/** The newest published app release that has its update file: {tag, version}, or null. */
export function latestAppRelease(releases, platform = process.platform) {
    let best = null;
    for (const r of Array.isArray(releases) ? releases : []) {
        const tag = typeof r?.tag_name === 'string' ? r.tag_name : '';
        if (!tag.startsWith(TAG_PREFIX) || r.draft || r.prerelease) continue;
        const version = tag.slice(TAG_PREFIX.length);
        if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
        if (!(r.assets ?? []).some((a) => a?.name === channelFile(platform))) continue;
        if (!best || newer(version, best.version)) best = { tag, version };
    }

    return best;
}

/** Whether $release is an update for the app at $current. */
export const isUpdate = (release, current) => Boolean(release && newer(release.version, current));
