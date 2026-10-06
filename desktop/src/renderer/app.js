// The window: a welcome wizard, then Home, Sessions (with the confirmation before each send) and Settings, over the
// coders-talk CLI. Everything it shows comes from a command's JSON (window.ct.call, preload.cjs); everything it changes
// is one command. Text from sessions is the person's own, so all of it is escaped.

const call = (method, params = {}, onEvent = null) => window.ct.call(method, params, onEvent);

// The site's agent glyphs (resources/js/lib/format.ts, agentGlyph).
const AGENTS = {
    'claude-code': { name: 'Claude Code', mark: 'cc' },
    codex: { name: 'Codex', mark: 'cx' },
    cursor: { name: 'Cursor', mark: 'cu' },
    pi: { name: 'Pi', mark: 'pi' },
};
const SEND_MODES = [
    { mode: 'off', title: 'Ask me each time', text: 'Nothing leaves until you pick a session and press Send.', tag: 'Recommended' },
    { mode: 'on', title: 'Send automatically', text: 'Sessions go to your private drafts as you work, with secrets hidden first. Nothing is published.' },
    { mode: 'team', title: 'Only team projects', text: 'Only sessions in repositories of teams that ask for it go, to the team. Everything else stays here.' },
];
const REFRESH_ON_FOCUS_MS = 30_000;

const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    shieldCheck: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    out: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
};
/**
 * The brand kit's mark (icon.svg), as the site's BrandMark.vue draws it: the C in the text colour, the cursor in the
 * accent, so it follows the theme. With the wordmark "coders.talk" beside it.
 */
const brand = (size = 22, word = true) =>
    `<span class="brand"><svg width="${size}" height="${Math.round((size * 272) / 256)}" viewBox="0 0 256 272" aria-hidden="true"><path fill="currentColor" d="M76 24H214Q220 24 220 30V70Q220 76 214 76H87Q76 76 76 87V165Q76 176 87 176H214Q220 176 220 182V224Q220 230 214 230H70L21 251Q10 256 14 243L25 208V78Q25 24 76 24Z"/><rect x="184" y="102" width="58" height="58" rx="6" fill="var(--accent)"/></svg>${word ? '<span class="wordmark">coders<span class="dot">.</span>talk</span>' : ''}</span>`;
const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const state = {
    view: 'boot',
    init: null,
    status: null,
    statusError: null,
    loading: false,
    loadedAt: 0,
    account: null,
    wizard: { phase: 'idle', login: null, loginError: null, agents: [], error: null, done: null },
    agentOp: null,
    sessions: { list: null, loading: false, error: null, query: '', agent: 'all', folder: null },
    confirm: null,
    settings: { busy: null, input: '' },
    toasts: [],
    /** The app's own update (src/main/updater.mjs); asked: the person pressed "Check for updates" and expects an answer. */
    update: { state: 'off' },
    updateAsked: false,
};

