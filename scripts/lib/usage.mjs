// Generated from coders.talk resources/js/lib/sessionUsage.ts by `npm run plugin:sync`. Do not edit here.

/**
 * The tokens a session spent, per model (plan: private and team Builds, phase 3). Slimming drops the bookkeeping
 * that carries them, so this reads the lines before they are slimmed: in the browser on the import page, and in
 * the agent plugins (scripts/lib/usage.mjs via `npm run plugin:sync`). Only counts leave the machine.
 *
 * Claude Code writes one line per block of an assistant message, each with the message's usage: the last line of
 * a message id counts. Codex writes running totals in token_count events and names the model in turn_context: the
 * last total counts. Codex input includes the cached part; here "input" is what was not read from the cache.
 */
const MAX_MODELS = 10;
function count(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
function modelName(value) {
    return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 64) : 'unknown';
}
export class UsageCounter {
    messages = new Map();
    codexModel = 'unknown';
    codexTotal = null;
    /** One parsed session line, before slimming. */
    add(d) {
        if (!d || typeof d !== 'object')
            return;
        if (d.type === 'assistant' && d.message && typeof d.message === 'object') {
            const m = d.message;
            const u = m.usage;
            if (!u || typeof u !== 'object')
                return;
            const id = typeof m.id === 'string' && m.id ? m.id : `line-${this.messages.size}`;
            this.messages.set(id, {
                model: modelName(m.model),
                usage: { input: count(u.input_tokens), output: count(u.output_tokens), cache_read: count(u.cache_read_input_tokens), cache_write: count(u.cache_creation_input_tokens) },
            });
            return;
        }
        const p = d.payload;
        if (!p || typeof p !== 'object')
            return;
        if (d.type === 'turn_context' && typeof p.model === 'string')
            this.codexModel = modelName(p.model);
        if (d.type === 'event_msg' && p.type === 'token_count') {
            const t = p.info?.total_token_usage;
            if (t && typeof t === 'object') {
                const cached = count(t.cached_input_tokens);
                this.codexTotal = { input: Math.max(0, count(t.input_tokens) - cached), output: count(t.output_tokens), cache_read: cached, cache_write: 0 };
            }
        }
    }
    /** Per model, the busiest first; null when the session carries no usage at all. */
    result() {
        const models = {};
        const add = (model, u) => {
            const m = (models[model] ??= { input: 0, output: 0, cache_read: 0, cache_write: 0 });
            m.input += u.input;
            m.output += u.output;
            m.cache_read += u.cache_read;
            m.cache_write += u.cache_write;
        };
        for (const { model, usage } of this.messages.values())
            add(model, usage);
        if (this.codexTotal)
            add(this.codexModel, this.codexTotal);
        const total = (u) => u.input + u.output + u.cache_read + u.cache_write;
        const kept = Object.entries(models)
            .filter(([, u]) => total(u) > 0)
            .sort(([, a], [, b]) => total(b) - total(a))
            .slice(0, MAX_MODELS);
        return kept.length ? { models: Object.fromEntries(kept) } : null;
    }
}
/** The usage of a whole session file's text (JSON lines); null for anything else. */
export function usageOfJsonl(text) {
    const counter = new UsageCounter();
    for (const line of text.split(/\r?\n/)) {
        if (line.trim() === '')
            continue;
        try {
            counter.add(JSON.parse(line));
        }
        catch {
            // not a JSON line: nothing to count there
        }
    }
    return counter.result();
}
