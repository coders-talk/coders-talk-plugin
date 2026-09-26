/**
 * coders-talk enable, disable and status (plan, stage 13.3): the installed coders-talk connects the agents on this
 * computer to itself once, through each agent's own plugin system.
 *
 * enable lays the plugin out in ~/.coders-talk/plugin (lib/plugin.mjs) and installs it from there as
 * coders-talk@coders-talk-local: `claude plugin marketplace add` and `claude plugin install`, `codex plugin marketplace
 * add` and `codex plugin add`. It says what it found and what it will do before it does anything, and asks, unless
 * --yes. On the way:
 *   - the plugin from the GitHub marketplace (coders-talk@coders-talk) is replaced, or its hooks and snapshots would
 *     run twice;
 *   - a Coders Talk MCP server added by hand is removed, or kept and the plugin brings none to that agent;
 *   - auto mode is one question for every agent found (--auto=off|on|team|push), off unless the person says otherwise.
 *     Codex's trust in the hooks stays Codex's: one line says where to give it;
 *   - in a git repository, one question about its git hooks (lib/githooks.mjs, --git-hooks, --no-git-hooks,
 *     --no-trailers), no unless they are there already. Every repository they went into is remembered, for disable.
 * The choices are kept in ~/.coders-talk/enable.json, so `coders-talk update` lays the plugin out again the same way
 * (refresh): the plugin's version is always the file's.
 *
 * disable takes all of it off again; the sign-in, the settings and the file itself stay. status says how things are.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { detectAgents, installedPlugins, manualMcpServers, removeMcpServer, runCli } from './agents.mjs';
import { autoMode, setAutoMode } from './auto.mjs';
import { hooksOf, installedHooks, installHooks, manualHookLines, removeHooks, TRAILER } from './githooks.mjs';
import { home, savedUsername } from './credentials.mjs';
import { Failure } from './failure.mjs';
import { MARKETPLACE, PLUGIN_ID, pluginFiles, pluginSources } from './plugin.mjs';
import { BINARY_VERSION, selfProgram } from './runtime.mjs';

const pluginDir = () => join(home(), 'plugin');
const choicesFile = () => join(home(), 'enable.json');
const AUTO = { off: null, on: 'all', all: 'all', team: 'team', push: 'push' };
const autoName = (mode) => (mode === 'all' ? 'on' : mode ?? 'off');
const MCP_KEY = { 'claude-code': 'claude', codex: 'codex' };

/**
 * @param {{site: string, version: string, interactive: boolean, flags: {yes?: boolean, agents?: string[], auto?: string, mcp?: string, gitHooks?: boolean, trailers?: boolean}}} context
 *        gitHooks: true or false from --git-hooks / --no-git-hooks, undefined to ask
 */
