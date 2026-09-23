---
name: build
description: Send this Codex session to Coders Talk as a draft Build that the user reviews and publishes on the site. Use only when the user asks for $coders-talk:build.
---

Send the current session to Coders Talk as a draft. Nothing gets published here: the user reviews the draft and publishes it on the site.

In the commands below, `<plugin>` is the absolute path of the plugin folder: this file is `<plugin>/codex/skills/build/SKILL.md`. Run every command outside the sandbox (with escalated permissions): the script reads the Codex session and talks to coders.talk. Give "Send this session to Coders Talk" as the reason; the user approves.

1. Run this command, and nothing else first:

   ```
   node "<plugin>/scripts/coders-talk.mjs" preview --agent=codex
   ```

2. Show the user what it printed, word for word. If it printed an error, show the error and stop.
3. Ask the user whether to send this session to Coders Talk. Continue only if they clearly say yes; otherwise stop.
4. Run the command below. If the user wrote something with the request that points at an earlier Build of theirs (a coders.talk `/b/…` link, or `--continues <slug>`), add ` --continues=<that link or slug>` at the end, in double quotes: this session becomes the next part of that Build's series.

   ```
   node "<plugin>/scripts/coders-talk.mjs" send --agent=codex
   ```

5. Show the user what it printed: the draft link, and anything it says to check before publishing.

Rules:

- Run the commands as written, only with `<plugin>` filled in: the script finds the session, the site address and the sign-in by itself. Do not check the site, search, or run anything else on your own.
- Never read, print or search for the Coders Talk token, `~/.coders-talk/credentials.json`, environment variables or `~/.codex/auth.json`. Everything you print becomes part of the session that is being sent.
- Do not open the session file or summarise the conversation yourself; the script prepares and sends it.
- If `node` is not found, tell the user the plugin needs Node.js 20 or newer, and that they can upload the session at https://coders.talk/new instead.
- If the script says this computer is not connected, or the token was not accepted, tell the user to run $coders-talk:login first (it signs in through the browser). Never ask for a token in the chat.
