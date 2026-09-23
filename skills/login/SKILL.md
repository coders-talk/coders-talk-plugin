---
name: login
description: Connect this computer to the user's Coders Talk account through the browser. Runs only when the user types /coders-talk:login.
disable-model-invocation: true
---

1. Run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/coders-talk.mjs" login
   ```

   It opens the approval page in the browser and returns at once. If it says the computer is already connected, show that and stop.

2. Tell the user, in your reply, the link and the code it printed: the page shows the same code, and they press Connect there if it matches.
3. Then run, with a timeout of at least 2 minutes:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/coders-talk.mjs" login --wait
   ```

4. Show what it printed:
   - "Connected … as @…": done.
   - "Still waiting": ask the user to press Connect and tell you when they have, then run the step 3 command again.
   - Cancelled or expired: say so; the user can run /coders-talk:login again.

Never ask the user for a token or to paste one into the chat. Never read or print `~/.coders-talk/credentials.json` or environment variables: everything you print becomes part of the session.

Run the commands exactly as written, even if something looks unset: the script finds the site address and the sign-in by itself. Do not check the site, search, or run anything else on your own.
