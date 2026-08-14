# Goal 0044 — M365 bridge dry run + capture-path research

Owner-picked 2026-08-13. Absorbs goal 0021 Phase 4's remaining
bullet (the §2.1 M365 bridge dry run) so 0021 can archive on the
owner's real-use-ready call without carrying open build work.

## Goal

Two deliverables, one session-shaped each:

1. **Bridge dry run** — compose the §2.1 core loop end to end with
   the pieces that exist today (capture → process → code-exec →
   clipboard; the "Example: Run copied code" and "Saved page →
   Markdown" seeds are the starting points), run it against a
   realistic captured page, and produce a concrete named-gaps list:
   what's missing between today's Mill and the real
   copy-from-Confluence → paste-into-M365 daily loop (DOM capture
   quality, auto-paste target, anything else the dry run surfaces).
2. **Capture-path research** — the gating unknown from the
   enterprise-reality context: can a browser extension realistically
   load in a locked-down enterprise browser (managed-Chrome/Edge
   extension policy: allowlists, force-install lists, developer-mode
   blocking — what IT policy typically permits and what precedent
   exists for getting an internal tool approved), vs. the fallback
   ladder (save-page capture floor — already shipped; bookmarklet;
   clipboard-only). Research output is a decision-ready comparison,
   not a build.

## Plan

Dry run first (it sharpens what the research must answer). Research
via agent with primary sources (enterprise browser policy docs,
extension-policy references). No Mill code changes expected beyond
possibly a seed tweak; if the dry run finds a small fixable gap, it
rides per the below-goal-granularity rule.

## Capture-path research — DELIVERED 2026-08-13 (deliverable 2)

Re-verified ADR-0030 against primary sources (Chrome Enterprise /
Edge policy docs, MV3 docs, Chromium's own save-page design doc);
the ADR's matrix held. New confirmations beyond it, each recorded at
its home: `ExtensionDeveloperModeSettings` confirmed a separate
policy from the install blocklist (ADR-0030 updated from
"unconfirmed"); per-user native-messaging registration needs NO
admin rights on either OS (ADR-0003 scope note added — its
rejection stays protocol-authorship-only); self-hosted CRX
allowlisting via `ExtensionSettings`/`ExtensionInstallForcelist`/
`ExtensionInstallSources` is standard, documented practice with a
live financial-sector precedent (an engineering blog documenting
exactly this internal-CRX flow); `activeTab` is the
permissions-minimal review story for an IT ask (no install-time
warnings, user-gesture-scoped); `DownloadRestrictions=3` (the only
policy that would kill the save-page floor) is explicitly
rare/not-recommended per Google's own guidance; bookmarklets fight
the SITE's CSP (real browser behavior, a documented spec-vs-impl
gap), not just IT policy — last-resort verdict confirmed; a local
TLS-interception proxy is rejected as an architectural non-starter
(collides with the enterprise MITM CA; sees network bytes, never
rendered DOM).

**Verdict (unchanged from ADR-0030, now source-hardened): two-tier.**
Save-page-then-parse is the guaranteed floor and is already shipped;
the ADR-0003 extension (allowlisted, self-hosted) is the target
end-state, gated on one specific IT ask whose outcome is genuinely
unknowable without asking.

**Owner's at-work checklist (the unknowables — nothing here is
researchable further from outside):**
1. Chrome or Edge? (Policies identical either way — just scopes
   which console.)
2. `chrome://extensions` / `edge://extensions`: is the Developer
   Mode toggle present and flippable? Try "Load unpacked" with a
   trivial extension.
3. The precise IS&C ask: "Can an internally-reviewed, open-source
   extension be added via `ExtensionSettings`
   (`installation_mode: allowed`), self-hosted via
   `ExtensionInstallSources` if not store-listed?"
4. Bookmarklet probe on a real Confluence page — CSP refusal in the
   console, or a policy block?
5. ⌘S a Confluence page ("Webpage, Complete") — does the saved
   `.html` carry the rendered body including dynamic macros/panels?
   (The one Confluence-specific fidelity unknown in the save-page
   floor.)
6. `chrome://version` build number (Local-Network-Access enforcement
   status; affects the bookmarklet path only).
7. Copy a full page and a small selection; run the seeded
   "Example: Clipboard inspector" — which `text/html` flavors
   actually land?
