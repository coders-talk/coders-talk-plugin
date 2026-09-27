/**
 * Finding and reading the current Claude Code or Codex session. Pure helpers, no network: coders-talk.mjs does the talking.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

/** Claude Code session ids and Codex thread ids are UUIDs; anything else never becomes part of a path. */
export const SESSION_ID = /^[A-Za-z0-9-]{8,100}$/;

/**
 * The plugin's own commands inside the transcript: /coders-talk:build, :auto, :lookup… are not part of the work. An
 * older plugin went by /build and /share, without the prefix.
 */
const OWN_COMMAND = /<command-name>\/(coders-talk:[a-z-]+|build|share)<\/command-name>/;
/** Codex puts the body of a skill it runs into a user message: "<skill>\n<name>coders-talk:build</name>…". */
const OWN_SKILL = /<skill>\s*<name>(coders-talk:[a-z-]+|build|share)<\/name>/;
/** What the person types in Codex to call one: "$coders-talk:build". */
const OWN_MENTION = /(?:^|\s)\$(coders-talk:[a-z-]+)/;
/** The command that sends a session: the last run of it, and everything after, is the run in progress. */
const OWN_SEND = /^(?:coders-talk:)?(?:build|share)$/;
/** A tool call that runs the plugin's script: the preview, discard, send… of a command run. */
const OWN_SCRIPT = /coders-talk\.mjs/;

