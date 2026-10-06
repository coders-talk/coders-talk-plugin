# Coders Talk app

A window over the `coders-talk` CLI for macOS and Windows: connect the agents, see what is connected and what was sent,
send a session after a confirmation screen, change the settings. Every screen reads a command's `--json` output, and
every change is one command, so the app does nothing the CLI cannot do and keeps nothing of its own but its window's
size.

| Screen | Commands |
| --- | --- |
| Welcome (three steps) | `status --json` (the agents found), `login --json --client=desktop` (opens the browser, waits for Connect), `enable --yes --agent=<found> --json` |
| Home | `status --json` (account, agents, last session sent), `whoami --json` (does the sign-in still work), `enable` / `disable --yes --agent=<id> --json` per switch |
| Sessions | `sessions --all --json`: every project's sessions of the last 30 days, grouped by day, with search and an agent filter; or `sessions --json` in a folder picked by hand |
| Confirmation | `preview <id> --whole --agent=<id> [--private \| --team=<slug>] --json` (who can see it, the secrets found and hidden, what is included), then `send <id> --json` or `discard <id> --json`; Esc cancels, Ctrl/Cmd+Enter sends |
| Settings | `auto off\|on\|team --agent=<id>` for each connected agent, `rules on\|off`, `nudge on\|off`, `privacy set` (the words as chips, saved as each is added or removed), `disable --yes` then `logout` |

Nothing is sent without the confirmation screen: the main process (`src/main/api.mjs`) runs `send` only for a session
it previewed for that screen, once, within the half hour coders-talk keeps a preview. Cancel or leaving the screen runs
`discard`. The window has no Node and no network: it asks the main process through `preload.cjs` for the methods
`api.mjs` has, each of which builds its command itself from checked values. Links open in the browser, and only the
site's.

## Look

