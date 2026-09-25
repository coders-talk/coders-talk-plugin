---
name: auto
description: Turn automatic sending of Codex sessions to Coders Talk on or off for this computer, or show whether it is on. Use only when the user asks for $coders-talk:auto.
---

Auto mode sends each Codex session on this computer to Coders Talk by itself, every ten minutes while it runs and once more when it ends or sits idle for 30 minutes: `on` sends every session (to the user's team space when the repository is one of their team's, else to their private Builds), `team` sends only sessions in repositories of teams that ask for it, `off` stops it. Nothing is ever published by it. It works through the plugin's hooks, which Codex runs only after the user trusts them in /hooks.

In the command below, `<plugin>` is the absolute path of the plugin folder: this file is `<plugin>/codex/skills/auto/SKILL.md`. Run it outside the sandbox (with escalated permissions): the script saves the choice in the user's home folder and talks to coders.talk. Give "Change Coders Talk auto mode" as the reason; the user approves.

1. Run this command exactly, with `<mode>` replaced by what the user wrote after the command name (`on`, `team` or `off`), or with nothing in its place if they wrote nothing:

   ```
   node "<plugin>/scripts/coders-talk.mjs" auto <mode> --agent=codex
   ```

2. Show the user what it printed, word for word, including what it says about trusting the hooks in /hooks. If it printed an error, show the error and stop.

Rules:

- Run only that command, with `<plugin>` filled in. Do not check the site, read files, trust hooks for the user or run anything else on your own.
- Never read, print or search for the Coders Talk token, `~/.coders-talk/credentials.json`, environment variables or `~/.codex/auth.json`.
- If the user wrote something other than `on`, `team` or `off`, run the command without a mode and show them the result.
- If the script says this computer is not connected, tell the user to run $coders-talk:login first. Never ask for a token in the chat.
