# Coders Talk for Claude Code and Codex

Send the Claude Code or Codex session you are in to [Coders Talk](https://coders.talk) as a draft Build: the prompts, interventions and fails that mattered, with the raw log one layer down. The plugin never publishes. You review every moment and publish on the site.

## Install

1. In Claude Code:

   ```
   /plugin marketplace add coders-talk/coders-talk-plugin
   /plugin install coders-talk@coders-talk
   ```

2. Connect it to your account: `/coders-talk:login`. It opens coders.talk in the browser; check that the page shows the same code as Claude Code and press Connect. The plugin receives its token directly from the site and keeps it in `~/.coders-talk/credentials.json`. There is no token to copy, and it never passes through the chat.

Needs Node.js 20 or newer, nothing else.

### Codex

```
codex plugin marketplace add coders-talk/coders-talk-plugin
codex plugin add coders-talk@coders-talk
```

Start a new session, then `$coders-talk:login` and `$coders-talk:build` (the same four commands as below, with `$` instead of `/`). Codex asks to run the plugin's command outside its sandbox: it needs the network to reach coders.talk and your home folder for the sign-in. The session is found through `CODEX_THREAD_ID` in `~/.codex/sessions` (or `CODEX_HOME`), and HEAD at its start comes from the rollout's `session_meta`, so Codex gets no hook.

One repository serves both agents: Claude Code reads `.claude-plugin/` and `skills/`, Codex reads `.codex-plugin/`, `.agents/plugins/marketplace.json` and `codex/skills/` (its manifest turns off `hooks/hooks.json`). Codex does not expand `${CLAUDE_PLUGIN_ROOT}` or `${CLAUDE_SESSION_ID}` in skills, so its skills give the script path relative to the skill file and pass `--agent=codex`.

## Use

| Command | What it does |
| --- | --- |
| `/coders-talk:build` | Shows what would be sent (project folder, prompts, time span, size), asks, sends, prints the draft link. |
| `/coders-talk:share` | The same. |
| `/coders-talk:login` | Connects this computer through the browser, or says which account it is connected to. |
| `/coders-talk:logout` | Forgets the token on this computer (revoke it on the site under Settings → Agent plugins). |

Sending the same session again updates its draft until you publish it. The commands run only when you type them: Claude does not invoke them on its own.

## What leaves your machine

- Only the session you run the command in, and only after you confirm.
- The session `.jsonl` without screenshots, thinking blocks and the agent's bookkeeping lines, with tool output cut to 60 lines, gzipped. The plugin's own run is cut off the end. Big files are read line by line: a 417 MB Codex rollout full of screenshots goes as about 200 KB.
- If the session ran in a git repository: the `origin` address when it is on GitHub, the branch, and the titles and size (files, +/−) of the commits the session made. Never the diff. In Claude Code a `SessionStart` hook remembers `HEAD` at the start of each session in `~/.coders-talk/sessions/` for this; it sends nothing and prints nothing.
- Keys, tokens and connection strings are redacted on the server before any model sees the session; publishing waits until you have checked each finding.
- The token can only start imports. Revoke it in Settings at any time.

## Configuration

| Setting | Where | Default |
| --- | --- | --- |
| Site address | `CODERS_TALK_URL`, or in Claude Code the plugin option `url` (asked when the plugin is enabled). In Codex set the variable in `~/.codex/config.toml`: `[shell_environment_policy]` `set = { CODERS_TALK_URL = "https://…" }` | `https://coders.talk` |
| Token | `/coders-talk:login` saves one per site; `CODERS_TALK_TOKEN` overrides it (for CI, or a token made in Settings by hand) | none |
| Data folder | `CODERS_TALK_HOME` | `~/.coders-talk` |

The script reads the `url` option from Claude Code's own `settings.json` (`pluginConfigs`). It does not rely on `${user_config.url}` in the skills or on `CLAUDE_PLUGIN_OPTION_*` variables: in testing, the desktop app left the placeholder unexpanded and the variable did not reach commands the model runs.

## Development

```
npm test                              # node --test, no dependencies
claude plugin validate . --strict
claude --plugin-dir .                 # try it in a real session
```

`scripts/lib/slim.mjs` and `test/fixtures/slim` are generated from the site repository (`resources/js/lib/slimSession.ts`), so the plugin trims sessions exactly like the site's upload page and server do. Change them there, then run `npm run plugin:sync` in the site repository.

API used: `POST /api/v1/device/codes` and `POST /api/v1/device/token` (browser sign-in, no token needed), `POST /api/v1/imports` (multipart: `file`, `agent`, `session_id`, `client_version`), `GET /api/v1/imports/{id}`, `GET /api/v1/me`, with `Authorization: Bearer <token>`. Errors come as `{"error": {"code", "message"}}`.