The site's own: its palette (`resources/css/app.css` on coders.talk), dark by default and light when the system is, Geist
Sans and Geist Mono (in `src/renderer/fonts`, SIL Open Font License, `LICENSE-Geist.txt`), the brand kit's mark drawn the
way the site's `BrandMark.vue` draws it, and the site's two-letter agent glyphs. `build/icon.png` is the brand kit's
`icon.svg` on its light background (#F8F7F3), 1024 px. The window works from 760 × 520: below 900 px wide the sidebar
keeps its icons only.

## The CLI inside

The app carries the single `coders-talk` file of the same commit (`resources/bin`, staged by `scripts/stage-cli.mjs`).
At start it puts it in `~/.coders-talk/bin`, where `install.sh` and `install.ps1` do, when that file is missing or older,
and runs that one. The agents' hooks call the file by its path, so they keep working without the app. A newer file there
(`coders-talk update`) is kept. An app opened from the Dock gets launchd's short PATH: `src/main/cli.mjs` asks the
login shell for its PATH, so `claude`, `codex` and `pi` are found. A session whose folder is gone (a removed worktree) is
still sent: coders-talk finds it by its id, run from the home folder.

A VPN that takes all traffic needs nothing. One in system-proxy mode (v2rayN, Clash, Hiddify and the like) sets a proxy in
the system settings. The standalone CLI reads Windows manual settings itself; the app also resolves PAC/WPAD. Before each
command the main process asks Chromium which proxy the site goes through (`session.resolveProxy`) and passes it on as
`HTTPS_PROXY`/`HTTP_PROXY` (`src/main/proxy.mjs`), an HTTP or SOCKS5 one. A proxy named in the environment stays.

## Develop

```bash
cd desktop
npm install
npm run stage-cli
npm start
```

`npm run stage-cli` builds the CLI for this computer with Bun (`../scripts/build.mjs`) when `../dist` has none. To try the
app beside your real setup, point it somewhere else: `CODERS_TALK_HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`,
`CURSOR_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, `CODERS_TALK_URL` and `CODERS_TALK_APP_DATA` (the app's own settings folder)
all pass through. `CODERS_TALK_APP_CLI=<path>` runs that coders-talk instead of installing one.

`npm test` runs the main process's tests under Node (no Electron needed). `npm run dist` builds the installer for this
computer into `out/`.

## Windows

`npm run dist` on Windows makes `out/Coders-Talk-Setup-<version>.exe` (about 135 MB: Electron and the coders-talk file).
It installs for the current user without admin rights into `%LOCALAPPDATA%\Programs\coders-talk-desktop`, with Start
menu and desktop shortcuts and a "Coders Talk" entry in Settings → Apps; `/S` installs silently, and the uninstaller
takes all of that away again. `~/.coders-talk` stays: the agents' hooks use the coders-talk file there. Unsigned, the
installer meets SmartScreen ("Windows protected your PC" → More info → Run anyway) until a code-signing certificate signs it.

The app's coders-talk carries the plugin's version number, which an older build may share (an unreleased one in
development, or the release before `--json`): a file in `~/.coders-talk/bin` that does not answer `nudge --json` is
replaced by the app's own when that one does (`speaksJson` in `src/main/cli.mjs`), whatever the numbers say.

## Microsoft Store

The Store takes an MSIX package and signs it itself, so the Store copy needs no code-signing certificate (the `.exe`
from the website stays unsigned until one exists). `npm run dist:store` (on Windows, with the Windows SDK) builds
`out/Coders-Talk-<version>-store.appx`: `scripts/dist-store.mjs` stages the CLI and runs electron-builder's `appx`
target with the SDK's `makeappx.exe`, because electron-builder's own copy may not start on a newer Windows. The tag
workflow builds the same as the `store-msix` artifact, kept out of the GitHub release; upload it in Partner Center.

- The package identity in `package.json` (`build.appx`: `identityName`, `publisher`, `publisherDisplayName`) must be
  Partner Center's, from Product management → Product identity. The placeholders there are refused by both builds.
- The package is a full-trust desktop app (`runFullTrust`): Partner Center asks why; it is an Electron app that runs
  the coding agents' own command-line tools to add its plugin to them.
- The Store copy does not update itself: the Store does (`process.windowsStore`, `src/main/updater.mjs` "store").
- MSIX gives the app and the processes it starts their own view of AppData (writes go to the package's folder, reads
  fall through to the real files). Nothing the agents read later lives there: `~/.coders-talk` and the agents' folders
  (`~/.claude`, `~/.codex`, `~/.cursor`, `~/.pi`) are outside AppData. Checked with the package registered for
  development and the app run inside it (`Invoke-CommandInDesktopPackage`): the CLI, the laid-out plugin and the
  agents' changes were the real files, and the CLI read the Claude app's real AppData.

## Updates

The installed app updates itself (`src/main/updater.mjs`, electron-updater). At start (after 15 s) and every six hours it
lists the repository's releases, takes the newest `desktop--vX.Y.Z` one that has `latest.yml` (`src/main/updates.mjs`:
never GitHub's "latest release", which is the CLI's), and downloads the installer from that release in the background,
only the changed blocks when the `.blockmap` of the installed version is there too. The sidebar then says "Update ready:
restart"; the installer also goes in by itself when the app quits. Settings shows the state and has "Check for updates".
The new version brings its own coders-talk, which replaces the one in `~/.coders-talk/bin` unless that one is newer.

So a release needs, beside the installer, its `latest.yml` and `.blockmap` (the workflow uploads them). The installer
keeps a copy of itself in `%LOCALAPPDATA%\coders-talk-desktop-updater` as the base for the next update;
`build/installer.nsh` removes it on uninstall (not on an update). `CODERS_TALK_APP_NO_UPDATE=1` turns the checks off;
`CODERS_TALK_APP_RELEASES_URL`, `CODERS_TALK_APP_DOWNLOADS_URL`, `CODERS_TALK_APP_UPDATE_DELAY_MS` and
`CODERS_TALK_APP_NO_RELAUNCH=1` point a test at a stand-in for GitHub. A copy that is not installed (`npm start`) never checks.

## Release

Tag `desktop--vX.Y.Z` (matching `package.json`): `.github/workflows/desktop.yml` builds the `.dmg` (Apple silicon and
Intel) and the Windows `.exe` with the CLI of that commit inside, and publishes them as a release that is never marked
latest (the CLI's installers and `coders-talk update` use the latest release). Without signing secrets the macOS app is
signed ad hoc and the Windows installer is unsigned; the workflow says which secrets sign and notarize them.

The CLI now also reads Windows manual Internet Settings when run without the app (including agent hooks), if no proxy environment variable is set. The app still resolves PAC/WPAD with Chromium; standalone CLI supports manual settings only. See the plugin README for precedence and bypass rules.
