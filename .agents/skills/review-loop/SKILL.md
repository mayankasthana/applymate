---
name: review-loop
description: Serve the local chat/review UI, poll the candidate's messages, and keep the conversation flowing while working.
---

# Review loop

1. Start the UI if it is not running: `node bin/axa.ts chat serve` (loopback
   only; port from `config chatPort`). Leave it running in the background.
2. Tell the candidate the URL. Artifacts render at
   `/api/artifact?path=applications/<id>/resume.md`.
3. Poll for messages: `node bin/axa.ts chat poll --since <lastId> --wait 25`.
   Track the highest message id you have seen and keep passing it as `--since`.
4. Answer each message, then `node bin/axa.ts chat reply "<text>"`. Post
   progress updates during long work so the candidate can watch the pipeline move.
5. When the candidate asks for changes, apply them, re-render, and announce in
   chat. Remember rule one: nothing is submitted without an explicit yes.

$ARGUMENTS