export async function enable({ site, version, interactive, flags }) {
    if (flags.auto !== undefined && !(flags.auto in AUTO)) throw new Failure(`--auto takes off, on, team or push, not "${flags.auto}".`);
    if (flags.mcp !== undefined && !['remove', 'keep'].includes(flags.mcp)) throw new Failure(`--mcp takes remove or keep, not "${flags.mcp}".`);
    if (!interactive && !flags.yes) throw new Failure('coders-talk enable asks before it changes anything: run it in a terminal, or add --yes to go ahead with the defaults.');

    const agents = chosenAgents(flags.agents).filter((a) => a.present);
    if (!agents.length) throw new Failure('Found neither Claude Code nor Codex on this computer. Install one of them, then run coders-talk enable again.');

    const prompt = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
    try {
        const ask = async (question, fallback) => {
            if (!prompt || flags.yes) return fallback;
            const answer = (await prompt.question(`${question} `)).trim().toLowerCase();

            return answer || fallback;
        };

        // What is there.
        const state = agents.map((agent) => {
            const plugins = installedPlugins(agent);

            return { agent, plugins, ours: plugins.find((p) => p.marketplace === MARKETPLACE), others: plugins.filter((p) => p.marketplace !== MARKETPLACE), servers: manualMcpServers(agent, site) };
        });
        console.log(`coders-talk ${version} (${selfProgram().join(' ')})`);
        console.log('Found:');
        for (const { agent, plugins, servers } of state) {
            const has = plugins.length ? plugins.map((p) => `${p.id} ${p.version ?? ''}`.trim()).join(', ') : 'no Coders Talk plugin';
            const hand = servers.length ? `; Coders Talk MCP server added by hand: ${servers.map(describeServer).join(', ')}` : '';
            console.log(`  ${agent.name.padEnd(12)} ${agent.cli ?? `${agent.home}, but not its command`}; ${has}${hand}`);
        }

        // The questions.
        for (const s of state) {
            if (!s.others.length || !s.agent.cli) continue;
            const answer = await ask(`${s.agent.name} has ${s.others.map((p) => p.id).join(', ')} installed; its hooks would run twice next to this one. Replace it? [Y/n]`, 'y');
            s.replace = answer.startsWith('y');
        }
        const withServers = state.filter((s) => s.servers.length && s.agent.cli);
        let mcp = flags.mcp;
        if (withServers.length && !mcp) {
            const answer = await ask('Remove the Coders Talk MCP server added by hand, so the plugin brings its own [r], or keep it and install the plugin without one [K]?', 'k');
            mcp = answer.startsWith('r') ? 'remove' : 'keep';
        }
        const current = autoName(autoMode(site, agents[0].id));
        let auto = flags.auto;
        if (auto === undefined) {
            const answer = await ask(`Auto mode: send sessions to ${site} by themselves (on), only those in repositories of teams that ask (team), only those whose commits you push (push), or only when you run build (off)? [${current}]`, current);
            auto = answer in AUTO ? answer : current;
        }

        // This repository's git hooks, if it is one.
        const repo = hooksOf(process.cwd());
        const hooksThere = repo && !repo.shared ? installedHooks(repo) : [];
        let gitHooks = flags.gitHooks;
        if (repo && gitHooks === undefined) {
            const had = hooksThere.length > 0;
            const answer = await ask(`Git hooks for ${repo.root}: an ${TRAILER} trailer in commits made with a session, and the sessions behind a push found when you push? The session id becomes part of the repository's history. [${had ? 'Y/n' : 'y/N'}]`, had ? 'y' : 'n');
            gitHooks = answer.startsWith('y');
        }
        const trailers = flags.trailers ?? true;

        // The plan, then the go-ahead.
        const installing = state.filter((s) => s.agent.cli && (!s.others.length || s.replace));
        const plan = [`Lay out the plugin ${version} in ${pluginDir()}`];
        for (const s of state) {
            if (!s.agent.cli) plan.push(`${s.agent.name}: its command is not in PATH, so install the plugin from inside it (printed at the end)`);
            else if (s.others.length && !s.replace) plan.push(`${s.agent.name}: leave it as it is (it keeps ${s.others.map((p) => p.id).join(', ')})`);
            else {
                if (s.replace) plan.push(`${s.agent.name}: uninstall ${s.others.map((p) => p.id).join(', ')}`);
                if (s.servers.length && mcp === 'remove') plan.push(`${s.agent.name}: remove the MCP server ${s.servers.map(describeServer).join(', ')}`);
                plan.push(`${s.agent.name}: ${s.ours ? 'update' : 'install'} ${PLUGIN_ID}${s.servers.length && mcp === 'keep' ? ', without its MCP server' : ''}`);
            }
        }
        plan.push(`Auto mode: ${auto}${auto === current ? ' (as it is)' : ''}`);
        if (repo && gitHooks && repo.shared) plan.push(`Git hooks: ${repo.root} keeps its hooks in ${repo.dir} (core.hooksPath), which is not ours to change: the lines to add there are printed at the end`);
        else if (repo && gitHooks) plan.push(`Git hooks in ${repo.dir}: ${trailers ? 'prepare-commit-msg (the trailer) and pre-push' : 'pre-push only (no trailers)'}`);
        else if (repo && hooksThere.length) plan.push(`Git hooks: take ours out of ${repo.dir}`);
        console.log(`\nThis will:\n${plan.map((p) => `  - ${p}`).join('\n')}`);
        if (!(await ask('Go ahead? [Y/n]', 'y')).startsWith('y')) {
            console.log('Nothing was changed.');
            return;
        }

        // The work.
        const mcpFor = Object.fromEntries(state.map((s) => [MCP_KEY[s.agent.id], !(s.servers.length && mcp === 'keep')]));
        const choices = { ...readChoices(), mcp: { ...readChoices().mcp, ...mcpFor } };
        layOut({ site, version, mcp: choices.mcp });
        writeChoices(choices);
        const done = [];
        for (const s of state) {
            if (!installing.includes(s)) continue;
            const { agent } = s;
            if (s.replace) for (const p of s.others) step(agent, agent.id === 'codex' ? ['plugin', 'remove', p.id] : ['plugin', 'uninstall', p.id]);
            if (mcp === 'remove') for (const server of s.servers) check(agent, removeMcpServer(agent, server), `remove the MCP server ${server.name}`);
            installPlugin(agent, s.ours);
            done.push(agent);
        }

        const mode = AUTO[auto];
        const changed = autoName(mode) !== current || agents.some((a) => autoMode(site, a.id) !== mode);
        if (changed) for (const agent of agents) setAutoMode(site, mode, agent.id);

        if (repo && !repo.shared && gitHooks) {
            installHooks(repo, selfProgram(), { trailers });
            writeChoices({ ...readChoices(), git_hooks: [...new Set([...(readChoices().git_hooks ?? []), repo.root])] });
        } else if (repo && !repo.shared && hooksThere.length) {
            removeHooks(repo);
            writeChoices({ ...readChoices(), git_hooks: (readChoices().git_hooks ?? []).filter((r) => r !== repo.root) });
        }

        console.log('');
        for (const agent of done) console.log(`${agent.name}: ${PLUGIN_ID} ${version} is installed. ${agent.id === 'codex' ? 'Start a new Codex session' : 'Restart Claude Code'} to load it.`);
        for (const s of state.filter((x) => !x.agent.cli)) console.log(manualSteps(s.agent));
        if (mode) {
            const which = { team: 'only those in repositories of teams that ask for it', push: 'only those whose commits you push, from repositories with the git hooks', all: 'every session' }[mode];
            console.log(`Auto mode is ${auto}: sessions go to ${site} by themselves (${which}). Nothing is published by it; coders-talk enable --auto=off stops it.`);
            if (mode !== 'push' && done.some((a) => a.id === 'codex')) console.log('Codex runs the plugin\'s hooks only once you trust them: type /hooks in Codex and trust the three Coders Talk hooks.');
            if (mode === 'push' && !(repo && gitHooks && !repo.shared)) console.log('Push mode sends from repositories with the Coders Talk git hooks: run coders-talk enable --git-hooks in each of them.');
        }
        if (repo && !repo.shared && gitHooks) console.log(`Git hooks are in ${repo.dir}. ${trailers ? `Commits made with a session get an ${TRAILER} trailer; a` : 'A'} push looks for the sessions behind it.`);
        if (repo && repo.shared && gitHooks) console.log(`Add these lines to the hooks in ${repo.dir}, right after the first line of each:\n\n${manualHookLines(selfProgram(), { trailers })}`);
        if (!savedUsername(site)) console.log(`Not signed in to ${site} yet: run coders-talk login.`);
    } finally {
        prompt?.close();
    }
}