export function configDir(env = process.env) {
    return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

/**
 * Transcripts live at <config>/projects/<cwd with every non-alphanumeric character as "-">/<session id>.jsonl.
 * Looking the id up in every project folder avoids re-implementing that encoding.
 */
export function findTranscript(sessionId, dir = configDir()) {
    if (!SESSION_ID.test(sessionId ?? '')) return null;
    const projects = join(dir, 'projects');
    if (!existsSync(projects)) return null;

    const found = readdirSync(projects, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(projects, entry.name, `${sessionId}.jsonl`))
        .filter((path) => existsSync(path))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

    return found[0] ?? null;
}

export function codexHome(env = process.env) {
    return env.CODEX_HOME || join(homedir(), '.codex');
}

/**
 * Codex rollouts live at <CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<time>-<thread id>.jsonl, or
 * …-<thread id>_<rollout id>.jsonl after a revert; archived ones in archived_sessions. The newest one wins.
 */
export function findRollout(threadId, dir = codexHome()) {
    if (!SESSION_ID.test(threadId ?? '')) return null;
    const name = new RegExp(`^rollout-.+-${threadId}(?:_[A-Za-z0-9-]+)?\\.jsonl$`);
    const found = [];
    const walk = (folder, depth) => {
        let entries;
        try {
            entries = readdirSync(folder, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const path = join(folder, entry.name);
            if (entry.isDirectory() && depth > 0) walk(path, depth - 1);
            else if (entry.isFile() && name.test(entry.name)) found.push(path);
        }
    };
    walk(join(dir, 'sessions'), 3);
    walk(join(dir, 'archived_sessions'), 0);

    return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}

/**
 * Drops the plugin's own runs from the session: every /coders-talk:* command (in Codex the message carrying the
 * skill, and the person's messages right before it: what they typed to call it, the environment note Codex adds at the
 * start of a turn), what the agent did for it, and the replies it asked for: a run goes on past the person's next
 * prompt while the agent answers it with the plugin's script ("No, do not send it" and the discard it runs).
 * With $tail, the run in progress goes too: the last /coders-talk:build (or :share) and everything after it.
 */
export function cutOwnCommand(text, { tail = true } = {}) {
    const lines = text.split(/\r?\n/);
    const kinds = lines.map(kindOf);
    const drop = new Array(lines.length).fill(false);
    const opens = (k) => Boolean(k.own || k.prompt);
    // The next line that opens a turn: a prompt, or a plugin command.
    const next = (at) => {
        let j = at + 1;
        while (j < lines.length && !opens(kinds[j])) j++;

        return j;
    };
    let cut = false;

    const last = tail ? kinds.findLastIndex((k) => k.own && OWN_SEND.test(k.own)) : -1;
    for (let i = 0; i < lines.length; i++) {
        if (!kinds[i].own) continue;
        let from = i;
        while (from > 0 && kinds[from - 1].codexUser && !opens(kinds[from - 1])) from--;

        let to = lines.length;
        if (i !== last) {
            // The command's own turn, then each reply the agent answered by running the script again.
            to = next(i);
            while (to < lines.length && !kinds[to].own) {
                const after = next(to);
                if (!kinds.slice(to, after).some((k) => k.script)) break;
                to = after;
            }
            // An older plugin's /build is ours only when it ran the script; the person's own /build is work.
            if (!kinds[i].own.startsWith('coders-talk:') && !kinds.slice(i, to).some((k) => k.script)) continue;
            // The environment note in front of the next Codex prompt belongs to that prompt.
            while (to < lines.length && to > i + 1 && kinds[to - 1].codexUser && !opens(kinds[to - 1])) to--;
        }
        drop.fill(true, from, to);
        cut = true;
        if (i === last) break;
        i = to - 1;
    }

    return cut ? { text: lines.filter((_, i) => !drop[i]).join('\n'), cut } : { text, cut };
}

/** What a transcript line is to cutOwnCommand: a plugin command (own), a prompt, a call of the plugin's script. */
function kindOf(line) {
    let d;
    try {
        d = JSON.parse(line);
    } catch {
        return {};
    }
    if (!d || typeof d !== 'object') return {};

    const content = d.message?.content;
    if (d.type === 'user' && !d.isMeta) {
        const own = textOf(content).match(OWN_COMMAND)?.[1];

        return own ? { own } : { prompt: isPrompt(content) };
    }
    if (d.type === 'assistant' && Array.isArray(content)) {
        return { script: content.some((b) => b?.type === 'tool_use' && OWN_SCRIPT.test(JSON.stringify(b.input ?? ''))) };
    }

    const p = d.type === 'response_item' ? d.payload : null;
    if (p?.type === 'message' && p.role === 'user') {
        const text = textOf(p.content);
        const own = text.match(OWN_SKILL)?.[1] ?? text.match(OWN_MENTION)?.[1];

        return { codexUser: true, ...(own ? { own } : { prompt: isCodexPrompt(p.content) }) };
    }
    if (CODEX_CALLS.has(p?.type)) return { script: OWN_SCRIPT.test(JSON.stringify(p)) };

    return {};
}

function textOf(content) {
    if (typeof content === 'string') return content;

    return Array.isArray(content) ? content.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('\n') : '';
}

/**
 * What the person is about to send, in numbers they can check: project, prompts, tool calls, time span.
 * $cwd is where the session ran when the lines no longer say it (slimming drops it).
 */
export function summarize(text, cwd = null) {
    let prompts = 0;
    let toolCalls = 0;
    let first = null;
    let last = null;

    for (const line of text.split(/\r?\n/)) {
        let d;
        try {
            d = JSON.parse(line);
        } catch {
            continue;
        }
        if (!d || typeof d !== 'object') continue;

        if (!cwd && typeof d.cwd === 'string' && d.cwd) cwd = d.cwd;
        if (!cwd && d.type === 'session_meta' && typeof d.payload?.cwd === 'string') cwd = d.payload.cwd;
        const at = Date.parse(d.timestamp ?? '');
        if (!Number.isNaN(at)) {
            first ??= at;
            last = at;
        }

        const content = d.message?.content;
        if (d.type === 'user' && !d.isMeta && isPrompt(content)) prompts++;
        if (d.type === 'assistant' && Array.isArray(content)) toolCalls += content.filter((b) => b?.type === 'tool_use').length;

        // Codex: {type: 'response_item', payload: {type: 'message' | 'function_call' | …}}
        const p = d.type === 'response_item' ? d.payload : null;
        if (p?.type === 'message' && p.role === 'user' && isCodexPrompt(p.content)) prompts++;
        if (CODEX_CALLS.has(p?.type)) toolCalls++;
    }

    return {
        cwd,
        project: cwd ? basename(cwd.replace(/[\\/]+$/, '')) : null,
        prompts,
        toolCalls,
        startedAt: first,
        durationSec: first !== null && last !== null ? Math.round((last - first) / 1000) : null,
    };
}

const CODEX_CALLS = new Set(['function_call', 'custom_tool_call', 'local_shell_call']);

/**
 * Typed by the person in Codex: some text that is not one of the blocks Codex adds (<environment_context>, <skill>,
 * <image …>). "$ct-horizon migrate the queues" is a prompt; "$coders-talk:build" calls the plugin and is not.
 */
export function isCodexPrompt(content) {
    return Array.isArray(content) && content.some((b) => {
        if (typeof b?.text !== 'string') return false;
        const text = b.text.replace(/^\s*(?:<skill>[\s\S]*?<\/skill>\s*)+/, '').trim();

        return text !== '' && text !== '[image]' && !text.startsWith('<') && !text.startsWith('$coders-talk:');
    });
}

/** What Claude Code itself writes as a "user" message: slash commands, their output, background task notices. */
const WRAPPER = /^<(?:command-(?:name|message|args)|local-command-[a-z]+|task-notification|system-reminder|bash-(?:stdout|stderr))>/;

/** The same blocks whole, as Claude Code also puts them in front of a prompt (the desktop app: a <system-reminder> first). */
const WRAPPER_BLOCK = /<(command-(?:name|message|args)|local-command-[a-z]+|task-notification|system-reminder|bash-(?:stdout|stderr))(?:\s[^>]*)?>[\s\S]*?<\/\1>/g;

/**
 * What the person typed, without the wrapper blocks Claude Code added around it, or null when the message is not a
 * prompt: a tool result, wrappers only, an interruption notice.
 */
export function promptText(content) {
    const text = typeof content === 'string' ? content : Array.isArray(content) && !content.some((b) => b?.type === 'tool_result') ? content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '';
    const command = commandPrompt(text);
    if (command) return command;
    const typed = text.replace(WRAPPER_BLOCK, '').trim();

    return typed !== '' && !WRAPPER.test(typed) && !typed.startsWith('[Request interrupted') ? typed : null;
}

/** Claude Code's own commands run the session, not the agent (the site's TurnParser::SESSION_COMMANDS): /model opus is not a prompt. */
const SESSION_COMMANDS = new Set([
    'add-dir', 'agents', 'bashes', 'clear', 'compact', 'config', 'context', 'copy', 'cost', 'doctor', 'effort', 'exit', 'export',
    'fast', 'feedback', 'help', 'hooks', 'ide', 'login', 'logout', 'mcp', 'memory', 'model', 'output-style', 'permissions',
    'plugin', 'privacy-settings', 'release-notes', 'resume', 'rewind', 'skills', 'status', 'statusline', 'tasks', 'terminal-setup',
    'theme', 'todos', 'upgrade', 'usage', 'vim',
]);

/**
 * A skill or command with a task after it, as the person typed it: "/ct-horizon-queues migrate the queues". Null for
 * one without a task, for Claude Code's own commands and for the plugin's (/coders-talk:*).
 */
function commandPrompt(text) {
    const name = text.match(/<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/)?.[1];
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
    if (!name || !args || name.startsWith('coders-talk:') || SESSION_COMMANDS.has(name)) return null;

    return `/${name} ${args}`;
}

/** Typed by the person: not a tool result, not a wrapper Claude Code added, not an interruption notice. */
export function isPrompt(content) {
    return promptText(content) !== null;
}

/**
 * Which session this one was forked from, learned from its lines as they are read: {session_id, at} or null.
 * Claude Code copies the parent's lines into the fork with the parent's sessionId, and the fork's own lines carry its
 * own; the last foreign id before the first own line is the parent (a fork of a fork copies the grandparent's lines
 * too), and the last of its timestamps is where the fork left it. Codex names the parent in the first session_meta:
 * forked_from_id. $at is when the fork happened: lines up to it are the parent's.
 *
 * A Codex thread started on the history of another thread (a history_base in another thread) continues that one
 * rather than forking it (grouping plan, 24.1): continuation() says so. One in its own thread is a later rollout of it.
 */
export class ForkWatch {
    constructor(id) {
        this.id = id;
        this.parent = null;
        this.at = null;
        this.done = false;
        this.continues = null;
    }

    /** True when the line is one a Claude Code fork inherited: its tokens were spent, and counted, in the original. */
    add(d) {
        if (this.done || !d || typeof d !== 'object') return false;

        if (d.type === 'session_meta') {
            this.done = true;
            const p = d.payload ?? {};
            const own = typeof p.id === 'string' ? p.id : this.id;
            const other = (t) => typeof t === 'string' && t !== own && SESSION_ID.test(t);
            if (other(p.forked_from_id)) {
                this.parent = p.forked_from_id;
                this.at = d.timestamp ?? p.timestamp ?? null;
            } else if (other(p.history_base?.thread_id)) {
                this.continues = { session_id: p.history_base.thread_id, at: null };
            }
            return false;
        }

        if (typeof d.sessionId !== 'string') return false;
        if (d.sessionId === this.id) {
            this.done = true;
            return false;
        }
        if (!SESSION_ID.test(d.sessionId)) return false;
        if (d.sessionId !== this.parent) this.at = null;
        this.parent = d.sessionId;
        const at = Date.parse(d.timestamp ?? '');
        if (!Number.isNaN(at) && at > (Date.parse(this.at ?? '') || 0)) this.at = new Date(at).toISOString();

        return true;
    }

    result() {
        return this.parent ? { session_id: this.parent, at: this.at } : null;
    }

    /** The Codex thread this one continues: {session_id, at: null}; its rollout holds none of that thread's lines. */
    continuation() {
        return this.continues;
    }
}

/**
 * The session's title as the Claude app shows it (grouping plan, 24.2): the last custom-title or agent-name line, without
 * the " (fork)" a fork's title gets. Slimming drops these lines; only this text goes.
 */
export class TitleWatch {
    constructor() {
        this.title = null;
    }

    add(d) {
        const value = d?.type === 'custom-title' ? d.customTitle : d?.type === 'agent-name' ? d.agentName : null;
        if (typeof value !== 'string') return;
        const title = value.replace(/\s*\(fork\)\s*$/i, '').replace(/\s+/g, ' ').trim();
        if (title) this.title = title;
    }

    result() {
        return this.title;
    }
}

export function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;

    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(seconds) {
    if (seconds === null) return 'unknown';
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);

    return h ? `${h} h ${m} min` : `${m} min`;
}