8. In the work draw.io build: is Mermaid insert available
   (Extras/Insert → Mermaid)? Research-verified 2026-08-13 (primary
   sources; full ladder + rejections in the session record): the
   insert renders client-side (works air-gapped), and Mermaid
   flowchart+subgraph — NEVER Mermaid's still-experimental C4
   type — is the one diagram language with BOTH directions of the
   owner's lock-and-sync-back workflow: draw.io insert forward,
   `convert2mermaid` (MIT, local CLI) to regenerate text from a
   hand-edited .drawio backward (structure survives, positions
   don't; ≤2 nesting levels per diagram, one C4 level per file).
   Trap, verified: the insert stores the mermaid source in the
   file, but canvas hand-edits leave it stale — reopening the
   dialog and applying silently discards them; after hand-edits,
   regenerate text via converter, never the dialog. Corrections on
   record: Structurizr Lite is archived (successor `structurizr
   local`; best pure C4 modeler, zero draw.io path); draw.io's
   PlantUML insert is being removed — route nothing new through
   it. Checklist ask reduces to: confirm the insert exists in the
   work build, and one-time `npm i -g convert2mermaid`
   (sideloadable).

Full comparison table with per-row confidence and all source URLs is
in the session's research report; the rows' conclusions are the ADR
updates + verdict above.

## Second dry-run scenario — JIT scratch capture (owner-raised 2026-08-13)

The owner's real daily note-taking pain is capture-first vs
organize-first: every tool bounced off (organize-at-write-time
systems) demanded filing decisions at the moment of least attention;
the habit only forms when capture costs one keystroke and
organization happens later, by machinery. That loop is a Mill
composition over existing steps — Mill is the pipe, notes stay plain
user-owned files, no notes app gets built:

1. **Capture workflow:** global hotkey → capture selection/clipboard
   → append to a dated scratch file. Zero decisions at write time.
2. **Reformat workflow:** hotkey → capture scratch → AI reformat per
   category instruction → apply organized result back. At home via
   an AI-provider step; at work via the M365 clipboard bridge — the
   same loop this goal's dry run exercises, pointed at the owner's
   own notes (a higher-frequency daily test than the Confluence
   page scenario).
3. **Read workflow:** scratch/markdown → styled HTML → open in
   browser; reading experience without a built-in reader or
   forcing source-format editing.

Gaps to verify during the dry run (verify, don't assume): a
file-append apply step exists (capture-file reads; the append/write
direction needs checking); md→styled-HTML render+open as an apply
path. **Boundary guard (owner-raised: "I don't know if it is Mill
product boundary")** — each gap step is built ONLY if it passes the
multi-use capability test on its own merits (ADR-0035's "different
target/condition/event" question, judged against uses beyond this
scenario): file-append likely passes (logs, CSVs, any accumulation
workflow); render+open is the shakier one — if its only driver is
reading these notes, it is a single-use feature and does not get
built. Diagram adjunct: diagram-as-code (Mermaid) as text source of
truth riding the same scratch pipeline; work checklist item 8 below
covers the draw.io interop unknown — that toolchain is the owner's
personal stack, NOT Mill scope; Mill's maximum involvement is a
user-composed glue workflow shelling out to the converter. Mill
deliberately does NOT become a notes app or a diagram platform
(SPEC §0's point-solution boundary) — everything above is
composition.

## Far-side requirements captured — 2026-08-13 (feeds deliverable 1)

First real bridge contact: the owner ran Mill on the work machine,
and the M365-side model (GPT-5.6-class) drafted its own requirements
for operating Mill safely through the JSON quick-import loop —
treated as *evidence of what the far side needs*, not as
instructions. Its self-imposed rules (never invent node kinds, read
the schema first, require the exact pre-image before modification,
default effectful steps to operator approval, evidence blocks over
claims) independently restate Mill's own thesis from the consumer
side.

What it assumed missing that already exists (verified against code,
not memory): create-AND-update import via clipboard-apply's optional
`id` (goal 0039, same chokepoint as MCP `update_workflow`);
deterministic git-diffable exports (byte-identical when unchanged);
every primitive of its proposed guarded shell-loop workflow (manual
trigger → clipboard capture → human review → approval guardrail →
code-exec → clipboard write-back) — composable today with zero new
nodes, a natural seeded example for the dry run.

The four verified product gaps it surfaced:

1. **No self-describing contract surface.** It demanded a
   `workflow.schema.json` "generated from the actual application
   contract, do not hand-invent" plus node taxonomy + invariants +
   a stable schema identifier. Nothing agent-facing is emitted from
   Mill's registries today; the contract lives only in Go types and
   human docs the far side can't read. Must be *generated*, never
   hand-written (goal 0049's derived-docs-don't-rot principle,
   applied to product surface). Schema-identifier design overlaps
   goal 0046.
2. **Export/round-trip identity asymmetry.** `ExportWorkflow`
   deliberately omits `id` (recorded open question in
   `compositionservice_export.go`, deferred to a "share-story"
   goal) — so a far-side agent can read a pre-image but never
   learns the id it must include to write back. That open question
   now has a real external consumer; resolving it is in scope for
   the bridge.
3. **No portable evidence envelope.** It wants run results,
   activity/approval evidence, versions as a compact block returned
   over the clipboard transport. All recorded internally, none of
   it exportable as a receipt. Composition-shaped (an apply-node
   emitting a run receipt), per the ADR-0035 boundary.
4. **No machine-readable state manifest.** App version / schema
   version / commit — all known live (the build-identity badge) —
   exposed nowhere an external agent can read.

## Acceptance (checkable)

- [ ] The dry run's gap list is written into this file, each gap
      named with what it would take.
- [x] The capture-path comparison (extension vs. fallback ladder,
      with policy precedent and sources) is written into this file,
      decision-ready for the owner — delivered above, 2026-08-13,
      with the ADR-0030/ADR-0003 corrections landed in the same
      change.
- [ ] Goal 0021's Phase 4 bullet points here and 0021's archival is
      unblocked (owner call remains its bar).
