/**
 * Rules in every session (coders.talk plan: personal rules, stage 37). The person's own rules from Coders Talk, and in
 * a team's repository the team's when the team turns that on, go into the session's context at its start: the
 * agent reads them like a CLAUDE.md, and nothing is written into the repository.
 *
 * Which rules: the repository's stacks, found here from its manifests (lib/stacks.mjs), and its owner on GitHub, which
 * tells the site whether it is one of the person's teams'. Only those names leave the computer, with the names of the
 * team blocks the repository already has in its own files (`use --team`), so they are not said twice.
 *
 * The SessionStart hook never goes to the network: it reads what the last fetch kept (~/.coders-talk/rules.json) and,
 * when that is over FETCH_EVERY_MS old or the repository's stacks changed, starts `coders-talk rules-fetch` in the
 * background. A change on the site reaches the next session after that. `coders-talk rules off` (or
 * CODERS_TALK_RULES=0) stops it on this computer.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { home, writePrivate } from './credentials.mjs';
import { normalizeRemote, originUrl } from './git.mjs';
import { readUses } from './playbooks.mjs';
import { detectStacks } from './stacks.mjs';

export const FETCH_EVERY_MS = 60 * 60 * 1000;

/** Repositories not seen for this long are dropped from the file. */
const FORGET_MS = 30 * 24 * 60 * 60 * 1000;

const stateFile = (dir) => join(dir, 'rules.json');
const siteKey = (site) => site.replace(/\/+$/, '');
const pathKey = (root) => {
    const path = resolve(root).replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? path.toLowerCase() : path;
};
const repoKey = (site, root) => `${siteKey(site)}|${pathKey(root)}`;

export function readRulesFile(dir = home()) {
    try {
        const state = JSON.parse(readFileSync(stateFile(dir), 'utf8'));
        return state && typeof state === 'object' ? { off: state.off ?? {}, repos: state.repos ?? {} } : { off: {}, repos: {} };
    } catch {
        return { off: {}, repos: {} };
    }
}

function writeRulesFile(state, dir, now = Date.now()) {
    for (const [key, entry] of Object.entries(state.repos)) {
        if (now - (entry.seen_at ?? entry.checked_at ?? 0) > FORGET_MS) delete state.repos[key];
    }
    writePrivate(stateFile(dir), JSON.stringify(state, null, 2) + '\n');
}

/** Whether rules go into sessions on this computer for this site: on unless turned off here or by CODERS_TALK_RULES=0. */
export function rulesOn(site, dir = home(), env = process.env) {
    if (env.CODERS_TALK_RULES === '0') return false;

    return !readRulesFile(dir).off[siteKey(site)];
}

export function setRulesOn(site, on, dir = home()) {
    const state = readRulesFile(dir);
    if (on) delete state.off[siteKey(site)];
    else state.off[siteKey(site)] = true;
    writeRulesFile(state, dir);
}

/** The repository's GitHub owner (lower case), or null for any other host. */
export function githubOwner(root) {
    const remote = normalizeRemote(originUrl(root));

    return remote ? remote.split('/')[3].toLowerCase() : null;
}

/** The team blocks this repository has in its own files: their marker names, team-<team>-<stack>. */
export function blocksHere(root) {
    const names = new Set();
    for (const use of readUses(root)) {
        if (typeof use.team === 'string' && typeof use.stack === 'string') names.add(`team-${use.team}-${use.stack}`);
    }

    return [...names].sort();
}

/** What the site is asked about this repository: {stacks, owner, have}. */
export function repositoryFacts(root) {
    return { stacks: detectStacks(root), owner: githubOwner(root), have: blocksHere(root) };
}

const sameFacts = (a, b) => JSON.stringify([a?.stacks ?? [], a?.owner ?? null, a?.have ?? []]) === JSON.stringify([b.stacks, b.owner, b.have]);

/** The last fetch for this repository: {hash, text, rules, sections, team, facts, checked_at, shown}, or null. */
export function rulesEntry(site, root, dir = home()) {
    return readRulesFile(dir).repos[repoKey(site, root)] ?? null;
}

