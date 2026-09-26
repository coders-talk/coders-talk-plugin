/**
 * The agents on this computer, for `coders-talk enable`, `disable` and `status` (plan, stage 13.3), and their own
 * plugin commands, which do the installing: Coders Talk never edits an agent's settings itself.
 *
 *   Claude Code  `claude` in PATH; its config folder (~/.claude, CLAUDE_CONFIG_DIR) says it is here without one
 *   Codex        `codex` in PATH, or the CLI the desktop app keeps in ~/.codex/plugins/.plugin-appserver;
 *                ~/.codex (CODEX_HOME) says it is here without one
 *
 * Also the Coders Talk MCP servers someone added by hand (`claude mcp add`, Codex's config.toml): with the plugin's
 * own, the agent would see the same tools twice, and the desktop app mixes up their sign-ins.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { codexHome, configDir } from './session.mjs';

/** The full path of a program in PATH, or null. On Windows with PATHEXT (claude.exe, claude.cmd from npm). */
export function findProgram(name, env = process.env, platform = process.platform) {
    const dirs = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean);
    const exts = platform === 'win32' ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
    for (const dir of dirs) {
        for (const ext of exts) {
            const path = join(dir, name + ext.toLowerCase());
            if (existsSync(path)) return path;
        }
    }

    return null;
}

/** Both agents: {id, name, cli (a path or null), home, present}. */
export function detectAgents(env = process.env) {
    const exe = process.platform === 'win32' ? '.exe' : '';
    const desktopCodex = join(codexHome(env), 'plugins', '.plugin-appserver', `codex${exe}`);
    const claudeHome = configDir(env);
    const claudeCli = findProgram('claude', env);
    const codexCli = findProgram('codex', env) ?? (existsSync(desktopCodex) ? desktopCodex : null);

    return [
        { id: 'claude-code', name: 'Claude Code', cli: claudeCli, home: claudeHome, present: Boolean(claudeCli) || existsSync(claudeHome) },
        { id: 'codex', name: 'Codex', cli: codexCli, home: codexHome(env), present: Boolean(codexCli) || existsSync(codexHome(env)) },
    ];
}

/**
 * Runs the agent's CLI: {ok, out, stdout}; out has stderr too. A .cmd from npm needs a shell on Windows; everything passed here is ours (fixed
 * words and paths), quoted for it.
 */
export function runCli(cli, args, { env = process.env, cwd } = {}) {
    const shell = /\.(cmd|bat)$/i.test(cli);
    const quote = (a) => (/[\s&^|<>()"]/.test(a) ? `"${a}"` : a);
    const r = shell
        ? spawnSync([cli, ...args].map(quote).join(' '), { shell: true, env, cwd, encoding: 'utf8', timeout: 120_000, windowsHide: true })
        : spawnSync(cli, args, { env, cwd, encoding: 'utf8', timeout: 120_000, windowsHide: true });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() || (r.error ? r.error.message : '');

    return { ok: r.status === 0, out, stdout: r.stdout ?? '' };
}

/** The JSON a --json command printed, or null. Codex writes warnings next to it. */
function jsonOf({ ok, stdout }) {
    if (!ok) return null;
    const start = stdout.search(/^[[{]/m);
    try {
        return start < 0 ? null : JSON.parse(stdout.slice(start));
    } catch {
        return null;
    }
}

/** The Coders Talk plugins installed in the agent: [{id, version, marketplace}] (empty when it cannot tell). */
export function installedPlugins(agent, env = process.env) {
    if (!agent.cli) return [];
    if (agent.id === 'claude-code') {
        const list = jsonOf(runCli(agent.cli, ['plugin', 'list', '--json'], { env }));

        return (Array.isArray(list) ? list : [])
            .filter((p) => typeof p.id === 'string' && p.id.startsWith('coders-talk@'))
            .map((p) => ({ id: p.id, version: p.version ?? null, marketplace: p.id.slice('coders-talk@'.length) }));
    }
    const list = jsonOf(runCli(agent.cli, ['plugin', 'list', '--json'], { env }));

    return (Array.isArray(list?.installed) ? list.installed : [])
        .filter((p) => p.name === 'coders-talk' && p.installed !== false)
        .map((p) => ({ id: p.pluginId ?? `coders-talk@${p.marketplaceName}`, version: p.version ?? null, marketplace: p.marketplaceName }));
}

const isOurServer = (url, site) => typeof url === 'string' && (url.replace(/\/+$/, '') === `${site}/mcp` || /^https:\/\/coders\.talk\/mcp\/?$/.test(url));

/**
 * MCP servers of Coders Talk added by hand: [{name, scope, project?}]. Claude Code keeps them in ~/.claude.json (in
 * CLAUDE_CONFIG_DIR when that is set): user scope at the top, local scope under each project. Codex in config.toml.
 */
export function manualMcpServers(agent, site, env = process.env) {
    if (agent.id === 'claude-code') {
        const file = env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json');
        let config;
        try {
            config = JSON.parse(readFileSync(file, 'utf8'));
        } catch {
            return [];
        }
        const found = Object.entries(config.mcpServers ?? {}).filter(([, s]) => isOurServer(s?.url, site)).map(([name]) => ({ name, scope: 'user' }));
        for (const [project, p] of Object.entries(config.projects ?? {})) {
            for (const [name, s] of Object.entries(p?.mcpServers ?? {})) if (isOurServer(s?.url, site)) found.push({ name, scope: 'local', project });
        }

        return found;
    }

    let toml;
    try {
        toml = readFileSync(join(agent.home, 'config.toml'), 'utf8');
    } catch {
        return [];
    }
    // Only what is needed here: [mcp_servers.<name>] tables and their url.
    const found = [];
    let current = null;
    for (const line of toml.split(/\r?\n/)) {
        const table = line.match(/^\s*\[mcp_servers\.("?)([^\]."]+)\1\]\s*$/);
        if (table) current = table[2];
        else if (/^\s*\[/.test(line)) current = null;
        else if (current && isOurServer(line.match(/^\s*url\s*=\s*["']([^"']+)["']/)?.[1], site)) found.push({ name: current, scope: 'user' });
    }

    return found;
}

/** Removes a server found by manualMcpServers with the agent's own command. */
export function removeMcpServer(agent, server, env = process.env) {
    if (agent.id === 'claude-code') return runCli(agent.cli, ['mcp', 'remove', server.name, '--scope', server.scope], { env, cwd: server.project });

    return runCli(agent.cli, ['mcp', 'remove', server.name], { env });
}
