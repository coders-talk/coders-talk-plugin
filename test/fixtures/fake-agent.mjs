// A stand-in for the claude and codex commands in the enable tests: `node fake-agent.mjs <claude|codex> <args…>`.
// Keeps its plugins, marketplaces and MCP servers in FAKE_AGENT_STATE and writes every call to FAKE_AGENT_LOG.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

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

if (a === 'plugin' && b === 'list') {
    const installed = Object.entries(state.plugins).map(([id, version]) => ({ id, version }));
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
    delete state.plugins[c];
    save();
} else if (a === 'mcp' && b === 'remove') {
    state.mcp = state.mcp.filter((name) => name !== c);
    save();
} else {
    console.error(`fake ${agent}: unknown command ${args.join(' ')}`);
    process.exit(2);
}
