// A stand-in for the claude, codex and pi commands in the enable tests: `node fake-agent.mjs <claude|codex|pi> <args…>`.
// Keeps its plugins, marketplaces and MCP servers in FAKE_AGENT_STATE and writes every call to FAKE_AGENT_LOG. Pi keeps its
// packages where Pi does: `packages` in <PI_CODING_AGENT_DIR>/settings.json.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// node --test picks up every file under test/: run that way, there is nothing to do.
if (!process.env.FAKE_AGENT_STATE) process.exit(0);

const [agent, ...args] = process.argv.slice(2);
const statePath = process.env.FAKE_AGENT_STATE;
const all = JSON.parse(readFileSync(statePath, 'utf8'));
const state = (all[agent] ??= { plugins: {}, marketplaces: {}, mcp: [] });
appendFileSync(process.env.FAKE_AGENT_LOG, JSON.stringify({ agent, args, cwd: process.cwd() }) + '\n');
const save = () => writeFileSync(statePath, JSON.stringify(all, null, 2));
const [a, b, c] = args;
const versionOf = (id) => {
    const dir = state.marketplaces[id.split('@')[1]];
    try {
        return JSON.parse(readFileSync(`${dir}/${agent === 'codex' ? '.codex-plugin' : '.claude-plugin'}/plugin.json`, 'utf8')).version;
    } catch {
        return '0.0.1';
    }
};

// FAKE_AGENT_BROKEN=<agent>: that agent fails to install anything, the way a full disk or a permission does.
if (process.env.FAKE_AGENT_BROKEN === agent && a === 'plugin' && ['install', 'update', 'add'].includes(b)) {
    console.error('Error: EACCES: permission denied, mkdir plugins/cache');
    process.exit(1);
} else if (agent === 'pi' && ['install', 'remove'].includes(a)) {
    // As Pi 0.74 does (core/package-manager.js): a local package is saved relative to the agent folder, a saved one is
    // read from there, and the path given on the command line is read from the folder the command runs in.
    const agentDir = process.env.PI_CODING_AGENT_DIR;
    const file = join(agentDir, 'settings.json');
    let settings = {};
    try {
        settings = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        // no settings yet
    }
    const local = (source) => !/^(npm:|git:|https?:|ssh:)/.test(source);
    const key = (source, base) => (local(source) ? `local:${resolve(base, source).toLowerCase()}` : source);
    const given = key(b, process.cwd());
    const others = (settings.packages ?? []).filter((p) => key(typeof p === 'string' ? p : p?.source, agentDir) !== given);
    if (a === 'remove' && others.length === (settings.packages ?? []).length) {
        console.error(`No matching package found for ${b}`);
        process.exit(1);
    }
    settings.packages = a === 'install' ? [...others, local(b) ? relative(agentDir, resolve(b)) || '.' : b] : others;
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(file, JSON.stringify(settings, null, 2));
    console.log(a === 'install' ? `Installed ${b}` : `Removed ${b}`);
} else if (a === 'plugin' && b === 'list') {
    const installed = Object.entries(state.plugins).map(([id, version]) => ({ id, version, ...(id.endsWith('@synced') ? { scope: 'synced' } : {}) }));
    if (agent === 'codex') {
        console.error('WARNING: proceeding, even though we could not create PATH aliases');
        console.log(JSON.stringify({ installed: installed.map((p) => ({ pluginId: p.id, name: p.id.split('@')[0], marketplaceName: p.id.split('@')[1], version: p.version, installed: true })), available: [] }));
    } else console.log(JSON.stringify(installed));
} else if (a === 'plugin' && b === 'marketplace' && c === 'list') {
    console.log(JSON.stringify(Object.entries(state.marketplaces).map(([name, path]) => ({ name, path }))));
} else if (a === 'plugin' && b === 'marketplace' && c === 'add') {
    state.marketplaces['coders-talk-local'] = args[3];
    save();
} else if (a === 'plugin' && b === 'marketplace' && c === 'remove') {
    if (!state.marketplaces[args[3]]) process.exit(1);
    delete state.marketplaces[args[3]];
    save();
} else if (a === 'plugin' && ['install', 'update', 'add'].includes(b)) {
    if (!state.marketplaces[c.split('@')[1]]) {
        console.error(`Marketplace ${c.split('@')[1]} not found`);
        process.exit(1);
    }
    state.plugins[c] = versionOf(c);
    save();
} else if (a === 'plugin' && ['uninstall', 'remove'].includes(b)) {
    // A plugin synced from claude.ai has no install record.
    if (c.endsWith('@synced')) {
        console.error(`Plugin "${c}" is not installed`);
        process.exit(1);
    }
    delete state.plugins[c];
    save();
} else if (a === 'mcp' && b === 'remove') {
    state.mcp = state.mcp.filter((name) => name !== c);
    save();
} else {
    console.error(`fake ${agent}: unknown command ${args.join(' ')}`);
    process.exit(2);
}
