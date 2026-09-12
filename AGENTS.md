# Mill agent context

Read [CLAUDE.md](CLAUDE.md) first. It remains the shared project contract.
Then read every unconditional rule below before working:

- `.claude/rules/adopt-converged-patterns.md`
- `.claude/rules/architecture.md`
- `.claude/rules/comments.md`
- `.claude/rules/delivery-discipline.md`
- `.claude/rules/testing.md`
- `.claude/rules/ux-writing.md`

Before editing or reviewing relevant files, also read these scoped rules:

| File paths | Rule |
| --- | --- |
| `**/*.go` | `.claude/rules/backend.md` |
| `frontend/src/**/*.tsx`, `frontend/src/**/*.ts` | `.claude/rules/frontend.md` |
| `internal/domain/composition/**` | `.claude/rules/node-standard.md` |

Inspect `.claude/rules/` frontmatter for additions: no `paths:` means
unconditional; otherwise load when its existing path patterns match the work.
Read only relevant `docs/SPEC.md` sections, active goals/briefs, role bodies and
skills. Do not preload the full SPEC, backlog or historical transcripts.
After compaction, re-read the active goal and written contract before continuing.

## Skills and roles

`.agents/skills/` links to the canonical `.claude/skills/` folders. Read the
applicable `SKILL.md` there (or through its canonical path) when using a skill.
Native role profiles in `.codex/agents/` point to `.claude/agents/<role>.md`;
read that body before executing a role. Preserve its scope, never-list, docs
ownership/draft requirement, review format and owner PR verification duties.

## Codex translations

These translations replace Claude-specific transport, model and attribution
examples, not the shared working discipline:

- Native role model/effort defaults live in `.codex/agents/<role>.toml`.
  They are operational assignments, not claims of Claude cost/quality equivalence.
  Leave the orchestrator model unchanged. State the actual model on dispatch;
  use a permitted runtime choice and disclose unavailable configured models.
- The current `collaboration.spawn_agent` has no named-profile or tool-allowlist
  argument. Supply the canonical role path, brief and explicit boundaries in
  its prompt; use the native profile's model/effort when exposed and permitted.
  Read-only behavior in this transport is instructed, not guaranteed sandbox
  isolation; native read-only profiles enforce it only when the host loads them.
- A reviewer starts fresh with `fork_turns=none`; never same-context review.
  Create each builder's git worktree explicitly. At most three concurrent
  children; honor any lower runtime limit and CLAUDE's heavy-gate lock.
- Track canonical `maxTurns` and brief token ceilings when metrics exist;
  disclose unavailable metrics, never invent usage or budget compliance.
- Work and Codex share one account allowance across sessions. Before every
  child dispatch/resume and after a limit error, read current weekly usage and
  reset time with the Codex usage tool or Settings; a task token counter is not
  an allowance reading. Append timestamp, goal, weekly percent, reset, active
  children and decision to local-only `docs/goals/USAGE-LEDGER.md`.
- Budget at most 12 weekly-percentage points per local day account-wide. At 10
  points, allow one live child and required delivery/review work only. At 12,
  launch/resume no child; finish the bounded turn, checkpoint, and wait for the
  next day unless the owner explicitly authorizes more after seeing the current
  snapshot. Use the lowest sufficient configured role/model; agents never poll,
  restate status, or reread known context. Stop idle children promptly.
- Continue foreground commands using `exec_command`'s `session_id` and
  `write_stdin`, with bounded waits. No `nohup` or detached gates. A tool wait
  returning a running session is foreground continuation, not abandoned work.
- Use current CLAUDE layout (`internal/services/<ctx>svc`) when the explorer's
  older root-service map differs. The command guard's rebase prohibition wins
  over older agent README guidance: merge or fix forward, never rewrite history.
- Do not fabricate Claude/Fable coauthors or Claude session URLs. Identify the
  actual tool/model only when attribution is needed and known.
- Native UI work uses available, permitted computer-use tools. Report permission
  denials; never route a denied action through a different control channel.
- Builders own bounded CI waits, fixes and merge-queue enqueue through verified
  `MERGED`; this supersedes the older builder stop-at-auto-merge instruction.
  Armed/open is not delivered. Verify actual queue state; never change branch
  protections. The orchestrator independently verifies and owns docs/closeout.
- Read `.codex/README.md` for native hook activation and lifecycle translations.
  At explicit task completion, run the canonical task-completion guard with the
  outcome subject and cwd. Perform canonical worktree cleanup only after removal
  of an owned worktree. Treat runtime denial feedback as authoritative.

Native config is prepared for a fresh session and user hook trust review;
its presence does not prove it is active in the current session.
