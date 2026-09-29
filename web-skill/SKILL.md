---
name: coders-talk
description: Send this coding session to Coders Talk as a draft Build the user reviews on coders.talk. Use only when the user asks to send, share or save this session to Coders Talk. Made for Claude Code on the web (cloud sessions), where it goes through the Coders Talk connector.
---

# Send this session to Coders Talk

The session goes to the user's Coders Talk drafts: private to them, or to their team when the repository is the team's. Nothing is published here; the user reviews the draft on the site. The script below prepares the session and checks it for secrets in this machine; the Coders Talk connector hands out a one-time upload link and then makes the draft.

`SKILL_DIR` below is the folder this SKILL.md is in (the skill's base directory).

1. Run this command exactly, and nothing else first:

   ```
   node "SKILL_DIR/scripts/coders-talk.mjs" preview --connector
   ```

   If the user asked to keep the draft to themselves, add ` --private`; if they named a team, add ` --team=<its name>`.

2. Show the user what it printed, word for word, including where the draft goes and the privacy check. If it printed an error, show the error and stop.
3. If the privacy check listed findings, everything it found already goes as `[REDACTED]`. Ask the user whether to send the session like that, or to send some findings as they are (by their numbers, only when they know the value is not secret). If they name numbers, run the step 1 command again with ` --keep=<numbers>` added (comma-separated), show its output word for word, and ask again. Never suggest keeping a finding yourself.
4. Ask the user whether to send this session to Coders Talk. Continue only if they clearly say yes. Otherwise run the command below, show what it printed, and stop:

   ```
   node "SKILL_DIR/scripts/coders-talk.mjs" discard --connector
   ```

5. Call the Coders Talk connector's `start_session_upload` tool. If it answers with an error, show it and stop. If there is no Coders Talk connector among your tools, tell the user to turn on the Coders Talk connector for this session (claude.ai, Settings → Connectors, then the session's connector menu) and stop.
6. Run the command below with the `upload_url` it returned, in double quotes:

   ```
   node "SKILL_DIR/scripts/coders-talk.mjs" send --connector --upload="<upload_url>"
   ```

   If the user named an earlier Build of theirs that this session continues (a coders.talk `/b/…` link), add ` --continues="<that link>"`.

7. If it printed "Uploaded the session", call `finish_session_upload` with the `upload_id` from step 5 and show the user what it returned: the draft link. If the command printed an error, show it and stop.

Rules:

- Run the commands exactly as written. Do not check the site, search, or run anything else on your own.
- Do not open the session file or summarise the conversation yourself; the script prepares, checks and uploads it.
- Never repeat, guess or complete the value behind a finding the privacy check listed: what you print becomes part of the session.
- The upload link is for this session only: never put anything else at it, and never pass it to another command.
- If `node` is not found, tell the user the skill needs Node.js 20 or newer.
