---
kind: how-to
---

# Fire a workflow from a webhook

Any tool or service that can send an HTTP request can start a
workflow: post JSON to Mill's webhook address with a token from
Settings.

## Add a token

Settings → Connections → **Webhooks** → *Add webhook token*. Give it
a label naming the tool, copy the token the moment it appears — Mill
shows it exactly once — and paste it into the sending tool's own
configuration. Mint one per tool; revoke any of them from the same
list.

Mill binds the door to this Mac only; the token is the credential,
even from this Mac. The notification reaches a paired phone only if
one is paired (Settings → Connections → Remote access).

## Post an event

Replace `<token>` with the minted token:

```
curl -s -X POST http://127.0.0.1:8092/__mill/webhook \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"source":"<tool>","title":"...","body":"..."}'
```

Any JSON object is accepted — a wrong or revoked token answers 401,
anything that isn't a JSON object answers 400. `source` names which
tool posted (lowercase, exact); the seeded **Notify when a webhook
fires** workflow catches every source and notifies on every channel,
including a paired phone. Scope a workflow to one tool by setting the
trigger's Source field.

Any JSON fields you post become attributes the catching workflow
declares by name — a workflow that declares `title` and `body`
attributes receives the posted `title` and `body`, and a sender can
carry whatever else it needs (`run`, `duration`, `url`) for a workflow
declaring those to use. The posted body also arrives whole as the
run's payload.

## Examples

- **A CI job**: a build or deploy step posts on success or failure.
- **A shell script**: any command that can shell out to `curl` at the
  point it wants to fire a workflow.
- **A monitoring alert**: an alerting rule posts when a threshold
  trips.
- **An agent tool's hook configuration**: some tools let you declare a
  command to run at a lifecycle point without writing a script
  yourself — the declared command is the same curl above:

  ```json
  {"command": "curl -s -X POST http://127.0.0.1:8092/__mill/webhook -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' -d '{\"source\":\"<tool>\"}'"}
  ```

## Reply to the caller

A workflow can also answer the tool that posted, rather than only
reacting to it — see [Reply to a webhook](reply-to-a-webhook.md).
