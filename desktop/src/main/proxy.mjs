/**
 * The system's proxy, for the keepplain program the app runs. A VPN client in system-proxy mode (v2rayN, Clash,
 * Hiddify and the like) sets a proxy in the system settings instead of taking all traffic: the window follows it, as
 * Chromium does, but keepplain reads only the environment (HTTPS_PROXY, lib/http.mjs). So before each command the
 * main process asks Chromium which proxy the site goes through (session.resolveProxy: "PROXY 127.0.0.1:10809",
 * "SOCKS5 127.0.0.1:1080; DIRECT", "DIRECT") and hands it on in those variables. A VPN that takes all traffic needs
 * nothing: the connection goes through it anyway. No Electron here: the tests load this file under Node.
 */

const NAMED = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY'];

/**
 * The variables for a resolveProxy answer: {HTTPS_PROXY, HTTP_PROXY, NO_PROXY} or {} for a direct connection. A proxy the
 * person named in the environment stays theirs. Chromium's "SOCKS" is SOCKS4 in PAC terms; the VPN clients that put a
 * SOCKS proxy in the Windows settings serve SOCKS5 on that port, so it goes as socks5.
 */
export function proxyVariables(rule, env = process.env) {
    if (NAMED.some((name) => env[name] || env[name.toLowerCase()])) return {};
    const first = String(rule ?? '').split(';')[0].trim();
    const match = first.match(/^(PROXY|HTTPS|SOCKS5|SOCKS)\s+(\S+)$/i);
    if (!match) return {};
    const scheme = { PROXY: 'http', HTTPS: 'https', SOCKS5: 'socks5', SOCKS: 'socks5' }[match[1].toUpperCase()];
    const url = `${scheme}://${match[2]}`;

    // The agents' own commands that keepplain runs (claude, codex) read them too: this computer stays direct for them.
    return { HTTPS_PROXY: url, HTTP_PROXY: url, ...(env.NO_PROXY || env.no_proxy ? {} : { NO_PROXY: 'localhost,127.0.0.1,::1' }) };
}

/** The environment for one command: $env with the proxy $resolve gives $site, or $env as it is when asking fails. */
export async function withSystemProxy(env, site, resolve) {
    try {
        return { ...env, ...proxyVariables(await resolve(site), env) };
    } catch {
        return env;
    }
}
