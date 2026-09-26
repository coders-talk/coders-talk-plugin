/* global CODERS_TALK_PLUGIN_SOURCES */
/**
 * The plugin `coders-talk enable` lays out for the agents (plan, stage 13.3): the same skills, hooks and MCP server as
 * this repository's, as a local marketplace "coders-talk-local" in ~/.coders-talk/plugin, whose commands call the
 * installed coders-talk by its absolute path instead of node and a script. Desktop apps run hooks with their own
 * PATH, which lacks the folder an rc file added; and the file itself stays out of the plugin, which each agent copies
 * into its cache for every version.
 *
 * The sources are this repository's files: read from it under Node, built into the single file by scripts/build.mjs.
 * Each agent gets its command in the form its shell takes:
 *   Claude Code hooks   exec form (command + args), which no shell parses, on any platform
 *   Claude Code skills  POSIX quoting for the Bash tool (Git Bash on Windows), with a word for PowerShell on Windows
 *   headersHelper       sh, or cmd.exe on Windows
 *   Codex hooks, skills sh, or PowerShell on Windows (`& '…'`: a quoted path alone is a string there, not a call)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKETPLACE = 'coders-talk-local';
export const PLUGIN_ID = `coders-talk@${MARKETPLACE}`;

const SOURCE_FILES = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'hooks/hooks.json', 'codex/hooks.json'];
const SOURCE_DIRS = ['skills', 'codex/skills'];

/** The repository files the plugin is made from, by path: built into the single file, or read from the repository. */
export function pluginSources() {
    if (typeof CODERS_TALK_PLUGIN_SOURCES === 'object') return CODERS_TALK_PLUGIN_SOURCES;
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

    return readSources(root);
}

export function readSources(root) {
    const files = {};
    const add = (path) => (files[relative(root, path).split('\\').join('/')] = readFileSync(path, 'utf8'));
    const walk = (dir) => readdirSync(dir).forEach((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : add(join(dir, name))));
    SOURCE_FILES.forEach((f) => add(join(root, f)));
    SOURCE_DIRS.filter((d) => existsSync(join(root, d))).forEach((d) => walk(join(root, d)));

    return files;
}

