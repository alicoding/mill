---
kind: how-to
---

# Reply to a webhook

A workflow that starts from **Webhook fired** can answer the tool that
posted the event, not just react to it. Add an **Answer the webhook**
step, and Mill holds the caller's connection open until that step
runs, then sends its status, body, and content type back verbatim.

## Add the step

Drag **Answer the webhook** onto the canvas from the Apply group and
connect it after whatever steps decide what to say. Set:

- **Status code** — the HTTP status the caller receives.
- **Reply body** — usually JSON, in the calling tool's own schema. Use
  `{{attributeName}}` to drop in a value the trigger or an earlier step
  captured.
- **Content type** — the reply's Content-Type header.

Set **Reply within (seconds)** on the trigger's own **Webhook fired**
step to how long the caller should wait. The sending tool's own
timeout must be longer than this — a caller that gives up first never
sees the reply Mill sends.

## The sender reads the response body

Some tools post an event and read the decision straight from the
response, no script in between — a configuration entry pointing
directly at a URL, rather than running a command:

```json
{"url": "http://127.0.0.1:8092/__mill/webhook", "headers": {"Authorization": "Bearer <token>", "Content-Type": "application/json"}}
```

A tool that only runs a command reads the same reply from the curl
response instead:

```
curl -s -X POST http://127.0.0.1:8092/__mill/webhook \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d @-
```

Either way, whatever the Answer the webhook step sent — status, body,
content type — is what the sending tool receives.

## A quiet failure proceeds, at the sender

If nothing answers, if the reply is malformed for what the tool
expects, or if the sending tool's own timeout runs out first, most
tools treat that as a non-blocking failure and let the action proceed
anyway. A workflow meant to gate a tool call needs to say so plainly
in its own reply body, in the tool's own schema — Mill never assumes
what "allow" or "deny" look like on the other end.

## Order decides what a run answers with

Only the FIRST Answer the webhook step to run in a given execution
sends anything; every one after it is skipped; a step's own run notes
say so ("Reply already sent by step …"). Put the steps that decide
WHAT to say — a Branch, a lookup, a guardrail check — before the
Answer the webhook step, not after it. A reply step placed too early
answers before that evaluation ever runs.
