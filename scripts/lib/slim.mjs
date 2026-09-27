// Generated from coders.talk resources/js/lib/slimSession.ts by `npm run plugin:sync`. Do not edit here: change the site's
// file and sync again. test/generated.test.mjs checks this hash of everything below, so an edit here fails the tests.
// sha256:0a02fc3eb9af0b099a811353d087347c8b5ab742e2d973b49598b501c1e98f3c

/**
 * Claude Code and Codex sessions are mostly weight nobody reads: screenshots as base64, whole files
 * returned by tools, snapshots and bookkeeping lines. The median session is 1.4 MB, the big ones
 * run to 60 MB. We keep only what the server's TurnParser reads, cut images and long tool output,
 * and send that, so a 60 MB session uploads as about 1 MB. Anything that is not JSON lines is
 * returned unchanged.
 */
/*
 * Lines are kept by what they are, never by what they are not: Claude Code and the desktop app keep adding bookkeeping
 * lines (bridge-session with account and organization ids, frame-link, artifact-*), and a list of what to drop is
 * always one release behind. A line of a type not named here goes nowhere.
 */
/** Claude Code's conversation lines and Pi's (its message lines): their message goes, as role and content. */
const MESSAGE_TYPES = new Set(['user', 'assistant', 'message']);
/** The Codex items the server reads (TurnParser): what was said, tool calls and their output. */
const CODEX_ITEMS = new Set(['message', 'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output']);
const CODEX_KEYS = ['type', 'role', 'content', 'name', 'arguments', 'input', 'output', 'exit_code', 'changes', 'withheld'];
/**
 * Other exports (older Codex rollouts, chat dumps) put a turn on the line itself. It is kept when it names a speaker
 * TurnParser knows (its role(), by role or else type), with only the keys TurnParser reads. A Codex item among them
 * (an older rollout's call or output) is slimmed like one in a payload.
 */
const SPEAKERS = new Set([
    'user', 'human', 'you',
    'assistant', 'ai', 'model', 'agent', 'claude', 'bot',
    'tool', 'function', 'tool_result', 'toolresult', 'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output',
]);
const TURN_KEYS = ['type', 'role', 'timestamp', 'ts', 'created_at', 'text', 'content', 'output', 'name', 'arguments', 'input', 'exit_code', 'changes', 'withheld'];
/** Lines the plugin writes itself: what git saw change (snapshots.mjs) and the session's folders (learnFolders). */
const OWN_LINES = new Map([
    ['git-changes', ['type', 'timestamp', 'by', 'changes', 'commits']],
    ['folders', ['type', 'timestamp', 'main', 'added']],
]);
const TOOL_LINES = 60;
const TOOL_CHARS = 8000;
/** One file change is shown whole up to here; the counts always cover all of it. */
const CHANGE_LINES = 300;
const CHANGE_CHARS = 20000;
/** What is left of a call to the Coders Talk library and of its answer: the searches and other people's sessions stay here. */
export const LIBRARY_MARKER = '[library call — not kept]';
/**
 * What the answer of a call that names a file that may hold secrets becomes (a read, a search, a shell print, an edit, a
 * Codex patch), and its input too unless the file is named by a path key.
 */
