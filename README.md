# Coders Talk for Claude Code and Codex

Send the Claude Code or Codex session you are in to [Coders Talk](https://coders.talk) as a draft Build: the prompts, interventions and fails that mattered, with the raw log one layer down. The plugin never publishes. The draft is private: only you see it, or your team when the session ran in one of the team's repositories. You review every moment on the site and publish it there if you want to.

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
| `/coders-talk:build` | Shows what would be sent (project folder, prompts, time span, size) and where it goes, asks, sends, prints the draft link. |
| `/coders-talk:build --private` | The same, and the draft stays yours even in a team's repository. |
| `/coders-talk:build --team <slug>` | The same, and the draft goes to that team (the part after `/t/` in the team's link). |
| `/coders-talk:share` | The same. |
| `/coders-talk:auto on` | Claude Code only: from now on every session on this computer is sent by itself while it runs and when it ends (see Auto mode). |
| `/coders-talk:auto team` | The same, only for sessions in repositories of teams that ask for it. |
| `/coders-talk:auto off` | Stops it. `/coders-talk:auto` alone says whether it is on and what it last sent. |
| `/coders-talk:login` | Connects this computer through the browser, or says which account it is connected to. |
| `/coders-talk:logout` | Forgets the token on this computer (revoke it on the site under Settings → Agent plugins). |

Sending the same session again updates its draft until you publish it. The commands run only when you type them: Claude does not invoke them on its own.

### Auto mode

Off until you turn it on, per computer and per site. With `/coders-talk:auto on`, each Claude Code session is sent the way `/coders-talk:build` would send it, without asking: to your team's space when the repository is one of your team's, else to your private Builds. With `/coders-talk:auto team`, only sessions in repositories of teams that ask for it (a team setting) are sent, and nothing else leaves the machine. A team can ask; it can never switch this on for you.

Three hooks do the sending, each in a background process so the agent never waits for an upload:

- `Stop`, after an answer of the agent: when the session grew and the last send is ten minutes old, it is sent as still going. The draft stays up to date, and a crash loses at most those minutes. A session shorter than ten minutes is only sent at its end.
- `SessionEnd`: the session is sent once more, as ended.
- `SessionStart`: sessions that never said they ended (a crash, a closed terminal) and grew since their last send are sent at the next start, up to three at a time. One quiet for half an hour goes as ended; a fresher one as still going. Only sessions auto mode saw while it was on are considered, never older history.

The site asks the model for moments once per session, when it is over: when the plugin says it ended, or after half an hour without anything new. Sending a session that is still going costs nothing and does not count against the daily limit.

Nothing is published by it. A session you already published is left alone. Every send gets a line in `~/.coders-talk/auto.log`: sent or synced (with the draft link), skipped and why, or failed. `~/.coders-talk/auto-sessions.json` remembers which sessions auto mode saw and how much of each went, never their content; `/coders-talk:auto off` forgets it. `CODERS_TALK_AUTO=0` in the environment turns auto mode off for that shell. Codex runs no hooks for plugins, so there auto mode is not available.

### Private and team drafts

A draft is private: it is in your [My builds](https://coders.talk/library), not in the feed, search engines or your profile. If you are in a team on Coders Talk and the session ran in a repository of one of the GitHub organisations the team named, the draft goes to the team's space instead: the team sees it, nobody else. The preview says where the draft goes before anything is sent; `--private` and `--team <slug>` override it. Publishing to the community is always a separate step on the site, and for a team's draft only if the team allows it.

## What leaves your machine

- Only the session you run the command in, and only after you confirm.
- The session `.jsonl` without screenshots, thinking blocks and the agent's bookkeeping lines, with tool output cut to 60 lines, gzipped. The plugin's own run is cut off the end. Big files are read line by line: a 417 MB Codex rollout full of screenshots goes as about 200 KB.
- If the session ran in a git repository: the `origin` address when it is on GitHub, the branch, and the titles and size (files, +/−) of the commits the session made. Never the diff. The address of a private repository is shown only to the draft's own audience (you, or your team) and is removed when the Build is published. In Claude Code a `SessionStart` hook remembers `HEAD` at the start of each session in `~/.coders-talk/sessions/` for this; it sends nothing and prints nothing.
- Keys, tokens and connection strings are redacted on the server before any model sees the session; publishing waits until you have checked each finding.
- The number of tokens the session spent per model (input, output, cache reads and writes), counted from the session file before it is slimmed. Only the counts; they show on the Build and in your team's numbers.
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

`scripts/lib/slim.mjs`, `scripts/lib/usage.mjs` and `test/fixtures/slim` are generated from the site repository (`resources/js/lib/slimSession.ts`, `resources/js/lib/sessionUsage.ts`), so the plugin trims sessions and counts tokens exactly like the site's upload page does. Change them there, then run `npm run plugin:sync` in the site repository.

API used: `POST /api/v1/device/codes` and `POST /api/v1/device/token` (browser sign-in, no token needed), `POST /api/v1/imports` (multipart: `file`, `agent`, `session_id`, `client_version`, optional `git`, `usage`, `continues`, `trigger` (`manual` or `auto`) and `space`: `personal` or a team slug; the response says where the draft went in `space`, and an automatic send of a session already published answers `{"status": "skipped"}`), `GET /api/v1/imports/{id}`, `GET /api/v1/me` (the account and its teams with their GitHub owners and whether each asks for automatic sending), with `Authorization: Bearer <token>`. Errors come as `{"error": {"code", "message"}}`.
