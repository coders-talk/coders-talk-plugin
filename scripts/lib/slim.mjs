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
/** One file change is shown whole up to here; the counts always cover all of it. */
const CHANGE_LINES = 300;
const CHANGE_CHARS = 20000;
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
/** Files whose content is secret (keys, env files, registry logins) or noise (lock files, builds, vendored code). */
export function withheldReason(path) {
    const lower = path.toLowerCase();
    const name = lower.split('/').pop() ?? '';
    if (/^\.env(\.|$)/.test(name) && !/\.(example|sample|dist|template)$/.test(name))
        return 'sensitive';
    if (/^(\.npmrc|\.netrc|\.pypirc|\.pgpass|auth\.json)$/.test(name) || name.startsWith('credentials') || /^id_(rsa|dsa|ecdsa|ed25519)/.test(name))
        return 'sensitive';
    if (/\.(pem|key|p12|pfx|jks|keystore)$/.test(name))
        return 'sensitive';
    if (/^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|cargo\.lock|poetry\.lock|uv\.lock|pipfile\.lock|gemfile\.lock|go\.sum|bun\.lockb?)$/.test(name))
        return 'generated';
    if (/\.min\.(js|css)$/.test(name) || name.endsWith('.map'))
        return 'generated';
    // Case matters: Pages/Build/Show.vue is source. A build folder counts only at the project's root.
    if (/(^|\/)(vendor|node_modules|dist)\//.test(path) || path.startsWith('build/'))
        return 'generated';
    return null;
}
/** The path inside the session's folder; a file elsewhere keeps only its last two parts, since the rest names the person. */
function changedPath(file, cwd) {
    const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
    const path = norm(file);
    if (cwd) {
        const base = norm(cwd);
        if (base && path.toLowerCase().startsWith(`${base.toLowerCase()}/`))
            return { path: path.slice(base.length + 1) };
    }
    if (!/^([a-z]:)?\//i.test(path))
        return { path: path.replace(/^\.\//, '') };
    return { path: `…/${path.split('/').filter(Boolean).slice(-2).join('/')}`, outside: true };
}
function fileChange(file, op, lines, ctx, from) {
    const where = changedPath(file, ctx.cwd);
    const body = (l) => !l.startsWith('@@');
    const change = {
        path: where.path,
        ...(from ? { from: changedPath(from, ctx.cwd).path } : {}),
        op,
        additions: lines.filter((l) => body(l) && l.startsWith('+')).length,
        deletions: lines.filter((l) => body(l) && l.startsWith('-')).length,
    };
    if (where.outside)
        change.outside = true;
    // Judged by the real path: a key outside the folder is still a key.
    const withheld = withheldReason(file.replace(/\\/g, '/'));
    if (withheld)
        return { ...change, withheld };
    if (lines.length === 0)
        return change;
    const all = lines.join('\n');
    const kept = lines.length > CHANGE_LINES ? lines.slice(0, CHANGE_LINES).join('\n') : all;
    change.diff = kept.length > CHANGE_CHARS ? kept.slice(0, CHANGE_CHARS) : kept;
    if (change.diff.length < all.length)
        change.truncated = true;
    return change;
}
/**
 * A file change seen by the plugin's git snapshots (plan, stage 11.3): paths from the repository's root, the same
 * limits and withheld files as the changes read from the session.
 */
export function gitFileChange(path, op, lines, from) {
    return fileChange(path, op, lines, {}, from);
}
/**
 * What a Claude Code Edit, MultiEdit or Write did, from the toolUseResult on the line of its tool_result. A failed
 * call has no such result, so only changes that were applied come out.
 */
function claudeChange(result, ctx) {
    if (!result || typeof result !== 'object' || Array.isArray(result))
        return null;
    const r = result;
    if (typeof r.filePath !== 'string')
        return null;
    if (r.type === 'create' && typeof r.content === 'string') {
        const lines = r.content.split('\n');
        if (lines[lines.length - 1] === '')
            lines.pop();
        return fileChange(r.filePath, 'add', [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)], ctx);
    }
    if (!Array.isArray(r.structuredPatch) || r.structuredPatch.length === 0)
        return null;
    const lines = [];
    for (const hunk of r.structuredPatch) {
        if (!hunk || !Array.isArray(hunk.lines))
            continue;
        lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...hunk.lines.filter((l) => typeof l === 'string'));
    }
    return lines.length ? fileChange(r.filePath, 'update', lines, ctx) : null;
}
/** The body of a JavaScript string literal starting at text[start] (a quote), unescaped; null when it does not end. */
function jsString(text, start) {
    const quote = text[start];
    let out = '';
    for (let i = start + 1; i < text.length; i++) {
        const c = text[i];
        if (c === quote)
            return out;
        if (quote === '`' && c === '$' && text[i + 1] === '{')
            return null;
        if (c !== '\\') {
            out += c;
            continue;
        }
        const n = text[++i];
        if (n === 'n')
            out += '\n';
        else if (n === 't')
            out += '\t';
        else if (n === 'r')
            out += '\r';
        else if (n === 'u' && /^[0-9a-f]{4}$/i.test(text.slice(i + 1, i + 5))) {
            out += String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16));
            i += 4;
        }
        else if (n === 'x' && /^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) {
            out += String.fromCharCode(parseInt(text.slice(i + 1, i + 3), 16));
            i += 2;
        }
        else if (n === '\n')
            continue;
        else
            out += n ?? '';
    }
    return null;
}
/** Every string in a value that holds a patch: the raw input, shell arguments, or tools.apply_patch("…") in a script. */
function patchTexts(value, into = []) {
    if (typeof value === 'string') {
        if (!value.includes('*** Begin Patch'))
            return into;
        if (value.trimStart().startsWith('{') || value.trimStart().startsWith('[')) {
            try {
                return patchTexts(JSON.parse(value), into);
            }
            catch {
                // not JSON: a script or the patch itself
            }
        }
        const calls = [...value.matchAll(/apply_patch\s*\(\s*(["'`])/g)];
        if (calls.length) {
            for (const call of calls) {
                const body = jsString(value, (call.index ?? 0) + call[0].length - 1);
                if (body?.includes('*** Begin Patch'))
                    into.push(body);
            }
        }
        else {
            into.push(value);
        }
    }
    else if (Array.isArray(value)) {
        value.forEach((v) => patchTexts(v, into));
    }
    else if (value && typeof value === 'object') {
        Object.values(value).forEach((v) => patchTexts(v, into));
    }
    return into;
}
/** Codex apply_patch: "*** Begin Patch", then Add, Update (optionally Move to) and Delete File sections. */
function codexChanges(payload, ctx) {
    const changes = [];
    for (const text of patchTexts([payload.input, payload.arguments])) {
        for (const [, patch] of text.matchAll(/\*\*\* Begin Patch\r?\n([\s\S]*?)(?:\*\*\* End Patch|$)/g)) {
            // Asserted, not annotated: flush() reads it from a closure, and a plain null start narrows it for good.
            let file = null;
            const flush = () => {
                if (!file)
                    return;
                while (file.lines.length && file.lines[file.lines.length - 1] === '')
                    file.lines.pop();
                changes.push(fileChange(file.path, file.op, file.lines, ctx, file.from));
            };
            for (const line of patch.split(/\r?\n/)) {
                const header = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
                if (header) {
                    flush();
                    file = { path: header[2].trim(), op: header[1] === 'Add' ? 'add' : header[1] === 'Delete' ? 'delete' : 'update', lines: [] };
                }
                else if (file && line.startsWith('*** Move to: ')) {
                    file = { ...file, from: file.path, path: line.slice(13).trim(), op: 'move' };
                }
                else if (file && !line.startsWith('*** ')) {
                    file.lines.push(line);
                }
            }
            flush();
        }
    }
    return changes;
}
/** Codex keeps the conversation in response_item lines; of the rest only the person stopping a turn matters. */
function slimCodexLine(type, timestamp, payload, ctx = {}) {
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
    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
        // Taken before the input is cut: a patch is usually longer than 40 lines.
        const changes = codexChanges(p, ctx);
        if (changes.length)
            p.changes = changes;
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
        case 'tool_use': {
            // An edit of a key or env file carries the old and new values in its input: only the path goes.
            const input = b.input;
            if (typeof input?.file_path === 'string' && withheldReason(input.file_path.replace(/\\/g, '/')) === 'sensitive') {
                return { type: 'tool_use', name: b.name, input: cut({ file_path: input.file_path }, 40) };
            }
            return { type: 'tool_use', name: b.name, input: cut(b.input, 40) };
        }
        default:
            return b;
    }
}
/**
 * One session line, slimmed; null when nothing in it is kept. The plugin streams big files through this, passing the
 * same ctx for every line of a session: it learns the session's folder from the lines that carry it.
 */
export function slimLine(d, ctx = {}) {
    const type = d.type;
    const payload = d.payload && typeof d.payload === 'object' && !Array.isArray(d.payload) ? d.payload : null;
    if (typeof d.cwd === 'string' && d.cwd)
        ctx.cwd = d.cwd;
    if (payload && (type === 'session_meta' || type === 'turn_context') && typeof payload.cwd === 'string' && payload.cwd)
        ctx.cwd = payload.cwd;
    if (type && DROP_TYPES.has(type))
        return null;
    // Codex rollout: {timestamp, type: 'response_item', payload: {...}}
    if (payload)
        return slimCodexLine(type, d.timestamp, payload, ctx);
    // Claude Code: {type, timestamp, message: {role, content}}, plus big copies like toolUseResult we skip.
    // isMeta marks messages Claude Code wrote in the person's name (skill bodies, caveats): the server skips them.
    if (d.message && typeof d.message === 'object') {
        const m = d.message;
        const content = Array.isArray(m.content) ? m.content.map(slimBlock).filter(Boolean) : m.content;
        // The change an edit made rides on its result; a line carries one tool result, so there is no doubt whose.
        const change = claudeChange(d.toolUseResult, ctx);
        const results = Array.isArray(content) ? content.filter((b) => b?.type === 'tool_result') : [];
        if (change && results.length === 1)
            results[0].change = change;
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
    const ctx = {};
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
        const slim = slimLine(d, ctx);
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
