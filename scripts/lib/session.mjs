/**
 * Finding and reading the current Claude Code or Codex session. Pure helpers, no network: coders-talk.mjs does the talking.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

/** Claude Code session ids and Codex thread ids are UUIDs; anything else never becomes part of a path. */
export const SESSION_ID = /^[A-Za-z0-9-]{8,100}$/;

/** The invocation of this plugin inside the transcript; it and everything after it is not part of the session. */
const OWN_COMMAND = /<command-name>\/(?:coders-talk:)?(?:build|share)<\/command-name>/;
/** Codex puts the body of a skill it runs into a user message: "<skill>\n<name>coders-talk:build</name>…". */
const OWN_SKILL = /<skill>(?:\\n|\s)*<name>(?:coders-talk:)?(?:build|share)<\/name>/;

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
 * Drops the plugin's own run: the last /coders-talk:build (or :share) prompt and everything after it.
 * In Codex that is the message carrying the skill, and the person's messages right before it (what they typed
 * to call it, the environment note Codex adds at the start of a turn).
 */
export function cutOwnCommand(text) {
    const lines = text.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
        if (OWN_COMMAND.test(lines[i])) {
            return { text: lines.slice(0, i).join('\n'), cut: true };
        }
        if (OWN_SKILL.test(lines[i])) {
            let start = i;
            while (start > 0 && isCodexUserLine(lines[start - 1])) start--;

            return { text: lines.slice(0, start).join('\n'), cut: true };
        }
    }

    return { text, cut: false };
}

function isCodexUserLine(line) {
    try {
        const d = JSON.parse(line);

        return d?.type === 'response_item' && d.payload?.type === 'message' && d.payload.role === 'user';
    } catch {
        return false;
    }
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

/** Typed by the person in Codex: some text that is not one of the blocks Codex adds (<environment_context>, <skill>, <image …>). */
function isCodexPrompt(content) {
    return Array.isArray(content) && content.some((b) => typeof b?.text === 'string' && b.text.trim() !== '' && b.text.trim() !== '[image]' && !b.text.trimStart().startsWith('<'));
}

/** What Claude Code itself writes as a "user" message: slash commands, their output, background task notices. */
const WRAPPER = /^<(?:command-(?:name|message|args)|local-command-[a-z]+|task-notification|system-reminder|bash-(?:stdout|stderr))>/;

/** Typed by the person: not a tool result, not a wrapper Claude Code added, not an interruption notice. */
function isPrompt(content) {
    const text = typeof content === 'string' ? content : Array.isArray(content) && !content.some((b) => b?.type === 'tool_result') ? content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '';
    const trimmed = text.trim();

    return trimmed !== '' && !WRAPPER.test(trimmed) && !trimmed.startsWith('[Request interrupted');
}

/**
 * Which session this one was forked from, learned from its lines as they are read: {session_id, at} or null.
 * Claude Code copies the parent's lines into the fork with the parent's sessionId, and the fork's own lines carry its
 * own; the last foreign id before the first own line is the parent (a fork of a fork copies the grandparent's lines
 * too), and the last of its timestamps is where the fork left it. Codex names the parent in the first session_meta:
 * forked_from_id, or a history_base in another thread. $at is when the fork happened: lines up to it are the parent's.
 */
export class ForkWatch {
    constructor(id) {
        this.id = id;
        this.parent = null;
        this.at = null;
        this.done = false;
    }

    /** True when the line is one a Claude Code fork inherited: its tokens were spent, and counted, in the original. */
    add(d) {
        if (this.done || !d || typeof d !== 'object') return false;

        if (d.type === 'session_meta') {
            this.done = true;
            const p = d.payload ?? {};
            const own = typeof p.id === 'string' ? p.id : this.id;
            const parent = [p.forked_from_id, p.history_base?.thread_id].find((t) => typeof t === 'string' && t !== own && SESSION_ID.test(t));
            if (parent) {
                this.parent = parent;
                this.at = d.timestamp ?? p.timestamp ?? null;
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
