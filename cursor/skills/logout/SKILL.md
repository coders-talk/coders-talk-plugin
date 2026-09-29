---
name: coders-talk-logout
description: Disconnect this computer from Coders Talk. Use only when the user types /coders-talk-logout.
disable-model-invocation: true
---

`<plugin>` below is the absolute path of the plugin folder: this file is `<plugin>/cursor/skills/logout/SKILL.md`.

1. Run:

   ```
   node "<plugin>/scripts/coders-talk.mjs" logout --agent=cursor
   ```

2. Show the user what it printed. The token is only forgotten on this computer; it can be revoked on the site under Settings → Agent plugins.

Run the command as written, only with `<plugin>` filled in. Do not check the site, search, or run anything else on your own.
