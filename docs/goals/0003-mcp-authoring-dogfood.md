# 0003 — MCP authoring live dogfood

## Goal
Prove ADR-0025's LLM-authoring protocol in action in the owner's
running desktop app: a Claude Code session authors and iterates a
workflow via Mill's MCP server while the owner watches it appear/
change live (`mill-data-changed`) and approves writes in the banner.

## Plan
1. Owner flips "Allow MCP clients to import data" in Settings (keeps
   per-write approval ON — the banner is part of the demo).
2. The session connects an MCP client to 127.0.0.1:8090 and walks the
   loop: list_node_types → validate → import → update (watch the
   auto-snapshot land in Versions) → run → get_run.
3. Owner critiques the live experience; corrections feed back into
   ADR-0025's one-line-flip points (approval granularity, concurrent-
   edit reaction).

## Acceptance
The owner has watched a workflow get authored end-to-end by the LLM in
their real app and rendered a verdict on the experience.