export const WITHHELD_MARKER = '[content not shown, the file may hold secrets]';
function cut(value, lines = TOOL_LINES) {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    const all = text.split('\n');
    // Cut before (the plugin's lines, slimmed again on the server): the count of what was cut stays.
    const done = all.length === lines + 1 && /^… \d+ more lines$/.test(all[lines]);
    const kept = all.length > lines && !done ? `${all.slice(0, lines).join('\n')}\n… ${all.length - lines} more lines` : text;
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
    // Tokens, cloud and cluster logins, infrastructure state, password vaults, VPN profiles; prod.env like .env.
    if (/^(\.git-credentials|\.envrc|\.dev\.vars|kubeconfig|\.htpasswd|application_default_credentials\.json|local\.settings\.json|\.vault-token|\.s3cfg|\.boto|\.terraformrc|secrets\.(ya?ml|json|toml))$/.test(name) ||
        /\.(env|tfvars|tfstate|tfstate\.backup|kdbx|gpg|ovpn)$/.test(name) ||
        /(^|\/)\.ssh\/|(^|\/)\.kube\/config$|(^|\/)\.docker\/config\.json$/.test(lower))
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
const LIBRARY_TOOLS = ['search_coding_agent_sessions', 'find_coding_agent_failures', 'get_coding_agent_session'];
/** A Codex script (the exec tool) that calls one of the library's tools. */
const LIBRARY_SCRIPT = /(?:^|[^A-Za-z0-9_]|__)(?:search_coding_agent_sessions|find_coding_agent_failures|get_coding_agent_session)(?![A-Za-z0-9_])/;
/** Shell tools: the command's words are checked for secret files (`cat .env`, `type prod.env`). */
const SHELL_TOOLS = ['bash', 'shell', 'sh', 'zsh', 'powershell', 'pwsh', 'cmd', 'exec', 'exec_command', 'local_shell', 'shell_command', 'container.exec', 'run_terminal_cmd', 'run_shell_command', 'terminal', 'execute_command'];
/** Where tools name the file they read, search or change. */
const PATH_KEYS = ['file_path', 'filePath', 'path', 'notebook_path', 'file', 'filename'];
const isSecretFile = (path) => typeof path === 'string' && path !== '' && withheldReason(path.replace(/\\/g, '/')) === 'sensitive';
/** The Coders Talk library's tools: mcp__…coders-talk…__*, plugin_coders-talk*, or one of its tool names however prefixed. */
export function isLibraryTool(name) {
    const lower = name.toLowerCase();
    if (/^mcp__.*coders[-_]?talk.*__/.test(lower) || lower.startsWith('plugin_coders-talk') || lower.startsWith('plugin_coders_talk'))
        return true;
    return LIBRARY_TOOLS.includes(lower.split(/__|[./:]/).pop() ?? '');
}
/** A call's input as an object: parsed when it is JSON, a shell tool's raw string as its command; null otherwise. */
function callArgs(input, shell) {
    let args = input;
    if (typeof args === 'string') {
        const raw = args;
        try {
            args = JSON.parse(raw);
        }
        catch {
            args = undefined;
        }
        if (!args || typeof args !== 'object')
            args = shell ? { command: raw } : null;
    }
    return args && typeof args === 'object' && !Array.isArray(args) ? args : null;
}
/** Whether a path key of a call's input (file_path, path, paths…) names a file that may hold secrets. */
function namesSecretPath(a) {
    const paths = a.paths === undefined || a.paths === null ? [] : Array.isArray(a.paths) ? a.paths : [a.paths];
    return [...PATH_KEYS.map((k) => a[k]), ...paths].some(isSecretFile);
}
/**
 * What becomes of a call's answer: 'library' for the Coders Talk library's tools (and a Codex script that calls one),
 * 'sensitive' when the call names a file that may hold secrets, whatever it does with it (Read, Grep, Edit, `cat .env`,
 * a script's `exec_command({ cmd: "cat .env" })`); null otherwise. The same rules as the server's SessionSlimmer::callMark.
 */
export function callMark(name, input) {
    const tool = name.toLowerCase().split(/__|[/:]/).pop() ?? '';
    if (isLibraryTool(name) || (tool === 'exec' && typeof input === 'string' && LIBRARY_SCRIPT.test(input)))
        return 'library';
    const shell = SHELL_TOOLS.includes(tool);
    const a = callArgs(input, shell);
    if (!a)
        return null;
    if (namesSecretPath(a))
        return 'sensitive';
    if (!shell && (a.command === undefined || a.command === null) && (a.cmd === undefined || a.cmd === null))
        return null;
    let command = a.command ?? a.cmd ?? a.script;
    if (Array.isArray(command))
        command = command.filter((c) => typeof c === 'string').join(' ');
    if (typeof command !== 'string')
        return null;
    return command.split(/[\s;|&<>()`"'=,{}[\]]+/).some((word) => word !== '' && isSecretFile(word)) ? 'sensitive' : null;
}
/**
 * A call's input as it goes: a marker for the library; for a call on a secret file only its path keys when they name
 * it (the file by name, not the values an edit writes), else a marker, since a command or a patch carries what it
 * prints or writes; otherwise cut.
 */
function callInput(mark, input) {
    if (mark === 'library')
        return LIBRARY_MARKER;
    if (mark === 'sensitive') {
        const a = callArgs(input, false);
        return a && namesSecretPath(a) ? cut(only(a, [...PATH_KEYS, 'paths']), 40) : WITHHELD_MARKER;
    }
    return cut(input, 40);
}
/** Remembers what becomes of a call's answer, for the answer on a later line. */
function remember(ctx, id, mark) {
    if (typeof id === 'string' && id !== '') {
        if (mark)
            (ctx.marks ??= {})[id] = mark;
    }
    else {
        // A call after an answer starts a new round: calls of the last one left without an answer were interrupted.
        if (ctx.afterResult)
            ctx.queue = [];
        (ctx.queue ??= []).push(mark);
    }
    ctx.afterResult = false;
}
function recall(ctx, id) {
    ctx.afterResult = true;
    if (typeof id === 'string' && id !== '') {
        const mark = ctx.marks?.[id] ?? null;
        if (ctx.marks)
            delete ctx.marks[id];
        return mark;
    }
    return ctx.queue?.length ? (ctx.queue.shift() ?? null) : null;
}
/** An answer as it goes: a marker, or cut. */
function answer(mark, value) {
    if (mark === 'sensitive')
        return WITHHELD_MARKER;
    if (mark === 'library')
        return LIBRARY_MARKER;
    return cut(value);
}
const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
const within = (path, dir) => path.toLowerCase().startsWith(`${dir.toLowerCase()}/`);
const lastParts = (path, n) => path.split('/').filter(Boolean).slice(-n).join('/');
/** A drive, the file system's root or a home folder: its name says nothing, or names the person. */
const bare = (dir) => /^([a-z]:)?(\/(users|home)\/[^/]+)?$/i.test(dir) || dir === '/root';
/**
 * The folders added to a session besides the one it started in (Claude Code's /add-dir, Codex's workspace roots), each
 * with the name it is shown by: its own, numbered when an earlier one has it (the parent's name could be the person's).
 * Not a folder around the session's own or inside it, the agents' own (Codex keeps its canvases under ~/.codex), a
 * home folder or a drive: files there count as the session's own or as outside, like before.
 */
export function addedFolders(ctx) {
    const main = ctx.cwd ? norm(ctx.cwd) : '';
    const used = [main && !bare(main) ? lastParts(main, 1).toLowerCase() : ''];
    return (ctx.roots ?? [])
        .map(norm)
        .filter((dir) => !bare(dir) && !/(^|\/)\.(claude|codex)(\/|$)/i.test(dir))
        .filter((dir) => !main || (dir.toLowerCase() !== main.toLowerCase() && !within(main, dir) && !within(dir, main)))
        .map((dir) => {
        const name = lastParts(dir, 1);
        let label = name;
        for (let n = 2; used.includes(label.toLowerCase()); n++)
            label = `${name} ${n}`;
        used.push(label.toLowerCase());
        return { dir, label };
    });
}
/**
 * The path inside the session's folder, or inside the added folder that holds it (the deepest one); a file elsewhere
 * keeps only its last two parts, since the rest names the person.
 */
function changedPath(file, ctx) {
    const path = norm(file);
    const base = ctx.cwd ? norm(ctx.cwd) : '';
    if (base && within(path, base))
        return { path: path.slice(base.length + 1) };
    const folder = addedFolders(ctx)
        .filter((f) => within(path, f.dir))
        .sort((a, b) => b.dir.length - a.dir.length)[0];
    if (folder)
        return { path: path.slice(folder.dir.length + 1), root: folder.label };
    if (!/^([a-z]:)?\//i.test(path))
        return { path: path.replace(/^\.\//, '') };
    return { path: `…/${lastParts(path, 2)}`, outside: true };
}
function fileChange(file, op, lines, ctx, from) {
    const where = changedPath(file, ctx);
    const body = (l) => !l.startsWith('@@');
    const change = {
        path: where.path,
        ...(where.root ? { root: where.root } : {}),
        ...(from ? { from: changedPath(from, ctx).path } : {}),
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
    const p = slimCodexItem(payload, CODEX_KEYS, ctx);
    return p ? { type, timestamp, payload: p } : null;
}
/**
 * A Codex item, from a response_item's payload or (an older rollout) the line itself, with only the given keys; null
 * when the server does not read it: reasoning, compaction, ghost_snapshot, web_search_call and whatever comes next.
 */
function slimCodexItem(item, keys, ctx) {
    if (typeof item.type !== 'string' || !CODEX_ITEMS.has(item.type))
        return null;
    const p = only(item, keys);
    // Developer messages are the app's instructions to the model, not the conversation.
    if (p.type === 'message' && (p.role === 'developer' || p.role === 'system'))
        return null;
    if (Array.isArray(p.content)) {
        p.content = p.content.map((b) => (b?.type === 'input_image' ? { type: 'input_text', text: '[image]' } : b));
    }
    const call = p.type === 'function_call' || p.type === 'custom_tool_call';
    // Taken before the input is cut: a patch is usually longer than 40 lines. A line slimmed before (the plugin's, which
    // the server slims again) has them already, and its input is cut.
    if (call && !Array.isArray(p.changes)) {
        const changes = codexChanges(p, ctx);
        if (changes.length)
            p.changes = changes;
    }
    // A call that names a secret file, or asks the library, has its answer replaced by a marker, and its input too
    // (callInput). A patch of a secret file carries its values in the raw patch: only its changes go, the file by name.
    let mark = null;
    if (call) {
        const secretPatch = Array.isArray(p.changes) && p.changes.some((c) => c?.withheld === 'sensitive');
        mark = secretPatch ? 'sensitive' : callMark(typeof p.name === 'string' ? p.name : '', p.arguments ?? p.input ?? null);
        remember(ctx, item.call_id, mark);
    }
    else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
        mark = recall(ctx, item.call_id) ?? (p.withheld === 'sensitive' ? 'sensitive' : null);
    }
    delete p.withheld;
    if ('output' in p) {
        // The exit code sits inside the output, which is about to be cut: keep it next to it.
        const code = exitCode(p.output);
        if (code !== null)
            p.exit_code = code;
        p.output = answer(mark, Array.isArray(p.output) ? blockText(p.output) : p.output);
        if (mark === 'sensitive')
            p.withheld = 'sensitive';
    }
    if ('arguments' in p)
        p.arguments = callInput(mark, p.arguments);
    if ('input' in p)
        p.input = callInput(mark, p.input);
    return p;
}
function slimBlock(block, ctx) {
    if (!block || typeof block !== 'object')
        return block;
    const b = block;
    switch (b.type) {
        case 'image':
            return { type: 'text', text: '[image]' };
        case 'thinking':
        case 'redacted_thinking':
            return null;
        case 'tool_result': {
            // is_error marks a failed tool call: the server offers it to the labeller as a possible Fail. A result slimmed
            // before (the plugin's, which the server slims again) keeps the change it carries. The answer to a call that
            // read a secret file, or asked the library, keeps only a marker.
            const mark = recall(ctx, b.tool_use_id) ?? (b.withheld === 'sensitive' ? 'sensitive' : null);
            return {
                type: 'tool_result',
                content: answer(mark, blockText(b.content)),
                ...(mark === 'sensitive' ? { withheld: 'sensitive' } : {}),
                ...(b.is_error === true ? { is_error: true } : {}),
                ...(b.change && typeof b.change === 'object' ? { change: b.change } : {}),
            };
        }
        case 'tool_use': {
            const mark = callMark(typeof b.name === 'string' ? b.name : '', b.input);
            remember(ctx, b.id, mark);
            return { type: 'tool_use', name: b.name, input: callInput(mark, b.input) };
        }
        default:
            return b;
    }
}
/**
 * Learns the session's folders from the lines that carry them: the one it started in (Claude Code's environment and
 * every line of it, Codex's session_meta and turn_context), and the ones added to it (the environment's
 * additionalWorkingDirectories, Codex's workspace_roots). When the added ones change, the bookkeeping line that said so
 * becomes a folders line with their names and the session's own folder's: never a path.
 */
function learnFolders(d, type, payload, ctx) {
    const attachment = type === 'attachment' ? d.attachment : undefined;
    const env = attachment?.type === 'environment' ? attachment.snapshot : undefined;
    const started = [env?.workingDirectory, d.cwd, type === 'session_meta' || type === 'turn_context' ? payload?.cwd : null].find((c) => typeof c === 'string' && c !== '');
    if (typeof started === 'string')
        ctx.cwd ??= started;
    const added = env ? env.additionalWorkingDirectories : type === 'turn_context' ? payload?.workspace_roots : undefined;
    if (!Array.isArray(added))
        return null;
    const roots = (ctx.roots ??= []);
    for (const dir of added) {
        if (typeof dir === 'string' && dir !== '' && !roots.some((r) => norm(r).toLowerCase() === norm(dir).toLowerCase()))
            roots.push(dir);
    }
    const labels = addedFolders(ctx).map((f) => f.label);
    if (!labels.length || labels.join('\n') === ctx.announced)
        return null;
    ctx.announced = labels.join('\n');
    const main = ctx.cwd ? norm(ctx.cwd) : '';
    return { type: 'folders', ...('timestamp' in d ? { timestamp: d.timestamp } : {}), main: main && !bare(main) ? lastParts(main, 1) : null, added: labels };
}
/**
 * One session line, slimmed; null when nothing in it is kept. The plugin streams big files through this, passing the
 * same ctx for every line of a session: it learns the session's folders from the lines that carry them.
 */
export function slimLine(d, ctx = {}) {
    const type = d.type;
    const payload = d.payload && typeof d.payload === 'object' && !Array.isArray(d.payload) ? d.payload : null;
    const folders = learnFolders(d, type, payload, ctx);
    if (folders)
        return folders;
    // Codex rollout: {timestamp, type: 'response_item', payload: {...}}
    if (payload)
        return slimCodexLine(type, d.timestamp, payload, ctx);
    // Claude Code: {type, timestamp, message: {role, content}}, plus big copies like toolUseResult we skip.
    // isMeta marks messages Claude Code wrote in the person's name (skill bodies, caveats): the server skips them.
    if (d.message && typeof d.message === 'object') {
        if (type !== undefined && !MESSAGE_TYPES.has(type))
            return null;
        const m = d.message;
        const content = Array.isArray(m.content) ? m.content.map((b) => slimBlock(b, ctx)).filter(Boolean) : m.content;
        // The change an edit made rides on its result; a line carries one tool result, so there is no doubt whose.
        const change = claudeChange(d.toolUseResult, ctx);
        const results = Array.isArray(content) ? content.filter((b) => b?.type === 'tool_result') : [];
        if (change && results.length === 1)
            results[0].change = change;
        return { type, timestamp: d.timestamp, ...(d.isMeta === true ? { isMeta: true } : {}), message: { role: m.role, content } };
    }
    const own = typeof type === 'string' ? OWN_LINES.get(type) : undefined;
    if (own)
        return only(d, own);
    // An older Codex rollout: the item is the line itself.
    if (typeof type === 'string' && CODEX_ITEMS.has(type))
        return slimCodexItem(d, TURN_KEYS, ctx);
    const speaker = typeof d.role === 'string' ? d.role : type;
    return typeof speaker === 'string' && SPEAKERS.has(speaker.toLowerCase()) ? only(d, TURN_KEYS) : null;
}
/** The keys that are present, in the order given. */
function only(d, keys) {
    return Object.fromEntries(keys.filter((k) => k in d).map((k) => [k, d[k]]));
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
