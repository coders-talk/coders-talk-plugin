/**
 * What the agent took from the Coders Talk library in a session (plan, stage 18): its calls to the library's tools and
 * the Builds their answers linked to. The send step tells the site which Builds this session was built on, and the Stop
 * hook suggests sharing a session that used some.
 *
 * Read from the session's own lines, never from the network. A call is a tool call named after one of the library's
 * tools, whatever the server is called in this agent: `mcp__plugin_coders-talk_coders-talk__…` for the plugin's own
 * server in Claude Code, `mcp__coders-talk__…` when the person added it by hand, a claude.ai connector, or a Codex
 * `function_call` with the server in its `namespace`. The Codex desktop app may call tools from a script (`exec`): a
 * script that names one of the tools counts. A shell command or a patch that only mentions a tool's name does not. A Build is a `/b/<slug>?ref=agent` link in such a call's answer: only the
 * library's answers carry `?ref=agent`, so a page or a file that mentions the site elsewhere in the session never counts.
 */
export const LIBRARY_TOOLS = ['search_coding_agent_sessions', 'get_coding_agent_session', 'find_coding_agent_failures'];
/** The site takes at most this many; the first ones the agent got are kept. */
export const MAX_SLUGS = 20;

const NAMED = new RegExp(`(?:^|__)(?:${LIBRARY_TOOLS.join('|')})$`);
// On its own, or after a server prefix (`tools.mcp__coders_talk__get_coding_agent_session(…)`).
const MENTIONED = new RegExp(`(?:^|[^A-Za-z0-9_]|__)(?:${LIBRARY_TOOLS.join('|')})(?![A-Za-z0-9_])`);
const BUILD_LINK = /\/b\/([a-z0-9]+(?:-[a-z0-9]+)*)\?ref=agent/g;
// Anything worth parsing mentions one of these; the rest of a long session is skipped without JSON.parse.
const MARKS = [...LIBRARY_TOOLS, 'ref=agent'];

export class LibraryWatch {
    /** @param {{calls?: number, slugs?: string[], pending?: string[]}} state  what an earlier read of the same file found */
    constructor(state = {}) {
        this.calls = Number.isInteger(state.calls) ? state.calls : 0;
        this.slugs = new Set(Array.isArray(state.slugs) ? state.slugs : []);
        // Calls whose answer has not been read yet; a Codex call may also show up twice (function_call and mcp_tool_call_end).
        this.pending = new Set(Array.isArray(state.pending) ? state.pending : []);
        this.seen = new Set(this.pending);
    }

    /** Cheap test on the raw line, so a caller can skip JSON.parse for the lines that cannot matter here. */
    static worthParsing(line) {
        return MARKS.some((mark) => line.includes(mark));
    }

    /** One parsed session line, before slimming. */
    add(d) {
        if (!d || typeof d !== 'object') return;

        // Claude Code: tool_use blocks in the agent's messages, tool_result blocks in the next "user" line.
        const blocks = Array.isArray(d.message?.content) ? d.message.content : [];
        for (const b of blocks) {
            if (b?.type === 'tool_use' && typeof b.name === 'string' && NAMED.test(b.name)) this.call(b.id);
            else if (b?.type === 'tool_result' && this.pending.has(b.tool_use_id)) this.answer(b.tool_use_id, b.content, b.is_error === true);
        }

        const p = d.payload;
        if (!p || typeof p !== 'object') return;
        // Codex: a function call to an MCP tool (the server is the namespace), or a script that calls one.
        if (d.type === 'response_item') {
            if (p.type === 'function_call' && typeof p.name === 'string' && (NAMED.test(p.name) || NAMED.test(`${p.namespace ?? ''}${p.name}`))) this.call(p.call_id);
            // Only a script: a patch (apply_patch) that edits a file naming the tools is not a call.
            else if (p.type === 'custom_tool_call' && p.name === 'exec' && typeof p.input === 'string' && MENTIONED.test(p.input)) this.call(p.call_id);
            else if ((p.type === 'function_call_output' || p.type === 'custom_tool_call_output') && this.pending.has(p.call_id)) this.answer(p.call_id, p.output, false);
        }
        // Older Codex rollouts record the MCP call as one event with its result.
        if (d.type === 'event_msg' && p.type === 'mcp_tool_call_end' && typeof p.invocation?.tool === 'string' && NAMED.test(p.invocation.tool)) {
            this.call(p.call_id);
            this.answer(p.call_id, p.result, p.result?.Err !== undefined);
        }
    }

    call(id) {
        if (typeof id !== 'string' || this.seen.has(id)) return;
        this.seen.add(id);
        this.pending.add(id);
        this.calls++;
    }

    answer(id, content, failed) {
        this.pending.delete(id);
        if (failed) return;
        const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
        for (const [, slug] of text.matchAll(BUILD_LINK)) {
            if (this.slugs.size >= MAX_SLUGS) break;
            this.slugs.add(slug);
        }
    }

    /** For the site: null when the agent never called the library in this session. */
    result() {
        return this.calls ? { calls: this.calls, slugs: [...this.slugs] } : null;
    }

    /** To go on from here with the next part of the same file. */
    state() {
        return { calls: this.calls, slugs: [...this.slugs], pending: [...this.pending] };
    }
}

/** "2 calls; 3 Builds used: laravel-horizon-x1, …" for the preview. */
export function describeLibrary(library) {
    const calls = `${library.calls} call${library.calls === 1 ? '' : 's'}`;
    if (!library.slugs.length) return `${calls}, no Builds in the answers`;
    const names = library.slugs.slice(0, 3).join(', ') + (library.slugs.length > 3 ? ', …' : '');

    return `${calls}; ${library.slugs.length} Build${library.slugs.length === 1 ? '' : 's'} used (${names}): their slugs are sent, so the Builds link up on the site`;
}
