---
kind: how-to
---

# Fire a workflow from a webhook

An agent tool's hook config (a Stop hook, a build step, any script that
can run curl) can POST an event to Mill, and a workflow starting from
the **Webhook fired** trigger runs in response — the hook door, not
MCP, so the tool never holds an agent session open to reach Mill.

## Add a token

Settings → Connections → **Webhooks** → *Add webhook token*. Give it
a label naming the tool, copy the token the moment it appears — Mill
shows it exactly once — and paste it into the tool's hook config.
Mint one per tool; revoke any of them from the same list.

Mill binds the door to this Mac only; the token is the credential,
even from this Mac. The notification reaches a paired phone only if
one is paired (Settings → Connections → Remote access).

## Post an event

Replace `<token>` with the minted token:

```
curl -s -X POST http://127.0.0.1:8092/__mill/hooks/event \
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

For a hook config in an agent tool, the entry is the same curl — for
example a Claude Code `Stop` hook:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://127.0.0.1:8092/__mill/hooks/event -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' -d '{\"source\":\"claude-code\",\"title\":\"Agent finished\",\"body\":\"A task completed.\"}'"
          }
        ]
      }
    ]
  }
}
```

Some tools hand their hook command the event JSON on stdin instead of
letting the command build its own body. Pipe it straight through with
`-d @-` and the workflow declares attributes by that tool's own field
names, unchanged:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "curl -s -X POST http://127.0.0.1:8092/__mill/hooks/event -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' -d @-"
          }
        ]
      }
    ]
  }
}
```

Some agent tools accept a hook handler of `type: "http"` instead of a
command — declared as JSON config with the door's `url` and an
`Authorization: Bearer <token>` header, no curl wrapper at all:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://127.0.0.1:8092/__mill/hooks/event",
            "headers": {
              "Authorization": "Bearer <token>",
              "Content-Type": "application/json"
            }
          }
        ]
      }
    ]
  }
}
```

Either form is fire-and-forget: Mill acknowledges a well-formed post
and never asks the tool to wait for, or read, anything back.