/** Single-quoted for sh and Git Bash: nothing inside is special. */
export const shCommand = (parts) => parts.map((p) => `'${p.replace(/'/g, `'\\''`)}'`).join(' ');
/** PowerShell: the call operator, then single-quoted words. */
export const psCommand = (parts) => `& ${parts.map((p) => `'${p.replace(/'/g, "''")}'`).join(' ')}`;
/** cmd.exe: double quotes; a Windows path holds none. */
export const cmdCommand = (parts) => parts.map((p) => (/[\s&^|<>()"]/.test(p) ? `"${p}"` : p)).join(' ');

/**
 * The files of the plugin, by path. $program is what runs coders-talk: the file, or node and the script.
 *
 * @param {Record<string, string>} sources pluginSources()
 * @param {{program: string[], version: string, site: string, mcp?: {claude?: boolean, codex?: boolean}, windows?: boolean}} options
 *        mcp: whether the plugin brings its MCP server to each agent (not to one where the person keeps their own)
 */
export function pluginFiles(sources, { program, version, site, mcp = {}, windows = process.platform === 'win32' }) {
    const serverFor = { claude: mcp.claude ?? true, codex: mcp.codex ?? true };
    const files = {};
    const json = (path, data) => (files[path] = JSON.stringify(data, null, 4) + '\n');
    const source = (path) => {
        if (!(path in sources)) throw new Error(`The plugin's ${path} is missing from this build.`);
        return sources[path];
    };
    const claudeRun = shCommand(program);
    const codexRun = windows ? psCommand(program) : shCommand(program);
    const description = 'Coders Talk, laid out by coders-talk enable: the commands call the installed coders-talk.';

    json('.claude-plugin/plugin.json', { ...JSON.parse(source('.claude-plugin/plugin.json')), version });
    json('.claude-plugin/marketplace.json', {
        name: MARKETPLACE,
        description,
        owner: { name: 'Coders Talk', url: 'https://coders.talk' },
        plugins: [{ name: 'coders-talk', source: './', description: 'Send a Claude Code session to Coders Talk as a draft Build you review and publish on the site.' }],
    });
    const codexManifest = { ...JSON.parse(source('.codex-plugin/plugin.json')), version };
    if (!serverFor.codex) delete codexManifest.mcpServers;
    json('.codex-plugin/plugin.json', codexManifest);
    json('.agents/plugins/marketplace.json', {
        name: MARKETPLACE,
        interface: { displayName: 'Coders Talk' },
        plugins: [{ name: 'coders-talk', source: { source: 'local', path: './' }, policy: { installation: 'AVAILABLE' }, category: 'Developer Tools' }],
    });

    // One command per event: the file takes the git snapshot in the same run (lib/hooks.mjs).
    const claudeHook = (event) => ({ hooks: [{ type: 'command', command: program[0], args: [...program.slice(1), 'hook', 'claude-code', event], timeout: 10 }] });
    json('hooks/hooks.json', {
        description: JSON.parse(source('hooks/hooks.json')).description,
        hooks: { SessionStart: [claudeHook('session-start')], UserPromptSubmit: [claudeHook('prompt')], Stop: [claudeHook('stop')], SessionEnd: [claudeHook('session-end')] },
    });
    const codexHook = (event, timeout = 10) => ({ hooks: [{ type: 'command', command: `${codexRun} hook codex ${event}`, timeout }] });
    json('codex/hooks.json', {
        description: JSON.parse(source('codex/hooks.json')).description,
        // Codex gives a SessionEnd hook three seconds at most.
        hooks: { SessionStart: [codexHook('session-start')], Stop: [codexHook('stop')], SessionEnd: [codexHook('session-end', 3)] },
    });

    if (serverFor.claude) {
        const helper = `${windows ? cmdCommand(program) : shCommand(program)} mcp-headers`;
        json('.mcp.json', { mcpServers: { 'coders-talk': { type: 'http', url: `${site}/mcp`, headersHelper: helper } } });
    }
    if (serverFor.codex) json('codex/mcp.json', { mcpServers: { 'coders-talk': { type: 'http', url: `${site}/mcp` } } });

    for (const [path, text] of Object.entries(sources)) {
        if (path.startsWith('skills/')) files[path] = claudeSkill(text, claudeRun, windows);
        else if (path.startsWith('codex/skills/')) files[path] = codexSkill(text, codexRun);
    }
    for (const [path, text] of Object.entries(files)) {
        if (/\$\{CLAUDE_PLUGIN_ROOT\}|<plugin>|\bnode "/.test(text)) throw new Error(`The plugin's ${path} still calls the script: this build cannot lay it out.`);
    }

    return files;
}

const NODE_MISSING = /- If `node` is not found, tell the user the plugin needs Node\.js 20 or newer, and that they can upload the session at (\S+) instead\./g;
const NOT_INSTALLED = (upload) => `- If the command is not found, Coders Talk was removed from this computer: tell the user to install it again (https://coders.talk/plugins), or to upload the session at ${upload} instead.`;

function claudeSkill(text, run, windows) {
    const out = text.replaceAll('node "${CLAUDE_PLUGIN_ROOT}/scripts/coders-talk.mjs"', run).replace(NODE_MISSING, (_, upload) => NOT_INSTALLED(upload));
    if (!windows || out === text) return out;

    // The Bash tool runs these as written; PowerShell needs the call operator in front of a quoted path.
    return out.replace(/\n---\n/, "\n---\n\nIn PowerShell, put `& ` in front of the commands below: they start with the program's quoted path.\n");
}

function codexSkill(text, run) {
    return text
        .replaceAll('node "<plugin>/scripts/coders-talk.mjs"', run)
        .replace(/(In the commands? below, )?`<plugin>`( below)? is the absolute path of the plugin folder: this file is `<plugin>\/[^`]+`\. /g, '')
        .replace(/,? (only )?with `<plugin>` filled in/g, '')
        .replace(NODE_MISSING, (_, upload) => NOT_INSTALLED(upload));
}
