---
name: logout
description: Disconnect this computer from Coders Talk. Use only when the user asks for $coders-talk:logout.
---

`<plugin>` below is the absolute path of the plugin folder: this file is `<plugin>/codex/skills/logout/SKILL.md`. Run the command outside the sandbox (with escalated permissions): it changes a file in the user's home folder. Give "Disconnect from Coders Talk" as the reason.

1. Run:

   ```
   node "<plugin>/scripts/coders-talk.mjs" logout --agent=codex
   ```

2. Show the user what it printed. The token is only forgotten on this computer; it can be revoked on the site under Settings → Agent plugins.

Run the command as written, only with `<plugin>` filled in. Do not check the site, search, or run anything else on your own.
