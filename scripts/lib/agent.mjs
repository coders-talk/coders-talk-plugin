/**
 * The agents this plugin serves, and the few things about them every module needs the same way: the id the site knows
 * (the `agent` of an import), the name a person reads, how they type one of the plugin's commands there, and what a
 * background run passes on so it serves the same agent. What is particular to an agent (where its sessions are, how
 * they are read, how the plugin is installed) lives in its own module: session.mjs (Claude Code, Codex), pi.mjs,
 * cursor.mjs, and the installers in enable.mjs.
 *
 * Claude Code is the default: a command without --agent is one of Claude Code's, as it was before the others came.
 */

export const AGENTS = {
    'claude-code': { id: 'claude-code', name: 'Claude Code', client: 'claude-plugin' },
    codex: { id: 'codex', name: 'Codex', client: 'codex-plugin' },
    cursor: { id: 'cursor', name: 'Cursor', client: 'cursor-plugin' },
    pi: { id: 'pi', name: 'Pi', client: 'pi-plugin' },
};

export const AGENT_IDS = Object.keys(AGENTS);

/** claude, claude-code, codex, cursor or pi as an agent id; null for anything else. */
export function agentId(value) {
    const v = String(value ?? '').trim().toLowerCase();

    return v === 'claude' ? 'claude-code' : AGENT_IDS.includes(v) ? v : null;
}

/**
 * How the person runs one of the plugin's commands in this agent: a slash command, a $ mention in Codex, and in Cursor
 * a slash with a hyphen, since a skill's name there cannot hold a colon.
 */
export function commandIn(agent, name) {
    if (agent === 'codex') return `$coders-talk:${name}`;

    return agent === 'cursor' ? `/coders-talk-${name}` : `/coders-talk:${name}`;
}

/** What a background run of this program passes on to serve the same agent (Claude Code, the default, passes nothing). */
export const agentArgs = (agent) => (agent === 'claude-code' || !agent ? [] : [`--agent=${agent}`]);

/** Whether the agent has plugin options of its own that the site address may come from: only Claude Code saves them. */
export const hasPluginOptions = (agent) => agent === 'claude-code';