/* ---------- helpers ---------- */

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const agentName = (id) => AGENTS[id]?.name ?? id;
const mark = (id, cls = '') => `<span class="mark ${esc(id)} ${cls}">${esc(AGENTS[id]?.mark ?? '?')}</span>`;
const connectedAgents = () => (state.status?.agents ?? []).filter((a) => a.connected);
const siteHost = () => (state.status?.site ? new URL(state.status.site).host : 'coders.talk');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function ago(iso) {
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    const min = Math.round(ms / 60_000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${plural(h, 'hour')} ago`;
    const d = Math.round(h / 24);
    if (d < 30) return `${plural(d, 'day')} ago`;

    return new Date(iso).toLocaleDateString();
}

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** "Today", "Yesterday", "Monday", or the date: the headers of the sessions list. */
function dayOf(iso) {
    const at = new Date(iso);
    const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((start(new Date()) - start(at)) / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return at.toLocaleDateString([], { weekday: 'long' });

    return at.toLocaleDateString([], { month: 'long', day: 'numeric' });
}

/** The CLI's words, said for someone who has not read its manual. */
function friendly(error) {
    const text = String(error ?? '');
    if (/not connected to .* yet/i.test(text)) return 'You are not signed in yet. Sign in from Home first.';
    if (/token was not accepted/i.test(text)) return 'Your sign-in has expired. Sign in again from Home.';
    if (/Could not reach|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(text)) return `Can't reach ${siteHost()}. Check your internet connection and try again.`;
    if (/nothing to send yet/i.test(text)) return 'This session has no prompts yet, so there is nothing to send.';
    if (/Too many requests/i.test(text)) return text.replace('Too many requests.', 'Coders Talk is busy.');

    return text;
}

function alertHtml(kind, text, details = null) {
    if (!text) return '';

    return `<div class="alert ${kind}">${icon(kind === 'ok' ? 'check' : 'alert', 'sm')}<div class="grow">${esc(text)}${details ? `<details><summary>Details</summary><pre>${esc(details)}</pre></details>` : ''}</div></div>`;
}

function toast(text, kind = '') {
    const t = { text, kind, id: Math.random() };
    // One at a time: a newer one says what matters now.
    state.toasts = [t];
    render();
    setTimeout(() => {
        state.toasts = state.toasts.filter((x) => x !== t);
        render();
    }, 2600);
}

/* ---------- data ---------- */

async function loadStatus({ quiet = false } = {}) {
    if (!quiet) {
        state.loading = true;
        render();
    }
    const r = await call('status');
    state.loading = false;
    state.loadedAt = Date.now();
    if (r.ok) {
        state.status = r.result;
        state.statusError = null;
    } else state.statusError = friendly(r.error);
    render();

    return r.ok;
}

/** Whether the saved sign-in still works: asked in the background. */
async function checkAccount() {
    if (!state.status?.signed_in) {
        state.account = null;
        return render();
    }
    const r = await call('whoami');
    state.account = r.ok ? { ok: true, username: r.result.username } : { ok: false, error: friendly(r.error) };
    render();
}

async function loadSessions({ quiet = false } = {}) {
    const s = state.sessions;
    if (!quiet) s.loading = true;
    s.error = null;
    render();
    const r = await call('sessions', { folder: s.folder });
    s.loading = false;
    if (r.ok) s.list = r.result.sessions;
    else s.error = friendly(r.error);
    render();
}

/* ---------- start ---------- */

/** What the update's state says in Settings. */
function updateLine(u) {
    return {
        off: 'Updates are checked by the installed app.',
        store: 'Updates come from the Microsoft Store.',
        idle: '',
        checking: 'Checking for updates…',
        none: 'You have the latest version.',
        downloading: `Downloading ${u.version ?? 'the update'}… ${u.percent ?? 0}%`,
        ready: `Version ${u.version} is ready: restart to use it.`,
        error: `Could not check for updates: ${u.error}`,
    }[u.state] ?? '';
}

window.ct.onUpdate((u) => {
    const asked = state.updateAsked;
    state.update = u;
    if (asked && ['none', 'error', 'ready'].includes(u.state)) {
        state.updateAsked = false;
        if (u.state !== 'ready') toast(u.state === 'none' ? 'You have the latest version' : updateLine(u), u.state === 'error' ? 'bad' : '');
    }
    if (u.state === 'ready' && !asked) toast(`Update ${u.version} is ready`);
    render();
});

async function checkUpdates() {
    state.updateAsked = true;
    state.update = await call('checkUpdates');
    render();
}

async function boot() {
    state.init = await call('init');
    state.update = await call('updateState');
    document.documentElement.classList.toggle('mac', state.init.platform === 'darwin');
    if (state.init.cliError) {
        state.view = 'welcome';
        return render();
    }
    state.view = 'welcome';
    await loadStatus();
    if (state.status?.signed_in && connectedAgents().length) {
        state.view = 'home';
        render();
        checkAccount();
    }
}

/* ---------- welcome ---------- */

async function getStarted() {
    const w = state.wizard;
    if (w.phase === 'login' || w.phase === 'connect') return;
    Object.assign(w, { phase: 'login', login: null, loginError: null, agents: [], error: null, done: null });
    render();

    const signed = await call('login', {}, (e) => {
        if (e.event === 'opened') {
            w.login = e;
            render();
        }
    });
    if (!signed.ok) {
        w.phase = 'idle';
        w.loginError = signed.cancelled ? null : friendly(signed.error);
        return render();
    }
    w.username = signed.events.find((e) => e.event === 'connected')?.username;

    const agents = (state.status?.agents ?? []).filter((a) => a.present).map((a) => a.id);
    if (!agents.length) {
        w.phase = 'idle';
        w.error = 'No coding agent was found on this computer. Install Claude Code, Codex, Cursor or Pi, then try again.';
        return render();
    }
    w.phase = 'connect';
    render();
    const r = await call('connect', { agents }, (e) => onAgentEvent(e, w.agents));
    w.phase = 'done';
    if (!r.ok) w.error = friendly(r.error);
    else w.done = r.events.at(-1) ?? null;
    await loadStatus({ quiet: true });
    render();
}

/** enable's and disable's events, one line per agent. */
function onAgentEvent(e, list) {
    if (e.event !== 'step') return;
    let step = list.find((s) => s.agent === e.agent);
    if (!step) list.push((step = { agent: e.agent }));
    step.status = e.status;
    step.off = /take Coders Talk off|uninstall/.test(e.text);
    step.message = e.status === 'failed' ? e.message : null;
    step.details = e.status === 'failed' ? e.details : null;
    render();
}

function agentSteps(list) {
    if (!list.length) return '';

    return `<ul class="mini">${list
        .map((s) => {
            const name = agentName(s.agent);
            const verb = s.off ? ['Disconnecting', 'disconnected', 'disconnect'] : ['Adding Coders Talk to', 'ready', 'add Coders Talk to'];
            const text = s.status === 'running' ? `${verb[0]} ${name}…` : s.status === 'done' ? `${name} ${verb[1]}` : `Could not ${verb[2]} ${name}`;
            const ico = s.status === 'running' ? '<span class="spinner"></span>' : icon(s.status === 'done' ? 'check' : 'x', 'sm');

            return `<li class="${s.status}"><span class="ico">${ico}</span><div class="grow">${esc(text)}
                ${s.message ? `<div class="faint small">${esc(s.message)}</div>` : ''}
                ${s.details ? `<details><summary>What ${esc(name)} said</summary><pre>${esc(s.details)}</pre></details>` : ''}</div></li>`;
        })
        .join('')}</ul>`;
}

/** The closing notes of enable worth reading: restart, trust the hooks, steps by hand. */
function todo(done) {
    const restart = (done?.installed ?? []).map((a) => `${a.restart} to load the plugin.`);
    const notes = (done?.notes ?? []).filter((n) => !/is installed\. /.test(n) && !/^Not signed in/.test(n));

    return [...restart, ...notes];
}

function viewWelcome() {
    const w = state.wizard;
    const agents = state.status?.agents ?? [];
    const found = agents.filter((a) => a.present);
    const stepClass = (n) => {
        const order = { idle: 1, login: 2, connect: 3, done: 4 }[w.phase];
        if (n === 1) return state.loading ? 'running' : 'done';
        if (n === 2) return w.loginError ? 'failed' : order > 2 ? 'done' : order === 2 ? 'running' : 'pending';
        return w.phase === 'done' ? (w.error || w.done?.failed?.length ? 'failed' : 'done') : order === 3 ? 'running' : 'pending';
    };
    const num = (n) => (stepClass(n) === 'done' ? icon('check', 'sm') : stepClass(n) === 'failed' ? icon('x', 'sm') : n);
    const busy = w.phase === 'login' || w.phase === 'connect';
    const steps = todo(w.done);

    if (state.init?.cliError) {
        return `<div class="welcome"><div class="welcome-card"><div class="hero">${brand(26)}<h1>Coders Talk could not start</h1></div>
            ${alertHtml('bad', state.init.cliError)}<p class="muted small">Reinstalling the app usually fixes this.</p></div></div>`;
    }

    return `<div class="welcome"><div class="welcome-card">
        <div class="hero">
            ${brand(26)}
            <h1>${w.phase === 'done' && !w.error ? 'You’re all set' : 'Welcome to Coders Talk'}</h1>
            <p>${w.phase === 'done' && !w.error ? 'Coders Talk now works inside your agents, so you can close this app: nothing needs it running. Open it again to send a session by hand or to change a setting.' : 'Share the AI coding sessions worth learning from. They stay on this computer until you pick one and say yes.'}</p>
        </div>
        <div class="card">
            <ol class="steps">
                <li class="${stepClass(1)}"><span class="num">${num(1)}</span><div class="grow">
                    <div class="title">Find your coding agents</div>
                    ${
                        state.loading && !agents.length
                            ? '<div class="muted small"><span class="spinner"></span> Looking on this computer…</div>'
                            : `<div class="chips">${agents.map((a) => `<span class="chip ${a.present ? '' : 'off'}">${mark(a.id, `sm ${a.present ? '' : 'off'}`)}${esc(a.name)}${a.present ? '' : ' · not installed'}</span>`).join('')}</div>`
                    }
                    ${alertHtml('bad', state.statusError)}
                </div></li>
                <li class="${stepClass(2)}"><span class="num">${num(2)}</span><div class="grow">
                    <div class="title">${w.username ? `Signed in as @${esc(w.username)}` : 'Sign in with your browser'}</div>
                    ${!w.username && w.phase !== 'login' ? `<div class="muted small">Your browser opens ${esc(siteHost())}; you press Connect there. No password is typed here.</div>` : ''}
                    ${
                        w.phase === 'login'
                            ? w.login
                                ? `<div class="code-box"><div class="muted small">Your browser opened. Check that it shows this code, then press <strong>Connect</strong>:</div>
                                <span class="code">${esc(w.login.user_code)}</span>
                                <div class="row small"><button class="link" data-action="open" data-url="${esc(w.login.url)}">Open the page again</button><button class="link" data-action="cancel-login">Cancel</button></div></div>`
                                : '<div class="muted small"><span class="spinner"></span> Opening your browser…</div>'
                            : ''
                    }
                    ${alertHtml('bad', w.loginError)}
                </div></li>
                <li class="${stepClass(3)}"><span class="num">${num(3)}</span><div class="grow">
                    <div class="title">Add Coders Talk to your agents</div>
                    ${w.agents.length ? agentSteps(w.agents) : `<div class="muted small">${found.length ? `Adds a small plugin to ${found.map((a) => esc(a.name)).join(', ')}.` : 'No agent found yet.'}</div>`}
                    ${alertHtml('bad', w.error)}
                </div></li>
            </ol>
        </div>
        ${steps.length ? `<div class="alert warn">${icon('alert', 'sm')}<div class="grow"><strong>One more thing</strong><ul>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div></div>` : ''}
        ${state.update.state === 'ready' ? `<div class="alert ok">${icon('download', 'sm')}<div class="grow">Coders Talk ${esc(state.update.version)} is ready. <button class="link" data-action="install-update">Restart to update</button></div></div>` : ''}
        <div class="welcome-actions">
            ${
                w.phase === 'done' && (w.done?.installed?.length || connectedAgents().length)
                    ? '<button class="btn primary big" data-action="go" data-view="home">Open Coders Talk</button>'
                    : `<button class="btn primary big" data-action="get-started" ${busy || state.loading || !found.length ? 'disabled' : ''}>${busy ? '<span class="spinner"></span> Setting up…' : w.phase === 'done' || w.loginError || w.error ? 'Try again' : 'Get started'}</button>`
            }
        </div>
        <p class="foot">${icon('shield', 'sm')}<span>Nothing is sent while setting up. <button class="link" data-action="open" data-url="${esc(state.status?.what_leaves ?? 'https://coders.talk/plugins#what-leaves-your-machine')}">What leaves your computer</button></span></p>
    </div></div>`;
}

/* ---------- Home ---------- */

function viewHome() {
    const st = state.status;
    if (!st) return `<div class="page">${alertHtml('bad', state.statusError) || '<p class="muted"><span class="spinner"></span> Loading…</p>'}</div>`;
    const acc = state.account;
    const agents = connectedAgents();
    const user = st.account?.username ?? acc?.username;

    let banner;
    if (!st.signed_in || (acc && !acc.ok)) {
        banner = `<div class="banner warn"><span class="dot">${icon('alert', 'sm')}</span><div class="grow"><strong>${st.signed_in ? 'Your sign-in has expired' : 'You are not signed in'}</strong><div class="small muted">Sign in again to send sessions. It opens your browser.</div></div>
            <button class="btn primary" data-action="relogin" ${state.wizard.phase === 'login' ? 'disabled' : ''}>${state.wizard.phase === 'login' ? '<span class="spinner"></span> Waiting…' : 'Sign in'}</button></div>
            ${state.wizard.phase === 'login' && state.wizard.login ? `<div class="code-box under-banner">Check that your browser shows <strong>${esc(state.wizard.login.user_code)}</strong>, then press Connect. <button class="link" data-action="cancel-login">Cancel</button></div>` : ''}`;
    } else if (!agents.length) {
        banner = `<div class="banner warn"><span class="dot">${icon('alert', 'sm')}</span><div class="grow"><strong>No agent is connected</strong><div class="small muted">Switch one on below so Coders Talk can see its sessions.</div></div></div>`;
    } else {
        banner = `<div class="banner ok"><span class="dot">${icon('check', 'sm')}</span><div class="grow"><strong>All set: you can close this window</strong><div class="small muted">Connected to ${agents.map((a) => esc(a.name)).join(', ')}. ${closedNote(agents)}</div></div>
            <button class="btn primary" data-action="go" data-view="sessions">${icon('send', 'sm')} Send a session</button></div>`;
    }

    return `<div class="page">
        <div class="page-head"><h1>${user ? `Hi, @${esc(user)}` : 'Hi there'}</h1></div>
        ${banner}
        <div class="card-head"><p class="eyebrow">Your agents</p><span class="sub">Switch one on to let Coders Talk see its sessions.</span></div>
        <div class="agents">${st.agents.map(agentCard).join('')}</div>
        <p class="eyebrow">Last sent</p>
        ${lastSentCard(st.last_sent)}
        <p class="foot">${icon('shield', 'sm')}<span>${whatLeaves()}</span></p>
    </div>`;
}

/** What keeps working with the window closed: the agents' own plugin, which the app only sets up. */
function closedNote(agents) {
    return agents.some((a) => a.auto !== 'off')
        ? 'Coders Talk works inside them: your agents send sessions on their own.'
        : 'Coders Talk works inside them: send a session from your agent with its build command, or come back here to pick one.';
}

function whatLeaves() {
    const auto = connectedAgents().filter((a) => a.auto !== 'off');
    const text = auto.length
        ? `Sessions from ${auto.map((a) => esc(a.name)).join(', ')} are sent automatically, with secrets hidden first.`
        : 'Only sessions you choose leave this computer, with secrets hidden first.';

    return `${text} <button class="link" data-action="open" data-url="${esc(state.status?.what_leaves ?? 'https://coders.talk/plugins#what-leaves-your-machine')}">What leaves your computer</button>`;
}

function agentCard(a) {
    const op = state.agentOp?.agent === a.id ? state.agentOp : null;
    const plugin = a.plugins.find((p) => p.source === 'local') ?? a.plugins[0];
    const busy = Boolean(state.agentOp && !state.agentOp.finished);
    const canSwitch = a.present && a.can_install && (a.managed || !a.connected) && !busy;
    // While it works, the switch stays where the person put it.
    const on = op && !op.finished ? op.target : a.connected;
    let line;
    if (!a.present) line = 'Not installed on this computer';
    else if (op && !op.finished) line = '<span class="spinner"></span> Working…';
    else if (a.connected) line = `${a.auto === 'off' ? 'Connected' : 'Connected · sends automatically'}${plugin?.source === 'directory' ? ' · from Claude’s plugin directory' : ''}`;
    else line = a.can_install ? 'Off' : 'Found, but it needs a manual step';
    const note = a.outdated ? 'An update is ready: switch it off and on to install it.' : (a.notes ?? [])[0];

    return `<div class="agent ${a.present ? '' : 'absent'}">
        <div class="row">${mark(a.id, a.present ? '' : 'off')}<div class="grow"><div class="name">${esc(a.name)}</div><div class="state">${line}</div></div>
            <label class="switch" title="${on ? 'Disconnect' : 'Connect'} ${esc(a.name)}"><input type="checkbox" aria-label="${esc(a.name)}" data-action="toggle-agent" data-agent="${esc(a.id)}" ${on ? 'checked' : ''} ${canSwitch ? '' : 'disabled'}><span></span></label></div>
        ${note && a.present ? `<div class="note">${esc(note)}</div>` : ''}
        ${op ? agentSteps(op.steps.filter((s) => s.status === 'failed')) + alertHtml('bad', op.error) + (op.todo.length ? alertHtml('warn', op.todo.join(' ')) : '') : ''}
    </div>`;
}

function lastSentCard(last) {
    if (!last) {
        return `<div class="card"><div class="row">${icon('inbox')}<div class="grow"><strong>Nothing sent yet</strong><div class="small muted">Your first session will show up here.</div></div>
            <button class="btn" data-action="go" data-view="sessions">Pick a session</button></div></div>`;
    }
    const where = last.space?.type === 'team' ? `the ${esc(last.space.name)} team` : last.space?.type === 'personal' ? 'your private drafts' : null;

    return `<div class="card"><div class="row">${mark(last.agent ?? 'claude-code')}<div class="grow"><strong>Last sent ${esc(ago(last.at))}</strong>
        <div class="small muted">${esc(agentName(last.agent ?? 'claude-code'))} session${where ? ` to ${where}` : ''}${last.how === 'auto' ? ', automatically' : ''}</div></div>
        ${last.url ? `<button class="btn" data-action="open" data-url="${esc(last.url)}">Open draft ${icon('out', 'sm')}</button>` : ''}</div></div>`;
}

async function toggleAgent(id, on) {
    const op = { agent: id, target: on, steps: [], error: null, todo: [], finished: false };
    state.agentOp = op;
    render();
    const r = await call('setAgent', { agent: id, on }, (e) => onAgentEvent(e, op.steps));
    const last = r.events.at(-1);
    if (!r.ok) op.error = friendly(r.error);
    op.todo = on ? todo(last) : [];
    op.finished = true;
    const worked = !op.error && !op.steps.some((s) => s.status === 'failed');
    if (worked) {
        // The switch lands at once: reading the status again takes the agents' own commands a second or more, and
        // until then the old status would put it back where it was.
        const agent = state.status?.agents.find((a) => a.id === id);
        if (agent) Object.assign(agent, { connected: on, managed: on, outdated: false, notes: [], plugins: on ? [{ id: 'coders-talk@coders-talk-local', version: state.status.version, source: 'local' }] : [] });
        toast(on ? `${agentName(id)} connected` : `${agentName(id)} disconnected`);
        if (!op.todo.length) state.agentOp = null;
    }
    render();
    await loadStatus({ quiet: true });
}

async function relogin() {
    const w = state.wizard;
    w.phase = 'login';
    w.login = null;
    render();
    const r = await call('login', {}, (e) => {
        if (e.event === 'opened') {
            w.login = e;
            render();
        }
    });
    w.phase = 'idle';
    if (r.ok) toast('Signed in');
    else if (!r.cancelled) toast(friendly(r.error), 'bad');
    await loadStatus({ quiet: true });
    await checkAccount();
}

/* ---------- Sessions ---------- */

function filteredSessions() {
    const s = state.sessions;
    const q = s.query.trim().toLowerCase();

    return (s.list ?? []).filter((x) => (s.agent === 'all' || x.agent === s.agent) && (!q || `${x.title ?? ''} ${x.first_prompt} ${x.project ?? ''}`.toLowerCase().includes(q)));
}

function viewSessions() {
    const s = state.sessions;
    const list = filteredSessions();
    const agentsHere = [...new Set((s.list ?? []).map((x) => x.agent))];
    const groups = [];
    for (const x of list) {
        const day = dayOf(x.last_active);
        if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
        groups.at(-1).items.push(x);
    }
    const folderName = s.folder?.split(/[\\/]/).filter(Boolean).at(-1);

    let body;
    if (s.error) body = alertHtml('bad', s.error);
    else if (s.loading && !s.list) body = `<div class="list">${'<div class="skeleton"></div>'.repeat(5)}</div>`;
    else if (!list.length) {
        body = `<div class="list"><div class="empty">${icon(s.query ? 'search' : 'inbox')}<div><strong>${s.query ? 'No sessions match' : 'No sessions yet'}</strong></div>
            <div class="small">${s.query ? 'Try other words.' : s.folder ? 'No Claude Code, Codex, Cursor or Pi sessions in this folder.' : 'Sessions from the last 30 days show up here once you work with a connected agent.'}</div></div></div>`;
    } else {
        body = groups.map((g) => `<p class="eyebrow group">${esc(g.day)}</p><div class="list">${g.items.map(sessionRow).join('')}</div>`).join('');
    }

    return `<div class="page">
        <div class="page-head"><h1>Sessions</h1><p class="sub">Your recent AI coding sessions. Pick one to send: you see what goes and who can see it before anything leaves.</p></div>
        <div class="toolbar">
            <div class="search">${icon('search', 'sm')}<input id="search" class="text" type="search" placeholder="Search sessions" value="${esc(s.query)}" data-action="search" autocomplete="off"></div>
            ${agentsHere.length > 1 ? `<div class="pills">${['all', ...agentsHere].map((a) => `<button class="${s.agent === a ? 'on' : ''}" data-action="filter-agent" data-agent="${esc(a)}">${a === 'all' ? 'All' : esc(agentName(a))}</button>`).join('')}</div>` : ''}
            <button class="btn ghost icon" title="Refresh" data-action="refresh-sessions" ${s.loading ? 'disabled' : ''}>${s.loading ? '<span class="spinner"></span>' : icon('refresh', 'sm')}</button>
        </div>
        <div class="folder-pill muted">${icon('folder', 'sm')}${s.folder ? `Only <strong>${esc(folderName)}</strong> <button class="link" data-action="all-folders">Show all projects</button>` : `All projects, last 30 days · <button class="link" data-action="choose-folder">Pick a folder</button>`}</div>
        ${body}
    </div>`;
}

function sessionRow(x) {
    const what = x.title || x.first_prompt || 'Untitled session';
    const project = x.project ?? state.sessions.folder?.split(/[\\/]/).filter(Boolean).at(-1);

    return `<div class="session">
        ${mark(x.agent, 'sm')}
        <div class="grow">
            <div class="what" title="${esc(what)}">${esc(what)}</div>
            <div class="meta">${project ? `<span>${esc(project)}</span><span class="sep"></span>` : ''}<span class="when">${esc(time(x.last_active))}</span><span class="sep"></span><span>${plural(x.prompts, 'prompt')}</span>
                ${x.sent_at ? `<span class="sep"></span>${x.draft_url ? `<button class="link" data-action="open" data-url="${esc(x.draft_url)}">Sent ${esc(ago(x.sent_at))}</button>` : `<span class="badge ok">Sent</span>`}` : ''}</div>
        </div>
        <button class="btn ${x.sent_at ? '' : 'primary'}" data-action="send-session" data-id="${esc(x.id)}" data-agent="${esc(x.agent)}">${x.sent_at ? 'Send again' : 'Send…'}</button>
    </div>`;
}

async function chooseFolder() {
    const r = await call('chooseFolder');
    if (!r) return;
    Object.assign(state.sessions, { folder: r.folder, list: null });
    loadSessions();
}

/* ---------- Confirmation ---------- */

async function openConfirm(id, agent) {
    const session = state.sessions.list?.find((s) => s.id === id && s.agent === agent);
    if (!session) return;
    state.confirm = { session, folder: session.folder ?? state.sessions.folder, preview: null, loading: true, error: null, sending: false, stage: null, progress: 0, done: null, sendError: null };
    state.view = 'confirm';
    render();
    await runPreview(null);
}

async function runPreview(space) {
    const c = state.confirm;
    c.loading = true;
    c.error = null;
    render();
    const r = await call('preview', { id: c.session.id, agent: c.session.agent, folder: c.folder, space });
    if (state.confirm !== c) return;
    c.loading = false;
    c.preview = r.ok ? r.result : null;
    c.error = r.ok ? null : friendly(r.error);
    render();
}

/** Leaving the confirmation without sending: what preview prepared goes now. */
async function leaveConfirm(view = 'sessions') {
    const c = state.confirm;
    state.confirm = null;
    state.view = view;
    render();
    if (c && !c.done && !c.sending) await call('discard', { id: c.session.id, agent: c.session.agent });
    if (c?.done) loadSessions({ quiet: true });
}

async function sendConfirmed() {
    const c = state.confirm;
    if (!c?.preview || c.sending || c.done || !c.preview.connected) return;
    Object.assign(c, { sending: true, sendError: null, stage: 'Sending the checked session…', progress: 15 });
    render();
    const r = await call('send', { id: c.session.id }, (e) => {
        if (e.event === 'created') Object.assign(c, { stage: 'Sent. Coders Talk is preparing your draft…', progress: 45, editUrl: e.edit_url, space: e.space });
        else if (e.event === 'stage') Object.assign(c, { stage: e.minutes ? `${e.label}… a long session takes about ${e.minutes} minutes` : `${e.label}…`, progress: Math.min(90, c.progress + 15) });
        else if (e.event === 'pending' || e.event === 'done') Object.assign(c, { progress: 100, result: e });
        render();
    });
    c.sending = false;
    if (r.ok) {
        c.done = { editUrl: c.editUrl, team: c.space?.type === 'team' ? c.space.name : null, pending: c.result?.event === 'pending' };
        loadStatus({ quiet: true });
    } else {
        c.sendError = friendly(r.error);
        // A send that never reached the site needs a fresh check before trying again.
        if (!c.editUrl) c.preview = null;
    }
    render();
}

function viewConfirm() {
    const c = state.confirm;
    const s = c.session;
    const p = c.preview;
    const what = s.title || s.first_prompt || 'Untitled session';
    const head = `<button class="back" data-action="cancel-confirm">${icon('back', 'sm')} Sessions</button>
        <h1>${esc(what)}</h1>
        <div class="metas">${mark(s.agent, 'sm')}<span>${esc(agentName(s.agent))}</span>${s.project ? `<span class="sep"></span><span>${esc(s.project)}</span>` : ''}${p ? `<span class="sep"></span><span>${plural(p.prompts, 'prompt')}</span><span class="sep"></span><span>${esc(p.duration)}</span>` : ''}</div>`;

    if (c.done) {
        return `<div class="page">${head}<div class="card success mt">
            <div class="big-check">${icon('check')}</div>
            <h1>Your draft is ready</h1>
            <p class="muted">${c.done.team ? `It is in the ${esc(c.done.team)} team’s drafts: only the team can see it.` : 'It is in your private drafts: only you can see it.'} Nothing is published until you do it on the site.</p>
            <div class="welcome-actions">${c.done.editUrl ? `<button class="btn primary big" data-action="open" data-url="${esc(c.done.editUrl)}">Review and publish ${icon('out', 'sm')}</button>` : ''}<button class="btn big" data-action="cancel-confirm">Back to sessions</button></div>
        </div></div>`;
    }
    if (c.loading && !p) {
        return `<div class="page">${head}<div class="card mt"><div class="check-head"><span class="spinner"></span><div><strong>Checking the session for secrets…</strong><div class="small muted">On this computer. Nothing has left yet.</div></div></div></div></div>`;
    }
    if (!p) {
        return `<div class="page">${head}<div class="mt">${alertHtml('bad', c.error ?? c.sendError)}</div>
            <div class="row"><button class="btn" data-action="cancel-confirm">Back</button><button class="btn primary" data-action="retry-preview">Check again</button></div></div>`;
    }

    const findings = p.privacy.findings;
    const teams = p.goes_to.teams;
    const current = p.goes_to.space === 'team' ? p.goes_to.team?.slug : 'personal';
    const team = p.goes_to.space === 'team' ? p.goes_to.team?.name : null;
    const locked = c.loading || c.sending;

    const audience = teams
        ? `<div class="choices">
            <button class="choice ${current === 'personal' ? 'on' : ''}" data-action="space" data-space="personal" ${locked ? 'disabled' : ''}>${icon('lock', 'sm')}<span><strong>Only me</strong><div class="small muted">Private draft</div></span></button>
            ${teams.map((t) => `<button class="choice ${current === t.slug ? 'on' : ''}" data-action="space" data-space="${esc(t.slug)}" ${locked ? 'disabled' : ''}>${icon('users', 'sm')}<span><strong>${esc(t.name)}</strong><div class="small muted">Team draft</div></span></button>`).join('')}
        </div>`
        : `<p>${esc(capital(p.goes_to.text))}.</p>`;

    return `<div class="page">
        ${head}
        <div class="gap"></div>
        <div class="card">
            <h2>Who can see it</h2>
            <p class="small muted">${team ? `Members of ${esc(team)} can see the draft. Nobody else.` : 'Only you can see the draft.'} It is not published until you publish it on the site.${p.draft_url ? ' You sent this session before: your draft is updated, not duplicated.' : ''}</p>
            ${audience}
            ${c.loading ? '<p class="small muted mt-s"><span class="spinner"></span> Updating…</p>' : ''}
        </div>

        <div class="card">
            <div class="check-head">
                <span class="check-icon ${findings.length ? 'warn' : 'ok'}">${icon(findings.length ? 'shield' : 'shieldCheck')}</span>
                <div class="grow"><h2>${findings.length ? `${plural(findings.length, 'possible secret')} found and hidden` : 'No secrets found'}</h2>
                <div class="small muted">${findings.length ? 'They are replaced on this computer. The real values never leave it.' : 'The check found no keys, tokens or email addresses.'}</div></div>
            </div>
            ${
                findings.length
                    ? `<ul class="findings">${findings.map((f) => `<li><span class="grow">${esc(capital(f.label))}${f.count > 1 ? ` <span class="faint small">· ${f.count} places</span>` : ''}</span><span class="badge ${f.kept ? 'warn' : 'ok'}">${f.kept ? 'Sent as is (your choice)' : `${icon('check', 'sm')} Hidden`}</span></li>`).join('')}</ul>`
                    : ''
            }
            <p class="small faint mt-s m0">The check catches common patterns, not everything. You read the draft before anyone else can. Names to always hide go in <button class="link" data-action="go" data-view="settings">Settings</button>.</p>
        </div>

        <div class="card">
            <details class="more"><summary>What’s included</summary>
                <dl class="facts">
                    <dt>Project</dt><dd>${esc(p.project ?? 'unknown')} <span class="faint">(name only, never the path)</span></dd>
                    ${p.folders.length ? `<dt>Added folders</dt><dd>${p.folders.map(esc).join(', ')}</dd>` : ''}
                    <dt>Conversation</dt><dd>${plural(p.prompts, 'prompt')}, ${plural(p.tool_calls, 'tool call')}, over ${esc(p.duration)}</dd>
                    <dt>Size</dt><dd>${esc(p.size.compressed)} (screenshots and long outputs left out)</dd>
                    ${p.git.map((g) => `<dt>Git</dt><dd>${esc(g)}</dd>`).join('')}
                    ${p.code ? `<dt>Code changes</dt><dd>${esc(p.code)}</dd>` : ''}
                    ${p.tokens ? `<dt>Tokens</dt><dd>${esc(p.tokens)}</dd>` : ''}
                    ${p.library ? `<dt>Library</dt><dd>${esc(p.library)}</dd>` : ''}
                    ${p.includes.length ? `<dt>Includes</dt><dd>${plural(p.includes.length, 'earlier session')} it continued</dd>` : ''}
                </dl>
            </details>
        </div>

        ${alertHtml('bad', c.sendError)}
        ${!p.connected ? alertHtml('warn', 'You are not signed in. Sign in from Home, then come back.') : ''}

        <div class="bar">
            ${
                c.sending
                    ? `<div class="grow"><div class="small"><span class="spinner"></span> ${esc(c.stage)}</div><progress class="progress" max="100" value="${c.progress}"></progress></div>`
                    : `<div class="grow small faint note">${icon('shield', 'sm')} Nothing has left your computer yet.</div>
                       <button class="btn" data-action="cancel-confirm">Cancel <span class="kbd">Esc</span></button>
                       <button class="btn primary big" data-action="confirm-send" ${c.loading || !p.connected ? 'disabled' : ''}>${icon('send', 'sm')} ${team ? `Send to ${esc(team)}` : 'Send to my drafts'}</button>`
            }
        </div>
    </div>`;
}

/* ---------- Settings ---------- */

function viewSettings() {
    const st = state.status;
    if (!st) return `<div class="page">${alertHtml('bad', state.statusError) || '<p class="muted"><span class="spinner"></span> Loading…</p>'}</div>`;
    const set = state.settings;
    const agents = connectedAgents();
    const modes = [...new Set(agents.map((a) => a.auto))];
    const mode = modes.length === 1 ? modes[0] : null;

    return `<div class="page">
        <div class="page-head"><h1>Settings</h1><p class="sub">These apply on this computer.</p></div>

        <div class="card">
            <h2>When to send sessions</h2>
            ${agents.length ? '' : '<p class="small muted">Connect an agent on Home first.</p>'}
            ${SEND_MODES.map(
                (c) => `<label class="option"><input type="radio" name="auto" value="${c.mode}" data-action="auto" ${mode === c.mode ? 'checked' : ''} ${!agents.length || set.busy ? 'disabled' : ''}>
                <span class="grow"><strong>${c.title}</strong> ${c.tag ? `<span class="badge accent">${c.tag}</span>` : ''}<div class="small muted">${c.text}</div></span></label>`,
            ).join('')}
            ${mode === 'push' ? '<p class="small muted mt-s">Right now: only when you push commits (set from the terminal).</p>' : ''}
            ${modes.length > 1 ? `<p class="small muted mt-s">Right now it differs per agent. Picking one applies it to all.</p>` : ''}
        </div>

        <div class="card">
            <h2>In your sessions</h2>
            <div class="setting mt-s"><div class="grow"><strong>Add my rules to new sessions</strong>
                <div class="small muted">Your agent starts with the coding rules you keep on Coders Talk for this kind of project. No code is sent to pick them.</div></div>
                <label class="switch"><input type="checkbox" aria-label="Add my rules" data-action="rules" ${st.rules ? 'checked' : ''} ${set.busy ? 'disabled' : ''}><span></span></label></div>
            <div class="setting"><div class="grow"><strong>Suggest sharing helpful sessions</strong>
                <div class="small muted">When a session used ideas from the library, your agent offers once to share it. It never sends anything itself.</div></div>
                <label class="switch"><input type="checkbox" aria-label="Suggest sharing" data-action="nudge" ${st.nudge ? 'checked' : ''} ${set.busy ? 'disabled' : ''}><span></span></label></div>
        </div>

        <div class="card">
            <h2>Always hide these words</h2>
            <p class="small muted">Client names, internal services, anything private. They’re replaced before a session leaves this computer.</p>
            ${st.privacy.error ? alertHtml('bad', st.privacy.error) : ''}
            <div class="words" data-action="focus-words">
                ${st.privacy.words.map((w) => `<span class="word">${esc(w)}<button title="Remove" aria-label="Remove ${esc(w)}" data-action="remove-word" data-word="${esc(w)}">×</button></span>`).join('')}
                <input id="word-input" data-action="word-input" placeholder="${st.privacy.words.length ? 'Add another…' : 'Type a word and press Enter'}" value="${esc(set.input)}" ${set.busy === 'words' ? 'disabled' : ''} autocomplete="off" spellcheck="false">
            </div>
        </div>

        <div class="card">
            <div class="setting"><div class="grow"><h2>Coders Talk ${esc(state.init?.app ?? '')}</h2>
                <div class="small muted">${esc(updateLine(state.update)) || 'Updates are checked when the app starts and every few hours, and install when you restart it.'}</div></div>
                ${
                    state.update.state === 'ready'
                        ? '<button class="btn primary" data-action="install-update">Restart to update</button>'
                        : `<button class="btn" data-action="check-updates" ${['off', 'store', 'checking', 'downloading'].includes(state.update.state) ? 'disabled' : ''}>${state.update.state === 'checking' ? '<span class="spinner"></span> Checking…' : 'Check for updates'}</button>`
                }</div>
            <p class="small faint mt-s m0">Command line ${esc(st.version)} · ${esc(siteHost())} · <button class="link" data-action="open" data-url="${esc(st.what_leaves)}">What leaves your computer</button></p>
        </div>

        <div class="card">
            <div class="setting"><div class="grow"><h2>Disconnect this computer</h2>
                <div class="small muted">Removes Coders Talk from your agents and signs out here. Your drafts stay on the site.</div></div>
                <button class="btn danger" data-action="disconnect" ${set.busy ? 'disabled' : ''}>${set.busy === 'disconnect' ? '<span class="spinner"></span> Disconnecting…' : 'Disconnect'}</button></div>
        </div>
    </div>`;
}

async function setting(name, work, done) {
    const set = state.settings;
    set.busy = name;
    render();
    const r = await work();
    set.busy = null;
    await loadStatus({ quiet: true });
    toast(r.ok ? done : friendly(r.error), r.ok ? '' : 'bad');

    return r;
}

function saveWords(words) {
    return setting('words', () => call('setWords', { words }), 'Saved');
}

async function disconnect() {
    const yes = await call('confirm', {
        message: 'Disconnect this computer from Coders Talk?',
        detail: 'Coders Talk is removed from your agents and you are signed out here. Your drafts and Builds stay on the site.',
        yes: 'Disconnect',
    });
    if (!yes) return;
    const r = await setting('disconnect', () => call('disconnect', {}, () => {}), 'Disconnected');
    if (r.ok) {
        state.wizard = { phase: 'idle', login: null, loginError: null, agents: [], error: null, done: null };
        state.account = null;
        state.view = 'welcome';
        render();
    }
}

/* ---------- frame ---------- */

/** The sidebar's word about an update: while it downloads, and the button to restart once it is ready. */
function updateBadge() {
    const u = state.update;
    if (u.state === 'downloading') return `<div class="update" title="Downloading update ${esc(u.version ?? '')}">${icon('download', 'sm')}<span>Downloading update… ${u.percent ?? 0}%</span></div>`;
    if (u.state !== 'ready') return '';

    return `<button class="update ready" data-action="install-update" title="Restart to update to ${esc(u.version)}">${icon('refresh', 'sm')}<span><strong>Update ready</strong>Restart to get ${esc(u.version)}</span></button>`;
}

function sidebar() {
    const tabs = [
        ['home', 'Home', 'home'],
        ['sessions', 'Sessions', 'list'],
        ['settings', 'Settings', 'gear'],
    ];
    const active = state.view === 'confirm' ? 'sessions' : state.view;
    const user = state.status?.account?.username;
    const expired = state.account && !state.account.ok;

    return `<aside class="side">
        ${brand(20)}
        <nav class="nav">${tabs.map(([v, label, ico]) => `<button class="${active === v ? 'on' : ''}" data-action="go" data-view="${v}" title="${label}">${icon(ico)}<span>${label}</span></button>`).join('')}</nav>
        ${updateBadge()}
        <div class="side-foot"><span class="avatar">${esc((user ?? '?').charAt(0).toUpperCase())}</span><div class="who"><div><strong>${user ? `@${esc(user)}` : 'Not signed in'}</strong></div>
            <div class="${expired ? 'warn-text' : 'faint host'}">${expired ? 'Sign-in expired' : esc(siteHost())}</div></div>
            ${state.loading ? '<span class="spinner"></span>' : ''}</div>
    </aside>`;
}

function render() {
    const root = document.getElementById('app');
    if (state.view === 'boot') return;
    // Keep the focus and the caret where the person was typing.
    const active = document.activeElement?.id;
    const caret = active ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    const scroll = root.querySelector('.main')?.scrollTop ?? 0;
    const views = { home: viewHome, sessions: viewSessions, confirm: viewConfirm, settings: viewSettings };
    const toasts = `<div class="toasts" role="status">${state.toasts.map((t) => `<div class="toast ${t.kind}">${icon(t.kind === 'bad' ? 'alert' : 'check', 'sm')}${esc(t.text)}</div>`).join('')}</div>`;
    root.innerHTML = state.view === 'welcome' ? viewWelcome() + toasts : `<div class="shell">${sidebar()}<main class="main">${views[state.view]()}</main></div>${toasts}`;
    const main = root.querySelector('.main');
    if (main) main.scrollTop = scroll;
    if (active) {
        const el = document.getElementById(active);
        if (el && !el.disabled) {
            el.focus();
            if (caret && el.setSelectionRange && caret[0] !== null) el.setSelectionRange(...caret);
        }
    }
}

/* ---------- events ---------- */

function go(view) {
    if (state.view === 'confirm' && view !== 'confirm') return leaveConfirm(view);
    state.view = view;
    render();
    document.querySelector('.main')?.scrollTo(0, 0);
    if (view === 'sessions' && !state.sessions.list) loadSessions();
    if (view === 'home' && state.status?.signed_in && !state.account) checkAccount();
}

document.addEventListener('click', async (event) => {
    const el = event.target.closest('[data-action]');
    if (!el || el.tagName === 'INPUT') return;
    const { action } = el.dataset;
    if (action === 'go') go(el.dataset.view);
    else if (action === 'open') call('open', { url: el.dataset.url });
    else if (action === 'get-started') getStarted();
    else if (action === 'cancel-login') call('cancelLogin');
    else if (action === 'relogin') relogin();
    else if (action === 'choose-folder') chooseFolder();
    else if (action === 'all-folders') {
        Object.assign(state.sessions, { folder: null, list: null });
        loadSessions();
    } else if (action === 'refresh-sessions') loadSessions();
    else if (action === 'filter-agent') {
        state.sessions.agent = el.dataset.agent;
        render();
    } else if (action === 'send-session') openConfirm(el.dataset.id, el.dataset.agent);
    else if (action === 'cancel-confirm') leaveConfirm('sessions');
    else if (action === 'retry-preview') runPreview(null);
    else if (action === 'space') runPreview(el.dataset.space);
    else if (action === 'confirm-send') sendConfirmed();
    else if (action === 'remove-word') saveWords(state.status.privacy.words.filter((w) => w !== el.dataset.word));
    else if (action === 'focus-words') document.getElementById('word-input')?.focus();
    else if (action === 'disconnect') disconnect();
    else if (action === 'check-updates') checkUpdates();
    else if (action === 'install-update') call('installUpdate');
});

document.addEventListener('change', (event) => {
    const el = event.target;
    const { action } = el.dataset ?? {};
    if (action === 'toggle-agent') toggleAgent(el.dataset.agent, el.checked);
    else if (action === 'auto') setting('auto', () => call('setAuto', { mode: el.value, agents: connectedAgents().map((a) => a.id) }), 'Saved');
    else if (action === 'rules') setting('rules', () => call('setRules', { on: el.checked }), el.checked ? 'Rules on' : 'Rules off');
    else if (action === 'nudge') setting('nudge', () => call('setNudge', { on: el.checked }), 'Saved');
});

document.addEventListener('input', (event) => {
    const { action } = event.target.dataset ?? {};
    if (action === 'search') {
        state.sessions.query = event.target.value;
        render();
    } else if (action === 'word-input') state.settings.input = event.target.value;
});

document.addEventListener('keydown', (event) => {
    const el = event.target;
    if (el.dataset?.action === 'word-input') {
        const word = el.value.replace(/,$/, '').trim();
        if ((event.key === 'Enter' || event.key === ',') && word) {
            event.preventDefault();
            state.settings.input = '';
            if (!state.status.privacy.words.includes(word)) saveWords([...state.status.privacy.words, word]);
            else render();
        } else if (event.key === 'Backspace' && !el.value && state.status.privacy.words.length) {
            saveWords(state.status.privacy.words.slice(0, -1));
        }
        return;
    }
    if (state.view === 'confirm') {
        if (event.key === 'Escape' && !state.confirm?.sending) leaveConfirm('sessions');
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) sendConfirmed();
    }
});

// Back to the window after a while: what changed meanwhile (an agent's session, a send by auto mode) shows up.
window.addEventListener('focus', () => {
    if (state.view === 'boot' || state.view === 'welcome' || Date.now() - state.loadedAt < REFRESH_ON_FOCUS_MS) return;
    loadStatus({ quiet: true });
    if (state.view === 'sessions') loadSessions({ quiet: true });
});

boot();
