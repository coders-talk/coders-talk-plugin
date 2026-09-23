// Generated from coders.talk resources/js/lib/slimSession.ts by `npm run plugin:sync`. Do not edit here.

/**
 * Claude Code and Codex sessions are mostly weight nobody reads: screenshots as base64, whole files
 * returned by tools, snapshots and bookkeeping lines. The median session is 1.4 MB, the big ones
 * run to 60 MB. We keep only what the server's TurnParser reads, cut images and long tool output,
 * and send that, so a 60 MB session uploads as about 1 MB. Anything that is not JSON lines is
 * returned unchanged.
 */
const DROP_TYPES = new Set([
    'file-history-snapshot',
    'file-history-delta',
    'attachment',
    'queue-operation',
    'last-prompt',
    'custom-title',
    'agent-name',
    'atis-latch',
    'cost-state',
    'mode',
    'summary',
    'system',
    'progress',
]);
const TOOL_LINES = 60;
const TOOL_CHARS = 8000;
function cut(value, lines = TOOL_LINES) {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    const all = text.split('\n');
    const kept = all.length > lines ? `${all.slice(0, lines).join('\n')}\n… ${all.length - lines} more lines` : text;
    return kept.length > TOOL_CHARS ? `${kept.slice(0, TOOL_CHARS)}…` : kept;
}
function blockText(value) {
    if (!Array.isArray(value))
        return typeof value === 'string' ? value : JSON.stringify(value ?? '');
    return value
        .map((part) => (part?.type === 'image' || part?.type === 'input_image' ? '[image]' : typeof part?.text === 'string' ? part.text : ''))
        .join('\n');
}
/**
 * Codex command output: JSON with metadata.exit_code, or text starting "Exit code: N". The desktop app runs
 * tools from a script: "Script failed" counts as 1, otherwise the first non-zero "exit_code" its tools printed.
 */
function exitCode(output) {
    if (Array.isArray(output))
        output = blockText(output);
    if (typeof output !== 'string')
        return null;
    if (output.trimStart().startsWith('{')) {
        try {
            const code = JSON.parse(output).metadata?.exit_code;
            if (typeof code === 'number')
                return code;
        }
        catch {
            // not JSON after all
        }
    }
    const match = output.match(/^Exit code: (-?\d+)/m);
    if (match)
        return Number(match[1]);
    if (/^Script failed$/m.test(output))
        return 1;
    const codes = [...output.matchAll(/"exit_code":\s*(-?\d+)/g)].map((m) => Number(m[1]));
    return codes.length ? (codes.find((c) => c !== 0) ?? 0) : null;
}
/** Codex keeps the conversation in response_item lines; of the rest only the person stopping a turn matters. */
function slimCodexLine(type, timestamp, payload) {
    if (type === 'event_msg') {
        return payload.type === 'turn_aborted' ? { type, timestamp, payload: { type: 'turn_aborted', reason: payload.reason } } : null;
    }
    // session_meta, turn_context, compacted, world_state, token_usage_record: bookkeeping, some of it huge.
    if (type !== 'response_item')
        return null;
    const p = { ...payload };
    delete p.internal_chat_message_metadata_passthrough;
    if (p.type === 'reasoning' || p.type === 'compaction')
        return null;
    // Developer messages are the app's instructions to the model, not the conversation.
    if (p.type === 'message' && (p.role === 'developer' || p.role === 'system'))
        return null;
    if (Array.isArray(p.content)) {
        p.content = p.content.map((b) => (b?.type === 'input_image' ? { type: 'input_text', text: '[image]' } : b));
    }
    if ('output' in p) {
        // The exit code sits inside the output, which is about to be cut: keep it next to it.
        const code = exitCode(p.output);
        if (code !== null)
            p.exit_code = code;
        p.output = cut(Array.isArray(p.output) ? blockText(p.output) : p.output);
    }
    if ('arguments' in p)
        p.arguments = cut(p.arguments, 40);
    if ('input' in p)
        p.input = cut(p.input, 40);
    return { type, timestamp, payload: p };
}
function slimBlock(block) {
    if (!block || typeof block !== 'object')
        return block;
    const b = block;
    switch (b.type) {
        case 'image':
            return { type: 'text', text: '[image]' };
        case 'thinking':
        case 'redacted_thinking':
            return null;
        case 'tool_result':
            // is_error marks a failed tool call: the server offers it to the labeller as a possible Fail.
            return { type: 'tool_result', content: cut(blockText(b.content)), ...(b.is_error === true ? { is_error: true } : {}) };
        case 'tool_use':
            return { type: 'tool_use', name: b.name, input: cut(b.input, 40) };
        default:
            return b;
    }
}
/** One session line, slimmed; null when nothing in it is kept. The plugin streams big files through this. */
export function slimLine(d) {
    const type = d.type;
    if (type && DROP_TYPES.has(type))
        return null;
    // Codex rollout: {timestamp, type: 'response_item', payload: {...}}
    if (d.payload && typeof d.payload === 'object' && !Array.isArray(d.payload))
        return slimCodexLine(type, d.timestamp, d.payload);
    // Claude Code: {type, timestamp, message: {role, content}}, plus big copies like toolUseResult we skip.
    // isMeta marks messages Claude Code wrote in the person's name (skill bodies, caveats): the server skips them.
    if (d.message && typeof d.message === 'object') {
        const m = d.message;
        const content = Array.isArray(m.content) ? m.content.map(slimBlock).filter(Boolean) : m.content;
        return { type, timestamp: d.timestamp, ...(d.isMeta === true ? { isMeta: true } : {}), message: { role: m.role, content } };
    }
    return d;
}
/**
 * The slim JSON lines of a session, or null when the text is not JSON lines: then it goes as it is.
 * Also used by the Claude Code plugin (coders-talk-plugin, scripts/lib/slim.mjs via `npm run plugin:sync`).
 */
export function slimJsonl(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    // A single JSON document (a chat array or metadata) goes as it is; the server decides.
    if (lines.length < 2)
        return null;
    const out = [];
    let parsed = 0;
    for (const line of lines) {
        let d;
        try {
            d = JSON.parse(line);
        }
        catch {
            continue;
        }
        parsed++;
        if (!d || typeof d !== 'object' || Array.isArray(d))
            continue;
        const slim = slimLine(d);
        if (slim)
            out.push(JSON.stringify(slim));
    }
    return parsed < lines.length * 0.8 ? null : out.join('\n');
}
export async function slimSession(file) {
    if (!/\.jsonl?$/i.test(file.name))
        return file;
    const slim = slimJsonl(await file.text());
    return slim === null ? file : new File([slim], file.name.replace(/\.json$/i, '.jsonl'), { type: 'application/x-ndjson' });
}
