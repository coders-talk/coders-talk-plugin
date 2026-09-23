---
name: logout
description: Disconnect this computer from Coders Talk. Runs only when the user types /coders-talk:logout.
disable-model-invocation: true
---

1. Run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/coders-talk.mjs" logout
   ```

2. Show the user what it printed. The token is only forgotten on this computer; it can be revoked on the site under Settings → Agent plugins.

Run the commands exactly as written, even if something looks unset: the script finds the site address and the sign-in by itself. Do not check the site, search, or run anything else on your own.