/** After `coders-talk update`: the plugin laid out again by the new file, and updated where it is installed. Quiet. */
export function refresh({ site, version }) {
    // The git hooks call the file by its path, which may be another one now.
    for (const root of readChoices().git_hooks ?? []) {
        const repo = hooksOf(root);
        const there = repo && !repo.shared ? installedHooks(repo) : [];
        if (there.length) installHooks(repo, selfProgram(), { trailers: there.includes('prepare-commit-msg') });
    }
    if (!existsSync(pluginDir())) return;
    layOut({ site, version, mcp: readChoices().mcp ?? {} });
    for (const agent of detectAgents().filter((a) => a.cli)) {
        const ours = installedPlugins(agent).find((p) => p.marketplace === MARKETPLACE);
        if (ours) installPlugin(agent, ours, { quiet: true });
    }
}

export async function disable({ interactive, flags }) {
    if (!interactive && !flags.yes) throw new Failure('coders-talk disable asks before it changes anything: run it in a terminal, or add --yes.');
    const agents = chosenAgents(flags.agents).filter((a) => a.cli);
    const state = agents.map((agent) => ({ agent, ours: installedPlugins(agent).find((p) => p.marketplace === MARKETPLACE) }));
    // Every repository enable put git hooks in, and this one.
    const repos = [...new Set([...(readChoices().git_hooks ?? []), hooksOf(process.cwd())?.root].filter(Boolean))]
        .map((root) => hooksOf(root))
        .filter((repo) => repo && !repo.shared && installedHooks(repo).length);
    const plan = [
        ...state.filter((s) => s.ours).map((s) => `${s.agent.name}: uninstall ${PLUGIN_ID} and its marketplace`),
        ...repos.map((repo) => `Git hooks: take ours out of ${repo.dir}`),
        ...(existsSync(pluginDir()) ? [`Delete ${pluginDir()}`] : []),
    ];
    if (!plan.length) return console.log(`${PLUGIN_ID} is not installed here; nothing to take off.`);

    console.log(`This will:\n${plan.map((p) => `  - ${p}`).join('\n')}`);
    if (!flags.yes) {
        const prompt = createInterface({ input: process.stdin, output: process.stdout });
        const answer = (await prompt.question('Go ahead? [Y/n] ')).trim().toLowerCase();
        prompt.close();
        if (answer && !answer.startsWith('y')) return console.log('Nothing was changed.');
    }

    for (const { agent, ours } of state) {
        if (ours) step(agent, agent.id === 'codex' ? ['plugin', 'remove', PLUGIN_ID] : ['plugin', 'uninstall', PLUGIN_ID]);
        // Harmless when it is not there.
        runCli(agent.cli, ['plugin', 'marketplace', 'remove', MARKETPLACE]);
    }
    for (const repo of repos) removeHooks(repo);
    rmSync(pluginDir(), { recursive: true, force: true });
    rmSync(choicesFile(), { force: true });
    console.log(`Done: the agents no longer run Coders Talk. The sign-in and settings stay in ${home()}; the coders-talk file stays too (${selfProgram()[0]}). To remove it, delete that file and the "Coders Talk CLI" line from your shell's rc file (on Windows, the folder from your user PATH).`);
}

