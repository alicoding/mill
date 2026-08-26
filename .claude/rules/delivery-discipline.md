# Delivery discipline — Definition of Ready / Definition of Done

No `paths` frontmatter — applies to every goal, every language. Terms are
Scrum's (DoD as an artifact commitment) and Kanban's ("ready for
delivery" pull criteria) — adopted as the converged NAMES for gates this
repo already runs, consolidated here so an agent checks ONE list, not
four documents.

## Definition of Ready — before a BACKLOG.md item enters a session
- Precedent checked, not assumed (CLAUDE.md Research→Plan→Implement).
- A capability map exists for any schema/adopt-vs-build call with more
  than one real future use (CLAUDE.md Plan step, SPEC §3.3's worked
  example).
- A goal file exists: Goal/Plan/**Acceptance stated as a checkable
  predicate**, not a vibe.
- Goal files carry the frontmatter header (`id`, `status`
  `shipped`/`superseded`, `date`, `prs [..]`, `proof [..]`, `spec_refs
  [..]`) over the narrative body — populated as the goal actually ships,
  never guessed at open. It's the delivery-evidence ledger's own source
  data (`docs/goals/0164-delivery-evidence-ledger.md`); leaving it off
  means the goal is invisible to the ledger on archive.
- A bug-shaped goal's frontmatter also carries `defect_class:
  <kebab-slug>` — ONE axis ("what kind of defect"), never a second
  dimension (goal 0187's survey: misclassification risk rises with
  every added axis). Before coining a new slug, grep `defect_class`
  across `goals/` and `goals/archive/` and reuse the existing class
  that fits. **Two strikes: on the SECOND occurrence of a class, the
  goal is about the CLASS, not the instance — and its title says so.**
  Same threshold shape as testing.md's flake protocol. Older archived
  goals without the field are classified lazily, when a grep for a new
  bug surfaces them — never by bulk archaeology.
- No SPEC.md `OPEN` dependency is silently resolved by starting — surface
  the choice, or name it an explicit blocker and don't start.
- No estimate/story-point step — deliberately excluded: estimation
  negotiates shared *team* capacity, which a solo-owner +
  agent-execution loop doesn't have.

## Definition of Ready, part 2 — the integration-surfaces triage

Before a capability's goal starts, answer EVERY line below explicitly in
the goal file — "wired", "deliberately not, because …", or "follow-up
goal NNNN" — never silence:

1. **Configure** — does it introduce a "which external thing" value
   (credential/endpoint/model/list)? → Configure entity + RefKind
   (architecture.md's business-vs-integration test).
2. **Workflows** — is it composition-shaped (ADR-0035: node/trigger/
   connector)? → arrives as composition with a seeded example.
3. **Atlas** — does it produce or reference knowledge a card should point
   at (a new artifact type, a mirrorable output)?
4. **Settings** — does it need an app-level preference? (Kernel config
   only — a Settings toggle never implements a side effect.)
5. **Keyboard shortcut** — is there a repeated action deserving a
   command-registry entry (surface-scoped via `surface` when it isn't
   global)?
6. **Quick access** — palette entry (via the same command) and, for
   away-from-app entry points, a Quick Panel row.
7. **Context menu** — does it render as a right-clickable object? →
   ContextMenuItem items, sharing commandIds so menu/palette/keyboard
   stay one source.
8. **Contract/MCP** — does an agent need to see or drive it?
9. **Mobile posture** — usable (or deliberately read-only) at the
   companion breakpoints and 44px targets?
10. **Data stewardship** — does it write user data? → covered by
    export/backup/import paths.
11. **Interaction primitives** — does it add a user gesture or a UI state
    transition? The contract names the event primitives that drive each
    transition (which pointer/key/wheel event enters and ends each
    state); any focus- or blur-driven transition carries an explicit
    justification, since focus semantics are the known engine-divergence
    class (WebKit's focus and reveal-on-mousedown behavior differs from
    Chromium's).
12. **Command registry** — does it add a user-facing action (a button,
    a menu item, a click handler)? → a registered `shared/commands.ts`
    command with an honest `enabled()`, buttons calling
    `findCommand(id)?.run()` (architecture.md's command-is-the-atom
    rule, goal 0222) — "register", "deliberately mouse-only, because
    …", or "follow-up goal NNNN," never silence.

The triage is a DoR gate, not a build mandate: most answers are one
honest sentence.

## Definition of Done — before the checkbox flips and the file moves to archive/
- Local lefthook suite green, never bypassed.
- CI's `ci-gate` required check green on the **merged** PR (ADR-0034).
- Every new capability carries a seeded example + a proof at the right
  layer (testing.md's layering) — the seed is part of DoD, never a
  follow-up.
- Any bug fixed via live/manual repro is now a committed test
  (testing.md).
- SPEC.md updated in the same change, for anything that shifts what it
  describes (mechanical-only changes exempted).
- User-visible capability or behavior change ⇒ the matching `userdocs/`
  section updated in the same change; registry-derived pages regenerate
  via `go generate ./internal/docsgen` (CI-enforced freshness).
- The goal file's own Acceptance criteria checked against what SHIPPED,
  not what was planned.
- Nothing secret-shaped staged; a real commit message.
- The goal's BACKLOG.md line matches reality at close: checked box,
  archive/ link, and no stale status annotation ("building now", "PR
  pending") left behind.

## Session conduct
- **Reviewer findings get triaged, not chased**: a reviewer prompted to
  find gaps will report some even when the work is sound — act only on
  findings that affect correctness or stated requirements; the rest is
  recorded or dropped, never auto-implemented.
- **Post-merge worktree verification is a CHECKED step**: after an agent
  branch merges, confirm the worktree is actually removed (`git worktree
  list`) and HEAD sits on the intended branch — worktree cleanup has a
  confirmed upstream defect class (stale worktrees survive sessions; a
  leftover checkout makes a later merge silently no-op "Already up to
  date" against the wrong ref). Silent by design; verify, don't assume.
- **Two named session failure patterns**: the kitchen-sink session
  (unrelated tasks sharing one context — split them) and correcting the
  same thing twice (the third attempt is a restart-with-a-better-brief,
  not another correction).
- **Long arcs write state to files, not context**: compaction is lossy —
  in-session progress that must survive belongs in the goal file / a plan
  file at every significant checkpoint, so a compaction or restart
  resumes from disk, not from what the summary preserved.

## Green baseline always
Every check that runs on a PR or a main push must be GREEN. A
permanently-red job — required or informational — is the banned state: it
trains red-blindness and hides the next real failure. A check that
cannot hold green gets fixed same-day or moves OUT of the PR/main
baseline (scheduled or manual dispatch) with a register entry naming its
path back in. "Non-required" is not an exemption — it exists only as a
promotion staging lane: hold green, build the track record, then promote
to required.

## Build-health visibility
The ruleset (ADR-0034) already makes main unmergeable-red:
- `gh pr checks <n> --watch` right after opening a goal's PR.
- `gh run list -b main -L 1` once, when picking up the next goal.
No richer signal is worth building — a webhook receiver is a second
deployable, already forbidden (SPEC §1.1).

## Tech debt
A BACKLOG.md entry with the same DoR/DoD as any goal — never a second
register, never a bare TODO as the record (a comment may point at a
goal/ADR id, never stand alone).

## Deferrals need a home (goal 0128)
A deferral is only legal when the SAME sentence names its tracking home:
a goal number, a BACKLOG line, a SPEC `OPEN` item, or an explicit revisit
trigger ("revisit when X"). "Out of scope" / "not built" / "future work"
standing alone is a forgotten request in the making (review-checked, not
grep-gated — deferral phrasing is unbounded). Goal files carry a
"Deferred from this goal" section when anything in-scope was narrowed —
the home exists by construction, and the register
(docs/goals/archive/0128-deferred-register.md, then BACKLOG entries it
spawns) is part of RELEASING.md's docs review.
