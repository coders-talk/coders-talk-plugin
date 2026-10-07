/**
 * KeepPlain for macOS and Windows: one window over the keepplain CLI (src/main/cli.mjs runs it, src/main/api.mjs
 * says what the window may ask of it). The window has no Node and no network of its own: it asks through the preload
 * (preload.cjs), and only for the methods api.mjs has. Links open in the person's browser, and only the site's.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, session, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApi } from './src/main/api.mjs';
import { CLI_NAME, cliEnv, ensureCli, runCli } from './src/main/cli.mjs';
import { withSystemProxy } from './src/main/proxy.mjs';
import { createUpdater } from './src/main/updater.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = join(HERE, 'src', 'renderer', 'index.html');
const PAGE_URL = pathToFileURL(PAGE).href;

// A separate settings folder, for trying the app beside the installed one (and for its UI checks).
if (process.env.KEEPPLAIN_APP_DATA) app.setPath('userData', process.env.KEEPPLAIN_APP_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

/** The app's own settings: the window's size. Nothing else. */
const settingsFile = () => join(app.getPath('userData'), 'settings.json');
function readSettings() {
    try {
        return JSON.parse(readFileSync(settingsFile(), 'utf8'));
    } catch {
        return {};
    }
}
function writeSettings(patch) {
    const next = { ...readSettings(), ...patch };
    mkdirSync(dirname(settingsFile()), { recursive: true });
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2));

    return next;
}

/** The keepplain file inside the app: resources/bin in a build, the staged or built one while developing. */
function bundledCli() {
    if (app.isPackaged) return join(process.resourcesPath, 'bin', CLI_NAME);
    const os = { darwin: 'mac', win32: 'win' }[process.platform] ?? process.platform;
    const staged = join(HERE, 'resources', 'bin', `${os}-${process.arch}`, CLI_NAME);
    if (existsSync(staged)) return staged;
    const built = join(HERE, '..', 'dist', process.platform === 'win32' ? `keepplain-windows-${process.arch}.exe` : `keepplain-${process.platform}-${process.arch}`);

    return existsSync(built) ? built : null;
}

let cli = null;
let cliError = null;
let api = null;
/** The site keepplain talks to, from its last status: the only one whose pages the app opens. */
let site = null;
/** The app's own updates (src/main/updater.mjs); the window hears of each change of state. */
const updater = createUpdater({
    app,
    net,
    autoUpdater: electronUpdater.autoUpdater,
    broadcast: (state) => BrowserWindow.getAllWindows().forEach((w) => !w.webContents.isDestroyed() && w.webContents.send('ct:update', state)),
});

function start() {
    const env = cliEnv();
    try {
        cli = ensureCli({ bundled: bundledCli(), env });
    } catch (e) {
        cliError = e.message;
    }
    api = createApi({
        run: async (args, options = {}) => {
            if (!cli) return { ok: false, result: null, events: [], error: cliError, details: null };
            // The system's proxy, asked again for each command: a VPN client may have been switched on or off meanwhile.
            const target = process.env.KEEPPLAIN_URL || site || 'https://keepplain.com';
            const withProxy = await withSystemProxy(env, target, (url) => session.defaultSession.resolveProxy(url));
            // A session's folder may be gone (a removed worktree): keepplain finds the session by its id from anywhere.
            return runCli(cli.path, args, { env: withProxy, ...options, cwd: options.cwd && existsSync(options.cwd) ? options.cwd : app.getPath('home') });
        },
    });
}

function createWindow() {
    const { bounds } = readSettings();
    const win = new BrowserWindow({
        width: bounds?.width ?? 1040,
        height: bounds?.height ?? 720,
        minWidth: 760,
        minHeight: 520,
        title: 'KeepPlain',
        // The page's own background, so the window does not flash while it loads.
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0e0c' : '#f1ede6',
        // macOS: the traffic lights sit on the page's sidebar, as in the system's own apps.
        ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } } : {}),
        show: false,
        // Windows and Linux show it in the title bar and the taskbar; macOS takes the bundle's.
        ...(process.platform === 'darwin' ? {} : { icon: join(HERE, 'build', 'icon.png') }),
        webPreferences: {
            preload: join(HERE, 'preload.cjs'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            spellcheck: false,
        },
    });
    win.once('ready-to-show', () => win.show());
    win.on('close', () => writeSettings({ bounds: win.getBounds() }));
    // The page is the app's own file and stays so: no navigation, no new windows.
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.loadFile(PAGE);

    return win;
}

/** Calls from the app's own page only. */
const fromPage = (event) => event.senderFrame?.url === PAGE_URL;

ipcMain.handle('ct', async (event, { method, params, token } = {}) => {
    if (!fromPage(event)) throw new Error('Not from the app.');
    const send = (data) => !event.sender.isDestroyed() && event.sender.send('ct:event', { token, data });

    // The first call finds or installs keepplain: the window is up by then and says it is starting.
    if (method === 'init') {
        if (!api) start();
        return { cli, cliError, app: app.getVersion(), platform: process.platform };
    }
    if (method === 'chooseFolder') {
        const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'The folder your agent sessions ran in', properties: ['openDirectory'] });
        if (r.canceled || !r.filePaths[0]) return null;
        return { folder: r.filePaths[0] };
    }
    if (method === 'open') return openLink(params?.url);
    if (method === 'updateState') return updater.state();
    if (method === 'checkUpdates') return updater.check();
    if (method === 'installUpdate') return updater.install();
    if (method === 'confirm') {
        const r = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
            type: 'warning',
            buttons: [String(params?.yes ?? 'OK'), 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            message: String(params?.message ?? ''),
            detail: String(params?.detail ?? ''),
        });
        return r.response === 0;
    }

    if (!api || typeof api[method] !== 'function') throw new Error(`Unknown request ${method}.`);
    const r = await api[method](params ?? {}, send);
    if (method === 'status' && r.ok && r.result?.site) site = r.result.site;

    return r;
});

/** A page of the site in the person's browser; anything else is refused. */
function openLink(url) {
    let target;
    try {
        target = new URL(url);
    } catch {
        return false;
    }
    const allowed = site ? new URL(site).origin : 'https://keepplain.com';
    if (target.origin !== allowed) return false;
    shell.openExternal(target.href);

    return true;
}

// Windows groups the taskbar button and the Start menu shortcut by this id (the installer gives the shortcut the same).
// From the Store (MSIX) the package gives the app its id: setting another one would split the taskbar button from it.
if (process.platform === 'win32' && !process.windowsStore) app.setAppUserModelId('com.keepplain.desktop');

app.whenReady().then(() => {
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    const win = createWindow();
    updater.schedule();
    app.on('second-instance', () => {
        if (win.isMinimized()) win.restore();
        win.focus();
    });
});
app.on('window-all-closed', () => app.quit());