export function status({ site, version }) {
    const lines = [`coders-talk ${version}: ${BINARY_VERSION ? selfProgram()[0] : `${selfProgram().join(' ')} (the scripts, under Node)`}`];
    const user = savedUsername(site);
    lines.push(`Site:         ${site}, ${user ? `signed in as @${user}` : 'not signed in (coders-talk login)'}`);
    for (const agent of detectAgents()) {
        if (!agent.present) {
            lines.push(`${agent.name.padEnd(13)} not found`);
            continue;
        }
        const plugins = installedPlugins(agent);
        const ours = plugins.find((p) => p.marketplace === MARKETPLACE);
        const notes = [];
        if (!agent.cli) notes.push('its command is not in PATH, so the plugins cannot be listed');
        else if (!plugins.length) notes.push('no Coders Talk plugin (coders-talk enable)');
        for (const p of plugins) notes.push(`${p.id} ${p.version ?? ''}`.trim() + (p === ours && p.version && p.version !== version ? ` (older than this file: coders-talk enable)` : ''));
        if (ours && plugins.length > 1) notes.push('two Coders Talk plugins: their hooks run twice (coders-talk enable replaces the other)');
        const servers = manualMcpServers(agent, site);
        if (servers.length) notes.push(`MCP server added by hand: ${servers.map(describeServer).join(', ')}`);
        notes.push(`auto mode ${autoName(autoMode(site, agent.id))}`);
        lines.push(`${agent.name.padEnd(13)} ${notes.join('; ')}`);
    }
    const repo = hooksOf(process.cwd());
    if (repo) {
        const there = repo.shared ? [] : installedHooks(repo);
        const said = repo.shared ? `core.hooksPath ${repo.dir}, not ours (coders-talk enable --git-hooks prints the lines to add)` : there.length ? there.join(', ') : 'none (coders-talk enable --git-hooks)';
        lines.push(`Git hooks:    ${repo.root}: ${said}`);
    }
    console.log(lines.join('\n'));
}

