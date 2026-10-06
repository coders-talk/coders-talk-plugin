/**
 * The app's own updates (src/main/updates.mjs says where they are). A check at start and every six hours, or when the
 * person asks in Settings; an update downloads in the background, and goes in when the person presses Restart, or by
 * itself when the app quits. Nothing is asked of the site: the releases are on GitHub, which sees the address the request
 * comes from, nothing else.
 *
 * The window learns the state as {state, version?, percent?, error?, checkedAt?}:
 *   off          a copy that is not installed (developing), or CODERS_TALK_APP_NO_UPDATE=1
 *   store        installed from the Microsoft Store (MSIX): the Store updates it, and an app it installed may not update itself
 *   idle         not checked yet
 *   checking     asking GitHub
 *   none         this is the newest
 *   downloading  {version, percent}
 *   ready        {version}: downloaded and checked, waiting for a restart
 *   error        {error}: said only to someone who asked; the next check tries again
 */
import { feedUrl, isUpdate, latestAppRelease, releasesUrl } from './updates.mjs';

const EVERY_MS = 6 * 60 * 60_000;

/**
 * @param {{app: Electron.App, net: Electron.Net, autoUpdater: import('electron-updater').AppUpdater, broadcast: (state: object) => void, env?: object}} deps
 */
export function createUpdater({ app, net, autoUpdater, broadcast, env = process.env, store = Boolean(process.windowsStore) }) {
    const enabled = app.isPackaged && !store && env.CODERS_TALK_APP_NO_UPDATE !== '1';
    let current = { state: store ? 'store' : enabled ? 'idle' : 'off' };
    const set = (next) => {
        current = next;
        broadcast(current);
    };

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // electron-updater writes to the console otherwise; the window is where the person sees it.
    autoUpdater.logger = null;
    autoUpdater.on('download-progress', (p) => set({ state: 'downloading', version: current.version, percent: Math.round(p.percent ?? 0) }));
    autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }));
    autoUpdater.on('update-not-available', () => set({ state: 'none', checkedAt: Date.now() }));
    autoUpdater.on('error', (e) => current.state !== 'ready' && set({ state: 'error', error: String(e?.message ?? e).split('\n')[0] }));

    async function check() {
        if (!enabled || ['checking', 'downloading', 'ready'].includes(current.state)) return current;
        set({ state: 'checking' });
        try {
            const response = await net.fetch(releasesUrl(env), { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `coders-talk-app/${app.getVersion()}` } });
            if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
            const release = latestAppRelease(await response.json());
            if (!isUpdate(release, app.getVersion())) {
                set({ state: 'none', checkedAt: Date.now() });
                return current;
            }
            set({ state: 'downloading', version: release.version, percent: 0 });
            // electron-updater reads latest.yml (latest-mac.yml on macOS) from there, checks the installer's SHA-512 against it.
            autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl(release.tag, env) });
            await autoUpdater.checkForUpdates();
        } catch (e) {
            set({ state: 'error', error: String(e?.message ?? e).split('\n')[0] });
        }

        return current;
    }

    return {
        state: () => current,
        check,
        /** Every six hours, the first a little after the start: the window comes up first. */
        schedule() {
            if (!enabled) return;
            setTimeout(check, Number(env.CODERS_TALK_APP_UPDATE_DELAY_MS) || 15_000);
            setInterval(check, EVERY_MS).unref?.();
        },
        /** Restart into the downloaded version: the installer runs quietly and opens the app again. */
        install() {
            if (current.state !== 'ready') return false;
            setImmediate(() => autoUpdater.quitAndInstall(true, env.CODERS_TALK_APP_NO_RELAUNCH !== '1'));

            return true;
        },
    };
}
