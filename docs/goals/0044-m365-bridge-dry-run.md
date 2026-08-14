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
9. Does the work M365 Copilot ground on a `.md`/`.txt` file sitting
   in the personal OneDrive folder, or only Office formats? Decides
   the scratch file's extension (fallbacks are trivial: `.txt`, or a
   periodic save-as-docx step). The scratch-hub loop below depends on
   Copilot being able to READ the synced scratch; write-back stays
   Mill-side either way.

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

## Scenario-2 gap verification — resolved 2026-08-14 (research-verified)

"Verify, don't assume" pass, run against the code, with the gap fix
shipped in the same change:

- **File-append apply step: was a real gap, now closed as
  `apply-file-write`** (`internal/domain/composition/applyfilewrite.go`
  — append/overwrite modes, `~`-expanded literal path,
  create-missing-folders, optional datetime entry stamps; effect
  `local` per ADR-0022, ungated by default, so hotkey capture stays
  one keystroke). Passed the ADR-0035 multi-use test on its own
  merits: log/CSV/any-accumulation workflows and "write the processed
  result where another tool reads it" are same-step-different-target
  uses; it is also the symmetric write inverse of the already-shipped
  `capture-file`. Config shape adopted from the converged
  self-hosted-platform precedent, primary-source-verified (research
  agent, 2026-08-14): n8n's Read/Write Files from Disk (append
  toggle), Node-RED's core `file` node (append/overwrite +
  create-directory option + write-time newline shaping — the
  precedent class for the timestamp option), Huginn's `LocalFileAgent`
  (append boolean + templated path). Cloud-native platforms (Zapier,
  Make) have no local-file primitive at all — absence checked, not
  assumed. Mill's path stays literal (no templating engine, SPEC
  §3.3's standing decision); the "dated scratch" need is met by
  write-time entry stamps instead of dated *filenames*, which is what
  path templating would otherwise have existed for. Seeded proof:
  "Example: Scratch capture" (manual trigger → clipboard capture →
  append to `~/Mill Scratch/scratch.md` with stamps; no seed arms a
  global hotkey by default — the user assigns one).
- **`code-execution` could NOT paper over the gap — and payload-on-
  stdin is named, not built.** A literal script never receives the
  payload (`procexec.Spec` has no stdin field; ExecEnv env is fixed
  config), and `source: payload` runs the payload AS the command —
  wrong semantics and shell-injection-shaped for note text. Extending
  code-execution with payload-on-stdin (literal scripts as Unix
  filters: pandoc, jq, the convert2mermaid glue in checklist item 8)
  has split precedent: Huginn's ShellCommandAgent ships a first-class
  `stdin` option; Node-RED built exactly this in community PR #4880
  and closed it unmerged citing no demonstrated demand; n8n's Execute
  Command has neither and is disabled by default since v2.0 for
  injection-class risk. Verdict: not built now — with
  `apply-file-write` shipped, no scenario-2 step needs it; build it
  when a workflow actually needs a filter step, judged then against
  ADR-0035.
- **Render+open (read workflow): confirmed single-use, not built** —
  exactly as the boundary guard pre-flagged. Its only driver is
  reading these notes; if payload-on-stdin ever lands, md→HTML→open
  becomes user-composed glue with zero Mill surface, the right shape
  for it.

**Direction split confirmed from the far side (owner-reported
2026-08-14): the work M365 Copilot is read-only over OneDrive/
Notebook/Loop content — it cannot write any of them.** This is not a
blocker; it is the division of labor the bridge already assumes:
Copilot reads and reasons (the direction it's allowed and the
direction that's hard for a human), the human clipboard hop is the
approval gate, and Mill is the local hand that writes. The scattered
work surfaces (physical notebook, Excel, Loop, OneNote) resolve into
one loop: a plain scratch file in a OneDrive-synced folder is the
single writable substrate (Mill appends via hotkey capture; the sync
client, not Mill, moves bytes — the no-outbound-calls constraint
holds); Copilot reads the synced scratch plus everything else it
already indexes and does the organizing/reformatting; results return
over the clipboard bridge and Mill applies them locally. Loop/OneNote/
Excel become read-sources Copilot mines, not places the owner
maintains by hand. Checklist item 9 above is the one unknown gating
the file extension.

With the node shipped, scenario 2 composes end to end from existing
steps: capture = trigger (manual in the seed; hotkey once assigned) →
clipboard capture → `apply-file-write` (append + stamps); reformat =
`capture-file` → AI completion (home) or the M365 clipboard bridge
(work) → `apply-file-write` (overwrite); read = deliberately out of
scope per the boundary verdict above.

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