/** Whether to fetch again: never fetched, over FETCH_EVERY_MS ago, or the repository's stacks or owner changed. */
export function rulesFetchDue(site, root, facts = repositoryFacts(root), dir = home(), now = Date.now()) {
    if (!facts.stacks.length) return false;
    const entry = rulesEntry(site, root, dir);

    return !entry || now - (entry.checked_at ?? 0) >= FETCH_EVERY_MS || !sameFacts(entry.facts, facts);
}

/**
 * What the start of a session gets from the last fetch: {context, line}. The context is the site's text, for the
 * agent; the line is for the person, said once each time the rules here change (not at every start). Null without
 * rules.
 */
export function rulesAtSessionStart(site, root, command, dir = home()) {
    const state = readRulesFile(dir);
    const key = repoKey(site, root);
    const entry = state.repos[key];
    if (!entry?.text) return null;
    let line = null;
    if (entry.shown !== entry.hash) {
        line = `${summary(entry)}. To see them: ${command}`;
        state.repos[key] = { ...entry, shown: entry.hash, seen_at: Date.now() };
        writeRulesFile(state, dir);
    }

    return { context: entry.text, line };
}

/** "Coders Talk added 5 rules to this session: Laravel (3 yours, 2 from Acme)". */
export function summary(entry) {
    const stacks = new Map();
    for (const s of entry.sections ?? []) {
        if (!s.rules) continue;
        const parts = stacks.get(s.label) ?? [];
        parts.push(s.scope === 'team' ? `${s.rules} from ${entry.team?.name ?? 'the team'}` : `${s.rules} yours`);
        stacks.set(s.label, parts);
    }
    const listed = [...stacks].map(([label, parts]) => `${label} (${parts.join(', ')})`).join(', ');

    return `Coders Talk added ${entry.rules} ${entry.rules === 1 ? 'rule' : 'rules'} to this session${listed ? `: ${listed}` : ''}`;
}

/**
 * Asks the site for this repository's rules and keeps the answer: 304 keeps the text, 200 replaces it, 401 or 403
 * (signed out, a token that may not read) clears it. Errors leave the file as it was, to be tried at the next start.
 * $get is (path, headers) => Response, signed with this site's token.
 */
export async function fetchRules(site, root, get, dir = home(), now = Date.now()) {
    const facts = repositoryFacts(root);
    const key = repoKey(site, root);
    const before = readRulesFile(dir).repos[key];
    if (!facts.stacks.length) return before ?? null;
    const query = new URLSearchParams({ stacks: facts.stacks.join(',') });
    if (facts.owner) query.set('owner', facts.owner);
    if (facts.have.length) query.set('have', facts.have.join(','));
    const same = before && sameFacts(before.facts, facts) && before.hash;
    const response = await get(`/api/v1/rules?${query}`, { Accept: 'application/json', ...(same ? { 'If-None-Match': `"${before.hash}"` } : {}) });

    let entry;
    if (response.status === 304) entry = { ...before, checked_at: now };
    else if (response.status === 401 || response.status === 403) entry = { hash: '', text: '', rules: 0, sections: [], team: null, facts, checked_at: now };
    else if (response.ok) {
        const found = await response.json();
        entry = {
            hash: typeof found.hash === 'string' ? found.hash : '',
            text: typeof found.text === 'string' ? found.text : '',
            rules: Number(found.rules) || 0,
            sections: Array.isArray(found.sections) ? found.sections.map(({ scope, stack, label, rules, in_repository }) => ({ scope, stack, label, rules, in_repository })) : [],
            team: found.team ?? null,
            url: found.url ?? null,
            // Turned off for the whole account on the site (Settings, or Your rules): the text is empty then.
            off: found.off === true,
            facts,
            checked_at: now,
            shown: before?.shown ?? null,
        };
    } else {
        return before ?? null;
    }
    const state = readRulesFile(dir);
    state.repos[key] = { ...entry, seen_at: now };
    writeRulesFile(state, dir, now);

    return state.repos[key];
}
