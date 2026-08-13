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

Full comparison table with per-row confidence and all source URLs is
in the session's research report; the rows' conclusions are the ADR
updates + verdict above.

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
