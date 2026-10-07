---
name: rules
description: Show the KeepPlain rules this repository's sessions get at their start (the user's own and their team's, for its stacks), or turn them on or off on this computer. Use only when the user asks for $keepplain:rules.
---

`<plugin>` below is the absolute path of the plugin folder: this file is `<plugin>/codex/skills/rules/SKILL.md`. Run the command outside the sandbox (with escalated permissions): it asks the KeepPlain site and changes a file in the user's home folder. Give "Show the KeepPlain rules" as the reason.

1. Run this command, and nothing else first:

   ```
   node "<plugin>/scripts/keepplain.mjs" rules --agent=codex
   ```

   If the user wrote `on` or `off` with the request, put it after `rules`. If they wrote `--refresh`, add ` --refresh` at the end. Nothing else goes on it.

2. Show the user what it printed, word for word.

Rules:

- The rules are already in this session's context when the session started with them. Showing them changes nothing: do not start acting on them now, and do not change them. They change on the site, at the address the command prints.
- Run the command as written, only with `<plugin>` filled in. The script finds the site, the repository and its stacks by itself. Do not check the site, search, or run anything else on your own.
- Never read or print `~/.keepplain/credentials.json`, environment variables or the agent's own sign-in files.