function chosenAgents(names) {
    const all = detectAgents();
    if (!names?.length) return all;
    const unknown = names.filter((n) => !all.some((a) => a.id === n));
    if (unknown.length) throw new Failure(`--agent takes claude-code or codex, not ${unknown.join(', ')}.`);

    return all.filter((a) => names.includes(a.id));
}

function layOut({ site, version, mcp }) {
    const files = pluginFiles(pluginSources(), { program: selfProgram(), version, site, mcp });
    rmSync(pluginDir(), { recursive: true, force: true });
    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(pluginDir(), path)), { recursive: true });
        writeFileSync(join(pluginDir(), path), text);
    }
}

/** From the local marketplace: added once, then installed, or updated to the version laid out. */
function installPlugin(agent, ours, { quiet = false } = {}) {
    const run = quiet ? (a) => runCli(agent.cli, a) : (a) => step(agent, a);
    if (agent.id === 'codex') {
        // A local marketplace is read where it is; adding the plugin again installs the version it has now.
        const added = runCli(agent.cli, ['plugin', 'marketplace', 'list', '--json']);
        if (!added.out.includes(MARKETPLACE)) run(['plugin', 'marketplace', 'add', pluginDir()]);
        return run(['plugin', 'add', PLUGIN_ID]);
    }
    const added = runCli(agent.cli, ['plugin', 'marketplace', 'list', '--json']);
    if (!added.out.includes(`"${MARKETPLACE}"`)) run(['plugin', 'marketplace', 'add', pluginDir()]);
    run(ours ? ['plugin', 'update', PLUGIN_ID] : ['plugin', 'install', PLUGIN_ID]);
}

/** The agent's command, stopping at the first that fails with what it said. */
function step(agent, args) {
    return check(agent, runCli(agent.cli, args), args.join(' '));
}

function check(agent, result, what) {
    if (!result.ok) throw new Failure(`${agent.name} could not ${what}:\n${result.out}`);

    return result;
}

function manualSteps(agent) {
    return agent.id === 'codex'
        ? `Codex: its command is not in PATH. In a terminal where it is: codex plugin marketplace add "${pluginDir()}", then codex plugin add ${PLUGIN_ID}.`
        : `Claude Code: its command is not in PATH. Inside Claude Code: /plugin marketplace add ${pluginDir()}, then /plugin install ${PLUGIN_ID}.`;
}

function describeServer(s) {
    return s.scope === 'local' ? `${s.name} (in ${s.project})` : s.name;
}

function readChoices() {
    try {
        return JSON.parse(readFileSync(choicesFile(), 'utf8'));
    } catch {
        return {};
    }
}

function writeChoices(choices) {
    mkdirSync(home(), { recursive: true });
    writeFileSync(choicesFile(), JSON.stringify(choices, null, 2));
}
