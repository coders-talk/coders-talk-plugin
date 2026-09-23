---
name: login
description: Connect this computer to the user's Coders Talk account through the browser. Use only when the user asks for $coders-talk:login.
---

In the commands below, `<plugin>` is the absolute path of the plugin folder: this file is `<plugin>/codex/skills/login/SKILL.md`. Run every command outside the sandbox (with escalated permissions): the script talks to coders.talk and saves the sign-in in the user's home folder. Give "Connect to Coders Talk" as the reason; the user approves.

1. Run:

   ```
   node "<plugin>/scripts/coders-talk.mjs" login --agent=codex
   ```

   It opens the approval page in the browser and returns at once. If it says the computer is already connected, show that and stop.

2. Tell the user, in your reply, the link and the code it printed: the page shows the same code, and they press Connect there if it matches.
3. Then run, with a timeout of at least 2 minutes:

   ```
   node "<plugin>/scripts/coders-talk.mjs" login --wait --agent=codex
   ```

4. Show what it printed:
   - "Connected … as @…": done.
   - "Still waiting": ask the user to press Connect and tell you when they have, then run the step 3 command again.
   - Cancelled or expired: say so; the user can ask for $coders-talk:login again.

Never ask the user for a token or to paste one into the chat. Never read or print `~/.coders-talk/credentials.json` or environment variables: everything you print becomes part of the session.

Run the commands as written, only with `<plugin>` filled in: the script finds the site address and the sign-in by itself. Do not check the site, search, or run anything else on your own.
