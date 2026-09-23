---
name: build
description: Send this Claude Code session to Coders Talk as a draft Build that the user reviews and publishes on the site. Runs only when the user types /coders-talk:build.
disable-model-invocation: true
---

Send the current session to Coders Talk as a draft. Nothing gets published here: the user reviews the draft and publishes it on the site.

1. Run this command exactly, and nothing else first:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/coders-talk.mjs" preview ${CLAUDE_SESSION_ID}
   ```

2. Show the user what it printed, word for word. If it printed an error, show the error and stop.
3. Ask the user whether to send this session to Coders Talk. Continue only if they clearly say yes; otherwise stop.
4. Run the command below. If the user wrote something after the command name that points at an earlier Build of theirs (a coders.talk `/b/…` link, or `--continues <slug>`), add ` --continues=<that link or slug>` at the end, in double quotes: this session becomes the next part of that Build's series.

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/coders-talk.mjs" send ${CLAUDE_SESSION_ID}
   ```

5. Show the user what it printed: the draft link, and anything it says to check before publishing.

Rules:

- Run the commands exactly as written, even if something looks unset: the script finds the site address and the sign-in by itself. Do not check the site, search, or run anything else on your own.
- Never read, print or search for the Coders Talk token, `~/.coders-talk/credentials.json`, environment variables or `~/.claude/.credentials.json`. Everything you print becomes part of the session that is being sent.
- Do not open the session file or summarise the conversation yourself; the script prepares and sends it.
- If `node` is not found, tell the user the plugin needs Node.js 20 or newer, and that they can upload the session at https://coders.talk/new instead.
- If the script says this computer is not connected, or the token was not accepted, tell the user to run /coders-talk:login first (it signs in through the browser). Never ask for a token in the chat.
