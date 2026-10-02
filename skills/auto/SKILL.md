---
name: auto
description: Turn automatic sending of Claude Code sessions to Coders Talk on or off for this computer or for this one session, or show whether it is on. Runs only when the user types /coders-talk:auto.
disable-model-invocation: true
---

Auto mode sends each Claude Code session on this computer to Coders Talk by itself, every ten minutes while it runs and once more when it ends: `on` sends every session (to the user's team space when the repository is one of their team's, else to their private Builds), `team` sends only sessions in repositories of teams that ask for it, `push` sends a session only when its commits are pushed (from repositories with the Coders Talk git hooks), `off` stops it. `session on` sends only the current session this way, even when auto mode is off for the computer; `session off` keeps the current session on this computer whatever the mode. Nothing is ever published by it.

1. Run the command that matches what the user wrote after the command name.

   If it starts with `session`, run this command exactly, with `<choice>` replaced by `on` or `off` when the user wrote one after `session`, or with nothing in its place if they did not:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/coders-talk.mjs" auto session <choice> ${CLAUDE_SESSION_ID}
   ```

   Otherwise run this command exactly, with `<mode>` replaced by what the user wrote (`on`, `team`, `push` or `off`), or with nothing after `auto` if they wrote nothing:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/coders-talk.mjs" auto <mode>
   ```

2. Show the user what it printed, word for word. If it printed an error, show the error and stop.

Rules:

- Run only one of those commands. Do not check the site, read files, or run anything else on your own.
- Never read, print or search for the Coders Talk token, `~/.coders-talk/credentials.json`, environment variables or the agent's own sign-in files.
- If the user wrote something other than `on`, `team`, `push`, `off`, `session`, `session on` or `session off`, run the second command without a mode and show them the result.
- If the script says this computer is not connected, tell the user to run /coders-talk:login first. Never ask for a token in the chat.
