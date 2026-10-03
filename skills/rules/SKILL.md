---
name: rules
description: Show the Coders Talk rules this repository's sessions get at their start (the user's own and their team's, for its stacks), or turn them on or off on this computer. Runs only when the user types /coders-talk:rules.
argument-hint: "[on|off] [--refresh]"
disable-model-invocation: true
---

1. Run this command, and nothing else first:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/coders-talk.mjs" rules --agent=claude
   ```

   If the user wrote `on` or `off` after the command name, put it after `rules`. If they wrote `--refresh`, add ` --refresh` at the end. Nothing else goes on it.

2. Show the user what it printed, word for word.

Rules:

- The rules are already in this session's context when the session started with them. Showing them changes nothing: do not start acting on them now, and do not change them. They change on the site, at the address the command prints.
- Run the command exactly as written. The script finds the site, the repository and its stacks by itself. Do not check the site, search, or run anything else on your own.
- Never read or print `~/.coders-talk/credentials.json` or environment variables.
