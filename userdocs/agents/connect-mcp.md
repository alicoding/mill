# Automate with agents

Point an MCP-capable agent at Mill's address, and it can compose
workflows, run them, inspect results, and read and write Atlas — the
same things you can do, under the same guardrails. Its writes still
park for your approval; nothing it does skips the gate a human action
would hit.

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
- **Deny-by-default access.** Nothing works until you grant it in
  Settings → MCP access, and writes stay off until you turn them on
  separately from reads.

## See every call

Activity's MCP calls section logs every call — an agent calling Mill,
or a workflow calling a connected server — with who called what, when,
and whether it succeeded. Filter by direction or tool name to find one
fast; a failed call's error is copyable in one click.

## Teach your agent

`skills/mill-use` in the repository is a ready-made agent skill:
connection steps, the tool vocabulary, the contract semantics, and
the run-inspect-fix loop. Give it to your agent and it knows the
platform; `userdocs/llms-full.txt` carries this entire documentation
set in one AI-readable file.
