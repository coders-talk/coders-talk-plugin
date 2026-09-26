/**
 * The single coders-talk file keeps itself up to date (plan, stage 13.1). `coders-talk update` fetches the file for
 * this platform from the plugin's GitHub Releases, checks it against the release's SHA256SUMS and puts it in place of
 * itself. Windows cannot overwrite a running .exe but can rename it: it becomes coders-talk.exe.old, removed at the
 * next start.
 *
 * Commands a person types in a terminal mention a newer release in one stderr line, at most once a day, from what a
 * background `update --check` found: they never wait for the network, and hooks never look.
 * CODERS_TALK_NO_UPDATE_CHECK=1 turns that off. The plugin installed from an agent's marketplace is updated there.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inBackground } from './auto.mjs';
import { home } from './credentials.mjs';
import { Failure } from './failure.mjs';
import { request } from './http.mjs';
import { BINARY_VERSION } from './runtime.mjs';

export const REPOSITORY = 'coders-talk/coders-talk-plugin';
const DAY_MS = 86_400_000;
const TAG_PREFIX = 'coders-talk--v';

const releases = (env = process.env) => (env.CODERS_TALK_RELEASES_URL || `https://api.github.com/repos/${REPOSITORY}/releases`).replace(/\/+$/, '');
const stateFile = (dir = home()) => join(dir, 'update.json');

/** The release file for a platform: coders-talk-linux-x64, coders-talk-darwin-arm64, coders-talk-windows-x64.exe. */
export function assetName(platform = process.platform, arch = process.arch) {
    return platform === 'win32' ? `coders-talk-windows-${arch}.exe` : `coders-talk-${platform}-${arch}`;
}

/** Whether version $a is newer than $b (x.y.z). */
export function newer(a, b) {
    const [x, y] = [a, b].map((v) => String(v).split('.').map((n) => parseInt(n, 10) || 0));
    for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);

    return false;
}

/** `coders-talk update [version]`, or with $check only notes the latest version for updateNotice. */
export async function update(requested = null, { check = false, current = BINARY_VERSION, executable = process.execPath } = {}) {
    if (check) {
        const release = await fetchRelease(null, current);
        writeState({ ...readState(), checked_at: Date.now(), latest: release.version });
        return;
    }
    if (!current) {
        throw new Failure('This is the plugin installed from the agent: it is updated there, with /plugin in Claude Code and /plugins in Codex.');
    }

    const release = await fetchRelease(requested?.replace(/^v/, '') ?? null, current);
    writeState({ ...readState(), checked_at: Date.now(), latest: requested ? readState().latest : release.version });
    if (release.version === current) return console.log(`coders-talk ${current} is ${requested ? 'the version asked for' : 'the latest'} already.`);

    const name = assetName();
    const file = release.assets.find((a) => a.name === name);
    const sums = release.assets.find((a) => a.name === 'SHA256SUMS');
    if (!file || !sums) throw new Failure(`Release ${release.version} has no ${file ? 'SHA256SUMS' : name}.`);

    const expected = (await (await download(sums.browser_download_url, current)).text())
        .split('\n').map((l) => l.trim().split(/\s+\*?/)).find(([, n]) => n === name)?.[0];
    const body = Buffer.from(await (await download(file.browser_download_url, current)).arrayBuffer());
    if (!expected || createHash('sha256').update(body).digest('hex') !== expected.toLowerCase()) {
        throw new Failure(`The downloaded ${name} does not match the SHA256SUMS of release ${release.version}. Nothing was changed.`);
    }

    replaceExecutable(executable, body);
    console.log(`Updated coders-talk ${current} → ${release.version}.`);
}

/** The new file next to the running one, then moved over it; on Windows the running one steps aside first. */
export function replaceExecutable(executable, body) {
    const fresh = `${executable}.new`;
    writeFileSync(fresh, body, { mode: 0o755 });
    if (process.platform !== 'win32') return renameSync(fresh, executable);

    const old = `${executable}.old`;
    rmSync(old, { force: true });
    renameSync(executable, old);
    try {
        renameSync(fresh, executable);
    } catch (e) {
        renameSync(old, executable);
        throw e;
    }
}

/** What an earlier update left behind: the old .exe that was still running then. */
export function removeLeftover(executable = process.execPath) {
    try {
        if (existsSync(`${executable}.old`)) rmSync(`${executable}.old`, { force: true });
    } catch {
        // Still running somewhere (a hook): the next start tries again.
    }
}

/**
 * One line on stderr when a newer release is known, at most once a day; a stale check starts a new one in the
 * background for next time. The single file only.
 */
export function updateNotice(current, { env = process.env, now = Date.now() } = {}) {
    if (!BINARY_VERSION || env.CODERS_TALK_NO_UPDATE_CHECK === '1') return;
    try {
        const state = readState();
        if (state.latest && newer(state.latest, current) && now - (state.notified_at ?? 0) > DAY_MS) {
            console.error(`coders-talk ${state.latest} is out (this is ${current}): run coders-talk update`);
            state.notified_at = now;
        }
        const stale = now - (state.checked_at ?? 0) > DAY_MS;
        if (stale) state.checked_at = now;
        // Written before the check starts, which writes what it finds.
        writeState(state);
        if (stale) inBackground(['update', '--check']);
    } catch {
        // An unreadable home folder: no notice.
    }
}

/** A release by version, or the latest one: {version, assets: [{name, browser_download_url}]}. */
async function fetchRelease(version, current) {
    const url = version ? `${releases()}/tags/${TAG_PREFIX}${version}` : `${releases()}/latest`;
    const response = await download(url, current, 'application/vnd.github+json', 15000).catch((e) => {
        throw e.status === 404 ? new Failure(version ? `There is no release ${version}.` : 'No release found.') : e;
    });
    const data = await response.json();
    const tag = String(data.tag_name ?? '');
    if (!tag.startsWith(TAG_PREFIX)) throw new Failure(`The latest release (${tag || 'no tag'}) is not a coders-talk one.`);

    return { version: tag.slice(TAG_PREFIX.length), assets: Array.isArray(data.assets) ? data.assets : [] };
}

/** GET through the proxy the environment names, following redirects (GitHub sends release files elsewhere). */
async function download(url, current, accept = 'application/octet-stream', timeoutMs = 300_000) {
    const signal = AbortSignal.timeout(timeoutMs);
    for (let hops = 0; hops < 5; hops++) {
        let response;
        try {
            response = await request(url, { headers: { Accept: accept, 'User-Agent': `coders-talk/${current ?? 'dev'}` }, signal });
        } catch (e) {
            throw new Failure(`Could not reach ${new URL(url).host}: ${e.cause?.message ?? e.message}`);
        }
        const location = response.headers.get('location');
        if (response.status >= 300 && response.status < 400 && location) {
            url = new URL(location, url).href;
            continue;
        }
        if (!response.ok) throw Object.assign(new Failure(`${new URL(url).host} answered ${response.status}.`), { status: response.status });

        return response;
    }
    throw new Failure('Too many redirects.');
}

function readState() {
    try {
        return JSON.parse(readFileSync(stateFile(), 'utf8'));
    } catch {
        return {};
    }
}

function writeState(state) {
    mkdirSync(home(), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify(state, null, 2));
}
