# Coders Talk for Claude Code and Codex

Send the Claude Code or Codex session you are in to [Coders Talk](https://coders.talk) as a draft Build: the prompts, interventions and fails that mattered, with the raw log one layer down. The plugin never publishes. The draft is private: only you see it, or your team when the session ran in one of the team's repositories. You review every moment on the site and publish it there if you want to.

The other way round, the plugin gives your agent the Coders Talk library: before a non-trivial task, or after a few failed attempts, it can look up sessions where other developers did something similar, and what went wrong for them (see [The library in your agent](#the-library-in-your-agent)).

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

Start a new session, then `$coders-talk:login` and `$coders-talk:build` (the same commands as below, with `# Coders Talk for Claude Code and Codex

Send the Claude Code or Codex session you are in to [Coders Talk](https://coders.talk) as a draft Build: the prompts, interventions and fails that mattered, with the raw log one layer down. The plugin never publishes. The draft is private: only you see it, or your team when the session ran in one of the team's repositories. You review every moment on the site and publish it there if you want to.

The other way round, the plugin gives your agent the Coders Talk library: before a non-trivial task, or after a few failed attempts, it can look up sessions where other developers did something similar, and what went wrong for them (see [The library in your agent](#the-library-in-your-agent)).

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

 instead of `/`). For the library, also run `codex mcp login coders-talk` once in a terminal. Codex asks to run the plugin's command outside its sandbox: it needs the network to reach coders.talk and your home folder for the sign-in. The session is found through `CODEX_THREAD_ID` in `~/.codex/sessions` (or `CODEX_HOME`), and HEAD at its start comes from the rollout's `session_meta`, so Codex needs no hook for it. Codex runs the plugin's hooks only for auto mode (see Auto mode), and only once you trust them in `/hooks`.

One repository serves both agents: Claude Code reads `.claude-plugin/` and `skills/`, Codex reads `.codex-plugin/`, `.agents/plugins/marketplace.json`, `codex/skills/` and `codex/hooks.json` (its manifest points there, so Codex never picks up `hooks/hooks.json`; the same scripts run with `--agent=codex`). Codex does not expand `${CLAUDE_PLUGIN_ROOT}` or `${CLAUDE_SESSION_ID}` in skills, so its skills give the script path relative to the skill file and pass `--agent=codex`.

## Use

| Command | What it does |
| --- | --- |
| `/coders-talk:build` | Shows what would be sent (project folder, prompts, time span, size), where it goes and what the privacy check found, asks, sends, prints the draft link. |
| `/coders-talk:build --private` | The same, and the draft stays yours even in a team's repository. |
| `/coders-talk:build --team <slug>` | The same, and the draft goes to that team (the part after `/t/` in the team's link). |
| `/coders-talk:auto on` | From now on every session of this agent on this computer is sent by itself while it runs and when it ends (see Auto mode). |
| `/coders-talk:auto team` | The same, only for sessions in repositories of teams that ask for it. |
| `/coders-talk:auto off` | Stops it. `/coders-talk:auto` alone says whether it is on and what it last sent. |
| `/coders-talk:login` | Connects this computer through the browser, or says which account it is connected to. |
| `/coders-talk:logout` | Forgets the token on this computer (revoke it on the site under Settings → Agent plugins). |
| `/coders-talk:lookup <task>` | Searches the Coders Talk library for sessions of a similar task and shows what came back. The agent also does this by itself (see below). |

Sending the same session again updates its draft until you publish it.

Two rules:

- **Commands that send your session** (`build` and `auto`, and `login` and `logout` with them) run only when you type them. The agent never invokes them on its own.
- **Searching the library** is something the agent does by itself when a task calls for it (the `lookup` skill and the `coders-talk` MCP server). It sends a short description of the task and the stack, never the session. Switch it off in `/mcp` (Claude Code) or in `~/.codex/config.toml` (Codex); see [The library in your agent](#the-library-in-your-agent).

A forked session (`/branch` or `--fork-session` in Claude Code, a fork in Codex) is sent as its own draft, and the plugin tells the site which session it came from and where it left it. The fork's Build then says it is a fork and links to the Build of the original session, and the original's Build links to its forks. Whichever of the two is sent first, the link appears once both are on the site. Claude Code writes the lines the fork inherited with the original's session id and Codex names it in the rollout's `session_meta`, so no hook is needed for it.

If the privacy check found something the preview lists it by number; it goes as `[REDACTED]` unless you name its number, and the preview runs again with `--keep=<numbers>` (see [What leaves your machine](#what-leaves-your-machine)).

If coders.talk cannot be reached or answers with a server error, the send step opens `coders.talk/new` in the browser and the file manager with the prepared `.jsonl.gz` selected, and prints the link and the path: drop the file on the page. It is the same checked file the preview described. It is kept for 30 minutes, so sending again once the site is back works too. `CODERS_TALK_NO_BROWSER=1` keeps the browser and the file manager closed; the link and the path are printed anyway. A rejected token or request never ends up there: sign in again instead.

### Auto mode

Off until you turn it on, per computer, per site and per agent: `/coders-talk:auto on` in Claude Code never sends Codex sessions, and `$coders-talk:auto on` in Codex never sends Claude Code ones. With it on, each session is sent the way `/coders-talk:build` would send it, without asking: to your team's space when the repository is one of your team's, else to your private Builds. With `/coders-talk:auto team`, only sessions in repositories of teams that ask for it (a team setting) are sent, and nothing else leaves the machine. A team can ask; it can never switch this on for you.

Three hooks do the sending, each in a background process so the agent never waits for an upload:

- `Stop`, after an answer of the agent: when the session grew and the last send is ten minutes old, it is sent as still going. The draft stays up to date, and a crash loses at most those minutes. A session shorter than ten minutes is only sent at its end.
- `SessionEnd`: the session is sent once more, as ended. Codex also ends a session after 30 idle minutes, which is what ends one in its desktop app.
- `SessionStart`: sessions that never said they ended (a crash, a closed terminal) and grew since their last send are sent at the next start, up to three at a time. One quiet for half an hour goes as ended; a fresher one as still going. Only sessions auto mode saw while it was on are considered, never older history.

The site asks the model for moments once per session, when it is over: when the plugin says it ended, or after half an hour without anything new. Sending a session that is still going costs nothing and does not count against the daily limit.

Nothing is published by it. A session you already published is left alone. Every send gets a line in `~/.coders-talk/auto.log`: sent or synced (with the draft link), skipped and why, or failed. `~/.coders-talk/auto-sessions.json` remembers which sessions auto mode saw and how much of each went, never their content; `/coders-talk:auto off` forgets it. `CODERS_TALK_AUTO=0` in the environment turns auto mode off for that shell.

In Codex the hooks are `codex/hooks.json`. Codex runs a plugin's hooks only once you trust them: type `/hooks` and trust the three Coders Talk hooks (`$coders-talk:auto on` reminds you). On Windows Codex runs them through PowerShell and puts the plugin folder into `${PLUGIN_ROOT}` itself. When the Codex CLI exits it also ends what its hooks started, so the session-end hook waits up to three seconds for the upload; what does not make it goes at the next start, and the site asks for moments after half an hour without anything new anyway.

### Private and team drafts

A draft is private: it is in your [My builds](https://coders.talk/library), not in the feed, search engines or your profile. If you are in a team on Coders Talk and the session ran in a repository of one of the GitHub organisations the team named, the draft goes to the team's space instead: the team sees it, nobody else. The preview says where the draft goes before anything is sent; `--private` and `--team <slug>` override it. Publishing to the community is always a separate step on the site, and for a team's draft only if the team allows it.

## The library in your agent

The plugin brings an MCP server, `coders-talk` (`https://coders.talk/mcp`), with three read-only tools: `search_coding_agent_sessions` finds published sessions of a similar task, `get_coding_agent_session` reads one of them, `find_coding_agent_failures` finds where agents failed on a similar problem and what the human did. The `lookup` skill tells the agent when to use them (before a non-trivial task on a known stack, after two or three failed attempts, when you ask how others did something), what may go into a query and what may not, and to treat the answers as other people's experience: it never runs a command from them without asking you. When a session helped, it says so with the link.

- **Signing in.** In Claude Code the server uses the sign-in of `/coders-talk:login`: `.mcp.json` asks `scripts/coders-talk.mjs mcp-headers` for the token at each connection (`headersHelper`), so the token is in no config file and never passes through the chat. Not signed in, the server asks you to sign in through the browser in `/mcp`. Codex runs a plugin's header helper from the session's folder with an empty environment, where the plugin cannot find its own script, so in Codex the server signs in on its own: run `codex mcp login coders-talk` once. Both need access to the library: during the closed beta, see [coders.talk/for-agents](https://coders.talk/for-agents).
- **What a search sends.** The query (a few words about the task, or the symptom of a failure), the stack, and the agent's name. The agent is told never to put code, paths, repository, company or client names, hostnames, URLs or secrets in it. The site keeps the query text, the filters and how many results it found for 180 days, not tied to you or your IP address. The session itself never goes with it.
- **Switching it off.** Claude Code: `/mcp`, choose `coders-talk`, disable. Codex: in `~/.codex/config.toml`

  ```toml
  [plugins."coders-talk@coders-talk".mcp_servers.coders-talk]
  enabled = false
  ```

- **Another site.** In Claude Code the server follows `CODERS_TALK_URL`. Codex cannot read variables in a plugin's server address: add your own server in `config.toml` (`[mcp_servers.coders-talk-dev]`, `url = "http://…/mcp"`) and switch the plugin's off.
- **Which Builds your session used.** When you send a session, the plugin counts the agent's calls to these tools in it and collects the Builds their answers linked to (`/b/<slug>?ref=agent`), up to 20; the preview shows them. The site links your draft to those Builds: "Used from the library" on yours, "Helped N published sessions" on theirs, once yours is published. Only the count and the slugs are sent, never the queries.
- **A suggestion to share.** Once per session, after an answer, when the agent got Builds from the library and the session changed code, the `Stop` hook shows you one line: "Your agent used 2 Builds from coders.talk in this session. Share yours: /coders-talk:build". It sends nothing, and it never shows with auto mode on. To read the session for it, the hook goes on from where it stopped the last time and keeps that place, the count and the slugs in `~/.coders-talk/nudges/`. Turn it off with `CODERS_TALK_NUDGE=0`, or `node <plugin folder>/scripts/coders-talk.mjs nudge off`. In Codex the hook runs only once you trust the plugin's hooks in `/hooks`.

## What leaves your machine

- By default, only the session you run `/coders-talk:build` in, and only after you confirm.
- With [auto mode](#auto-mode) on, which only you can switch on, each session of that agent on this computer, without asking (with `team`, only sessions in repositories of teams that ask for it). Nothing is published either way.
- The session `.jsonl` without screenshots, thinking blocks and the agent's bookkeeping lines, with tool output cut to 60 lines, gzipped. The plugin's own run is cut off the end. Big files are read line by line: a 417 MB Codex rollout full of screenshots goes as about 200 KB.
- If the session ran in a git repository: the `origin` address when it is on GitHub, the branch, and the titles, hashes and size (files, +/−) of the commits the session made (the site links each commit on GitHub; the commits themselves are not sent). The address of a private repository is shown only to the draft's own audience (you, or your team) and is removed when the Build is published. In Claude Code a `SessionStart` hook remembers `HEAD` at the start of each session in `~/.coders-talk/sessions/` for this; it sends nothing and prints nothing.
- The files that changed, as diffs (up to 300 lines a file; env, key and credential files, lock files and builds by name only). In Claude Code `scripts/snapshot.mjs` runs on `SessionStart`, `UserPromptSubmit` and `Stop` and takes a git snapshot of the working tree: a temporary index in `~/.coders-talk/snapshots/`, tracked changes and new files up to 1 MB, a tree chained under `refs/coders-talk/<session>`. Your branch, index and files are not touched, and a plain `git push` does not send that ref. The build step turns neighbouring snapshots into what the agent changed in each turn (Bash and subagents included), what you changed by hand between its answers, and the commits of each turn. A snapshot slower than 3 seconds turns them off for the session. Snapshots and their refs older than 14 days are removed at the next session start in the same repository. Without git, or in Codex, the diffs come from the agent’s own edits in the session.
- Nothing secret: keys, tokens, connection strings, passwords in URLs, email addresses, public IP addresses and internal hostnames are replaced with `[REDACTED:TYPE]` on this computer, before anything is sent, in the session, the branch name and the commit titles alike. A home folder in a path (`C:\Users\you`, `/Users/you`, `/home/you`) becomes `~`. The preview lists each finding by number and kind, never its value; `--keep=<numbers>` sends one as it is, and only a SHA-256 of it goes to the site, so the site's own second check leaves it alone. Kept values are remembered as hashes in `~/.coders-talk/kept.json`. Words to hide in every session, such as client names or internal services, go in `~/.coders-talk/privacy.json` as `{"redact": ["Globex", "billing-core"]}`. The rules are the site's own (`scripts/lib/privacy.mjs`, generated from coders.talk), checked against the same cases in `test/fixtures/privacy`.
- The number of tokens the session spent per model (input, output, cache reads and writes), counted from the session file before it is slimmed. Only the counts; they show on the Build and in your team's numbers.
- For a forked session, the id of the session it was forked from and the time of the fork, so the site can link the two Builds.
- If the agent used the Coders Talk library in the session: how many times it called it, and the slugs of the Builds it got (up to 20).
- Apart from sessions: the library searches the agent makes by itself (a short task description and the stack; see [The library in your agent](#the-library-in-your-agent)).
- The token can start imports and read the library. Revoke it in Settings at any time.

## Configuration

| Setting | Where | Default |
| --- | --- | --- |
| Site address | `CODERS_TALK_URL`, or in Claude Code the plugin option `url` (asked when the plugin is enabled). In Codex set the variable in `~/.codex/config.toml`: `[shell_environment_policy]` `set = { CODERS_TALK_URL = "https://…" }` | `https://coders.talk` |
| Token | `/coders-talk:login` saves one per site; `CODERS_TALK_TOKEN` overrides it (for CI, or a token made in Settings by hand) | none |
| Data folder | `CODERS_TALK_HOME` | `~/.coders-talk` |
| Suggestion to share a session that used the library | `CODERS_TALK_NUDGE=0` turns it off for a shell; `coders-talk.mjs nudge off` for this computer | on |
| Proxy | `HTTPS_PROXY` (`HTTP_PROXY` for an `http://` site, `ALL_PROXY` for both), `NO_PROXY` for hosts that go direct. Lower-case names work too. An `http://` or `https://` proxy, with `user:password@` if it asks; a `socks://` one is ignored. In Codex, if a variable does not reach the plugin, add it to `set` as above | none: direct |

Node's own `fetch` ignores the proxy variables, so the plugin opens the proxy's `CONNECT` tunnel itself. Some networks reset a direct connection to the site after the first 16 KB, which lets `whoami` through but not an upload; there the proxy is what gets a session out.

The script reads the `url` option from Claude Code's own `settings.json` (`pluginConfigs`). It does not rely on `${user_config.url}` in the skills or on `CLAUDE_PLUGIN_OPTION_*` variables: in testing, the desktop app left the placeholder unexpanded and the variable did not reach commands the model runs.

## Development

```
npm test                              # node --test, no dependencies
claude plugin validate . --strict
claude --plugin-dir .                 # try it in a real session
```

`scripts/lib/slim.mjs`, `scripts/lib/usage.mjs` and `test/fixtures/slim` are generated from the site repository (`resources/js/lib/slimSession.ts`, `resources/js/lib/sessionUsage.ts`), so the plugin trims sessions and counts tokens exactly like the site's upload page does. Change them there, then run `npm run plugin:sync` in the site repository.

API used: `POST /api/v1/device/codes` and `POST /api/v1/device/token` (browser sign-in, no token needed), `POST /api/v1/imports` (multipart: `file`, `agent`, `session_id`, `client_version`, optional `git` (with `commits.shas` next to `commits.subjects`), `usage`, `privacy` (what the local check redacted, by type, and SHA-256 hashes of the values kept on purpose, never a value), `continues`, `fork` (`{"session_id", "at"}`: the session this one was forked from, and when; lines up to `at` are the original's), `library` (`{"calls", "slugs"}`: how often the agent called the library, and up to 20 slugs of the Builds it got; unknown slugs are dropped), `trigger` (`manual` or `auto`) and `space`: `personal` or a team slug; the response says where the draft went in `space`, the original's Build in `forked_from` (`{slug, title, url}`, or null while it is not on the site), and an automatic send of a session already published answers `{"status": "skipped"}`), `GET /api/v1/imports/{id}`, `GET /api/v1/me` (the account and its teams with their GitHub owners and whether each asks for automatic sending), with `Authorization: Bearer <token>`. The MCP server is `/mcp` (Streamable HTTP, the same token; `mcp-headers` prints it for Claude Code). Errors come as `{"error": {"code", "message"}}`.
