# 0031 — AI node family: guardrailed AI steps, designed from the converged taxonomy

## Goal
Owner-engaged 2026-08-12 on the "what's missing vs top apps" answer:
the AI node is the category-defining capability (n8n's growth came
from AI-workflow positioning; Mill's unique differentiator is the
guardrail between AI output and real action, already built). Owner's
own requirement: "when we say AI node in n8n and many no code
platforms they have different ways and they are all useful to have
even in a single platform" — so this is a node FAMILY designed from
the converged taxonomy, not one blob node. §1.1's invariant is locked:
user-configured endpoint (local Ollama / BYO key), one deterministic
call per step, never an agent loop inside Mill.

## Plan
1. [x] Research DONE 2026-08-12 (primary sources: n8n cluster-node/
   Ollama-credential docs, Ollama native+OpenAI-compat APIs, Anthropic
   Messages API + its compat shim, Zapier/Make/Dify AI nodes). Verdicts:
   - **Shapes**: completion + extract-structured are the unanimous
     3-platform convergences → build ai-completion +
     ai-extract-structured first. Summarize = a completion preset, not
     a shape. Embed = converged but always RAG infrastructure — DEFERRED
     until a vector-store exists (point-solution trap otherwise).
     Vision = input variant, not a node. Agent-loop = out by §1.1's
     locked invariant. ai-classify = OPEN design choice (Dify has a
     dedicated node; Mill could compose extract-structured + Branch).
   - **Config sharing**: n8n's Chat-Model-sub-node/credential pattern
     translated to Mill's idiom = AIProvider Configure entity
     {Kind: "openai-compatible"|"anthropic", BaseURL, Model,
     AuthSecret(keyring)} — 1:many, RefKind picker. n8n's typed-edge
     cluster mechanism itself rejected (doesn't fit Mill's graph model).
   - **Transport**: exactly TWO adapters — openaicompat (covers Ollama's
     /v1 + LM Studio/vLLM/any BYO endpoint, zero per-provider code) +
     anthropic native Messages (Anthropic's own docs disqualify their
     compat shim for production). Dedicated adapters, NOT routed
     through Connector (AuthType has no chat/schema concept — the
     templating anti-pattern §3.3 already rejected).
   - **Effect class — NEEDS OWNER RATIFICATION, not silently resolved**:
     recommendation = static ClassExternal (consistent with
     integration-http/mcp-tool-call's local-subprocess precedent),
     with the existing EffectForNode dynamic-override downgrading to
     ClassLocal only for loopback (localhost/127.0.0.1/::1) BaseURLs —
     keeps local Ollama frictionless per §1's not-harder-than-baseline
     invariant while remote/BYO-key asks by default. Two in-repo
     precedents pull opposite ways; this is a product/security taste
     call → morning handoff item.
1a. [x] **PR1 shipped** (this branch, `goal/0031-ai-node-family`):
    pre-flight audit of every registered `NodeType`'s `ConfigFields`
    against the Configure-vs-workflow split (verdict: already fully
    consistent, zero misplacements — codified in
    `.claude/rules/architecture.md`); `internal/domain/aiprovider`
    (`AIProvider{ID,Label,Kind,BaseURL,Model}` + seeded "Local Ollama
    (localhost:11434)"); `internal/adapters/aiclient` (`openaicompat` +
    `anthropic`, one `Complete` port, httptest-proven against both wire
    shapes, structured-output request shape verified against each
    provider's own docs before building); `configuresvc` CRUD +
    Configure tab (`ConfigureAIProviders.tsx`) + `RefKind: "aiprovider"`
    + dataevent emits + MCP read resource `mill://aiproviders`;
    `process-ai-completion` (system prompt from config, user content =
    prompt + payload, output replaces payload — composition documented
    in the node's own `Description`); `EffectForNode`'s dynamic
    downgrade to `ClassLocal` for an exact localhost/127.0.0.1/::1
    `BaseURL` (owner-ratified 2026-08-12), unit-tested for port
    suffixes/IPv6 brackets/scheme edge cases; seeded "Example: Summarize
    with local AI" (disabled), proven end-to-end against real DBOS +
    an httptest fixture (`executionsvc.TestSeededAISummarizeExample_
    RunsEndToEndAgainstFixtureEndpoint`). SPEC.md §3.3/§3.5 updated.
    `ai-extract-structured`/`ai-classify` deliberately deferred to PR2
    (reviewability, per the session's own split instruction).
2. [ ] Capability map + ADR: which family members Mill builds now vs
   later; the AI-provider Configure entity (1:many, stamped recipe —
   endpoint, model, BYO key in keychain); how the guardrail treats AI
   steps (effect class; an AI call is external egress unless
   localhost — verdict needed); structured-output handling into
   Attributes (the typed-payload story).
3. [ ] Build the first members against goal 0030's node standard
   (conformance from birth): likely `ai-completion` +
   `ai-extract-structured` (writes typed Attributes — the one that
   composes with Decision routing for real decisioning workflows).
4. [ ] Seeded proof: an example workflow using a local Ollama
   endpoint (documented as requiring user setup, seeded DISABLED like
   the fs-watch example) + e2e against a fixture HTTP endpoint
   (deterministic, no real model in CI).

## Acceptance
A user with Ollama running composes "capture → AI step → guarded
action" with zero Mill code changes beyond config; the AI provider
entity is reusable across workflows; every family member passes the
0030 standard; CI proves the path with a fixture endpoint.
