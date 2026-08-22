# Automate with agents

Mill exposes its full surface over MCP (Model Context Protocol), so
an AI agent can do what you can do — compose workflows, run them,
inspect results, read and write Atlas — under the same guardrails you
have.

## Connect

Settings → MCP access shows the address your agent connects to and
whether the server is enabled. Point any MCP-capable client at it —
for example, a Claude Code MCP entry:

```
{ "mcpServers": { "mill": { "url": "http://127.0.0.1:8090/mcp" } } }
```

Your instance's exact address is the one Settings shows.

## What an agent gets

- **Tools** to list, author, run, and step-debug workflows; read and
  write Configure entities; read and write Atlas cards.
- **Resources** describing the live registry — every step type with
  its typed input/output contract, effect class, and config fields —
  the same contract the canvas enforces, machine-readable.
- **The same guardrails.** An agent's external effects and entity
  writes park in Review for your approval. Deny-by-default until you
  grant; nothing an agent does bypasses the gate a human action
  would hit.

## Teach your agent

`skills/mill-use` in the repository is a ready-made agent skill:
connection steps, the tool vocabulary, the contract semantics, and
the run-inspect-fix loop. Give it to your agent and it knows the
platform; `userdocs/llms-full.txt` carries this entire documentation
set in one AI-readable file.
