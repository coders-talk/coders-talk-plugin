---
name: auto
description: Turn automatic sending of Claude Code sessions to Coders Talk on or off for this computer, or show whether it is on. Runs only when the user types /coders-talk:auto.
disable-model-invocation: true
---

Auto mode sends each Claude Code session on this computer to Coders Talk by itself, every ten minutes while it runs and once more when it ends: `on` sends every session (to the user's team space when the repository is one of their team's, else to their private Builds), `team` sends only sessions in repositories of teams that ask for it, `off` stops it. Nothing is ever published by it.

1. Run this command exactly, with `<mode>` replaced by what the user wrote after the command name (`on`, `team` or `off`), or with nothing after `auto` if they wrote nothing:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/coders-talk.mjs" auto <mode>
   ```

2. Show the user what it printed, word for word. If it printed an error, show the error and stop.

Rules:

- Run only that command. Do not check the site, read files, or run anything else on your own.
- Never read, print or search for the Coders Talk token, `~/.coders-talk/credentials.json`, environment variables or `~/.claude/.credentials.json`.
- If the user wrote something other than `on`, `team` or `off`, run the command without a mode and show them the result.
- If the script says this computer is not connected, tell the user to run /coders-talk:login first. Never ask for a token in the chat.
