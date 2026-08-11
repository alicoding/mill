# Session handoff — 2026-08-11 (strategic reframe + UX polish night)

Read this first, then continue. Disposable — overwrite next session.
Tree is clean; everything below is committed to `main` and live in the
running `task dev` window.

---

## ⭐ THE BIG OUTPUT: the product finally came into focus (read this first)

**Mill's true near-term product = the local, offline, open-source
substrate that makes M365 Copilot (and/or local Ollama) usable for real
work at the bank.** The MCP/connector/canvas "platform others build on"
vision is the LONG game — right, already built, but NOT what delivers
value on the locked machine now.

**Bank ground truth (owner, this session):**
- **MCP is deny-all** — Zscaler blocks the port. Returns only once the
  **control plane Scotiabank is adopting** lands (to restrict *which* AI
  tools are allowed). So: no MCP, no HTTP connector, no egress.
- **No Confluence API, no Jira API.** Owner works in Confluence. Content
  must come from the **rendered DOM**, not an API.
- **Clipboard is unreliable** — full Confluence page copy loses structure
  / no reliable markdown. This is the core daily pain (§5's open data
  point, now confirmed).
- **No AI credits at work.** M365 Copilot (sanctioned) is the only cloud
  "brain"; owner also has **local Ollama**.

**The plan (owner's own):** dogfood + improve Mill HERE with Fable,
**open-source it**, then `git clone` + build it at work — **Zscaler scans
git clone and open-source passes**, so an OSS tool is allowed where a
random binary/service/MCP is not. This is load-bearing: open-source is
the *distribution mechanism*, and it makes Mill's locked constraints
REQUIREMENTS not principles (git-clone install, no AI API / no
phone-home, single binary, no-MCP-for-core-loop = "what survives a
bank").

**Principle locked this session: blocked ≠ unsupported.** Mill carries
the *superset* of capabilities; the environment decides which are *live*
(exactly how MCP already works — built, shipped, unusable at the bank).
Never rip a capability out because one environment blocks it.

**Near-term priority order (reordered by this reality):**
1. **Reliable structure-preserving capture from Confluence/Jira →
   markdown** (the daily pain). Keystone = §5 capture mechanism.
2. **M365 Copilot bridge (§2.1)** — capture verified context → feed
   Copilot → capture proposed command → run guarded (§6, BUILT) → paste
   back.
3. **Local Ollama AI node** (see pending decision below) — self-contained
   AI help with zero egress/credits; possibly a *bigger* near-term win
   than the M365 bridge.
4. Guarded shell execution (already built) — coding nice-to-have.

**THE gating unknown — only the owner can answer (I can't touch the bank
machine, §1.2):** *Can a browser extension even be loaded at the bank?*
§5's design is a Chrome (WXT) extension reading the DOM; enterprise
Chrome policy often blocks side-loaded extensions. If blocked, the
extension approach is dead-on-arrival and capture needs another
mechanism. **Resolve this before building capture.**

Saved to memory: `project-mill-bank-reality`, `user-plan-budget`
(updated).

---

## 🔓 PENDING DECISIONS (owner input needed)

1. **AI node — awaiting explicit confirm of this invariant wording**
   (owner directed it, I asked to confirm before editing SPEC):
   > Mill exposes AI as a user-configured node (Ollama / BYO key), but
   > never runs an autonomous decide-and-act agent loop itself — the
   > guardrail always sits between any AI output and a real action.

   This does NOT break §1.1 (which forbids Mill *itself* phoning AI /
   bundling a key / phone-home / being an autonomous agent) — an AI node
   is a user-configured connector whose backend is an LLM; §3.1 already
   says BYO-model (Ollama/any key) is in scope. **On confirm:** update
   §1.1 + §3.1 (resolve the open host/client conflict for the node case)
   + add AI node to the §3.3 capability map as the next real capability.
   Local-Ollama variant = local effect, zero egress, works at the bank.

2. **Capture-mechanism decision matrix — offered, not yet written.** Next
   deliverable I can do WITHOUT the bank machine: a matrix of the 3-4
   real capture paths (browser extension / bookmarklet / save-page-then-
   parse-HTML / hardened-clipboard), each with what it captures, markdown
   reliability, and **exactly what it needs from IS&C**. Owner takes it to
   work, finds out which survives policy, we build the winner.

---

## 🛠 HOW TO RUN MILL (settled this session — was the whole night's confusion)

- **`task dev`, started ONCE and left running, is THE way to run/iterate.**
  Hot reload: frontend edits (`frontend/src/**`) are instant Vite HMR —
  no rebuild, no reinstall. Only Go changes restart; only a bound-method
  signature change re-pays the ~20s bindings step (Task skips it
  otherwise). Now recorded in CLAUDE.md.
- **PATH:** `wails3` + `ls_lint` live in `~/go/bin` (not on default PATH).
  Prefix commands with `PATH="$HOME/go/bin:$PATH"` or add it to
  `~/.zshrc`. (Committing needs it too — lefthook's ls_lint.)
- **The green `DEV · live` badge (top-left) = the live window.** Anything
  else (`INSTALLED · <commit>` / `SERVER · <commit>`) is NOT live.
- **The installed `/Applications/Mill.app` is a FROZEN binary — it never
  hot-reloads.** `task dev` opens a SEPARATE native window; that's the
  live one. (This crossed-wire cost the whole evening — owner was staring
  at the frozen installed app expecting HMR.) Quit the installed app so
  the two don't fight over the same data files.
- **`task install:app`** = one-command correct reinstall; ONLY for real
  installed-app testing (Accessibility hotkeys, native menu,
  launch/Spotlight). Never while `task dev` runs.

---

## ✅ WHAT SHIPPED THIS SESSION (committed, live in dev window)

- `004e039` — **fixed a real launch crash**: native NSMenu mutation
  (`ReleaseMenuAccelerators`) ran off the main thread → AppKit abort on
  every launch since the keymap merge. Build-tagged `onMainThread`
  (InvokeSync desktop / inline server) wraps all menu mutations.
- `071ab84` — `task install:app` one-command reinstall target.
- `4243b6b` — Taskfile: dropped `clean` from `dev` deps + documented the
  loop (restarts stay incremental now).
- `ac47705` — **soft-tint entity icons** (Primer `-emphasis` solid fills
  → `-muted` tint + matching `-fg` glyph; owner: saturated-purple column
  "not easy on the eyes") + **build badge self-identifies the artifact**
  (green `DEV · live` / `INSTALLED` / `SERVER`; goal 0019). Extracted
  `BuildIdentityBadge.tsx` along the 500-line seam.
- `5db60a5` — **quieted the badge scatter**: `vN live` (the normal state,
  on every row) → quiet grey; only exceptions keep colour (draft/disabled/
  armed/not-live). Net: green = armed, amber = attention, grey = normal.
- `aabee6d` — **work-tab strip no longer wraps** (goal 0018): `.tabList`
  nowrap + overflow-x scroll; pinned `⌄` overflow menu (2+ tabs) = jump
  to any open tab by name + Close other tabs + Close all tabs.
- `498addd` — CLAUDE.md: recorded the definitive way to run Mill.

SPEC §3.8 + §3.7 updated in-change; goals 0015/0018/0019 recorded.

---

## 📋 PENDING BUILD WORK (not started; mostly frontend = instant HMR)

- **⌘K command palette (goal 0015)** — owner explicitly asked for it. The
  self-unblock / discoverability surface: searchable, **shows each
  command's shortcut inline** (type "tab" → see `Next tab · ⌃Tab`), runs
  workflows, jumps/closes tabs by name. Also bind ⌘? / ⌘/ to open it.
  Built on Primer `FilteredActionList`.
- **Tab overflow e2e** (goal 0018 follow-up) + optional right-click tab
  context menu.
- **Canonical type system (goal 0013)** — converge the 4 field
  vocabularies. Unlocks BOTH the platform extension contract AND the
  typed-payload authoring UX. The right "think-hard-once" next design.
- **Authoring-UX redesign** against §3.8's 6-element brief (typed payload
  sigs on cards, policy on EDGES not nodes, sparse inspectors, category
  headers, versioned payload schemas; live-run-state element #2 already
  built). Owner: current authoring/node-config UX "sucks" — it's tagged
  `UX: PROTOTYPE`, redesign is expected, bones are sound.
- Older backlog still open: realtime surfaces (0017), Lists (0011 —
  FINISHED in `wt-lists` worktree, UNMERGED, held), Home dashboard (0014),
  realtime eventing (0005).

## 💰 Budget (so I stop rationing)
~11h into the week after a full marathon: **Fable 4%, all-models 7%** →
weekly caps are effectively NON-binding at owner's working style. Lean on
Fable for judgment; delegate to Sonnet/Haiku for THROUGHPUT/parallelism,
not budget. Real constraint = owner's time + 5h session window.
Overage cap set low (CA$5) — a spill is a hard wall now.

## Testing plan (deferred — app-window confusion ate the evening)
The 7-station walkthrough never ran (kept looking at the frozen installed
app). Now that the `DEV · live` window works, testing can resume — but the
strategic build work above likely outranks it.
