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

## Delivered — 2026-08-10, live session

The full loop ran against the owner's real desktop window (production
build, MCP on 127.0.0.1:8091 via MILL_MCP_ADDR): list_node_types →
export_workflow (format discovery) → validate_workflow (caught the
arg-shape mismatch, then passed) → import_workflow refused flat while
the toggle was off (wrote nothing, exact go-enable-it error) → owner
flipped the toggle → import parked on the in-window approval card →
owner approved → workflow landed live (mill-data-changed refresh) →
run_workflow executed it (clipboard write, local effect, no approval
needed) → get_run showed the per-step breakdown → update_workflow
parked again, owner approved, previous draft auto-snapshotted as v1.
The owner closed the loop themselves by pasting the workflow-written
clipboard text back into the authoring agent's chat — §2.1's
capture→process→apply shape in miniature. Verdict: working as
designed; deeper UX critique of the approval card/granularity feeds
ADR-0025 whenever it comes.
