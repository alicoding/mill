#!/usr/bin/env bash
# Checks source reachability and exercises configured guards without executing
# the tool-input command. Full hook-object equality rejects extra executable
# handlers before any command from configuration is used by the probes.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
root="$PWD"
fail() { echo "codex-context: $*" >&2; exit 1; }

for source in .claude/skills/*; do
  [[ -d "$source" && -f "$source/SKILL.md" ]] || fail "invalid canonical skill $source"
  name="${source##*/}"
  bridge=".agents/skills/$name"
  [[ -L "$bridge" && "$(readlink "$bridge")" == "../../$source" && -f "$bridge/SKILL.md" ]] || fail "broken skill bridge $bridge"
done
for bridge in .agents/skills/*; do
  [[ -d ".claude/skills/${bridge##*/}" ]] || fail "extra skill bridge $bridge"
done

# Native TOML is deliberately a tiny fixed shape. Compare complete contract
# lines rather than inventing a TOML parser or adding a gate dependency.
for source in .claude/agents/*.md; do
  name="${source##*/}"; name="${name%.md}"
  [[ "$name" == README ]] && continue
  profile=".codex/agents/$name.toml"
  [[ -f "$profile" ]] || fail "missing profile $name"
  case "$name" in
    explorer) model=gpt-5.6-luna; effort=medium ;;
    reviewer) model=gpt-5.6-luna; effort=high ;;
    architect) model=gpt-6-astra; effort=high ;;
    builder|closeout|pr-shepherd|research|test-investigator|verifier) model=gpt-5.6-sol; effort=high ;;
    *) fail "new canonical role $name needs an explicit native assignment" ;;
  esac
  # Descriptions are the only editorial line; constrain their TOML syntax.
  description=$(sed -n '2p' "$profile")
  [[ "$description" =~ ^description\ =\ \"[^\"\\]+\"$ ]] || fail "invalid description in $profile"
  expected=$(printf 'name = "%s"\n%s\nmodel = "%s"\nmodel_reasoning_effort = "%s"\n' "$name" "$description" "$model" "$effort"
    case "$name" in architect|explorer|research|reviewer) echo 'sandbox_mode = "read-only"' ;; esac
    printf 'developer_instructions = """\nRead AGENTS.md first, then .claude/agents/%s.md.\nExecute that canonical role body with the Codex translations in AGENTS.md.\nHonor the dispatched brief, role boundaries and available runtime limits.\n"""' "$name")
  [[ "$(cat "$profile")" == "$expected" ]] || fail "native profile contract drift: $profile"
done
for profile in .codex/agents/*; do
  name="${profile##*/}"; name="${name%.toml}"
  [[ "$profile" == *.toml && "$name" != README && -f ".claude/agents/$name.md" ]] || fail "extra profile $profile"
done
[[ "$(cat .codex/config.toml)" == $'[agents]\nmax_concurrent_threads_per_session = 3' ]] || fail 'native concurrency configuration drift'
for rule in .claude/rules/*.md; do
  grep -Fq "$rule" AGENTS.md || fail "router missing $rule"
done
grep -Fq 'CLAUDE.md' AGENTS.md || fail 'router missing canonical context'

jq -e --slurpfile canonical .claude/settings.json '
  . == {hooks: {
    UserPromptSubmit: $canonical[0].hooks.UserPromptSubmit,
    PreToolUse: [{matcher:"Bash", hooks:[
      {type:"command",command:"bash \"$(git rev-parse --show-toplevel)/scripts/hook-build-guard.sh\""},
      {type:"command",command:"bash \"$(git rev-parse --show-toplevel)/scripts/hook-command-guard.sh\""}
    ]}],
    SessionStart: [{hooks:[{type:"command",command:"bash \"$(git rev-parse --show-toplevel)/scripts/sweep-stale-servers.sh\""}]}]
  }}' .codex/hooks.json >/dev/null || fail 'native hooks differ from intended canonical mappings'

scratch=$(mktemp -d "${TMPDIR:-/tmp}/mill-codex-context.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
source scripts/lib/git-fixture.sh
# Fixture environment changes stay in a subshell; a commit hook's exported
# git environment must never redirect these operations at the real index.
(
  git_fixture_init "$scratch/clean"
  git_fixture_init "$scratch/dirty"
  touch "$scratch/dirty/untracked"
  probe() {
    local index="$1" want="$2" cwd="$3" command_text="$4" hook input got
    hook=$(jq -r --argjson i "$index" '.hooks.PreToolUse[0].hooks[$i].command' "$root/.codex/hooks.json")
    input=$(jq -cn --arg cwd "$cwd" --arg command "$command_text" '{hook_event_name:"PreToolUse",cwd:$cwd,tool_name:"Bash",tool_input:{command:$command}}')
    got=0
    printf '%s\n' "$input" | (cd "$root/scripts" && bash -c "$hook") >"$scratch/probe.log" 2>&1 || got=$?
    [[ "$got" == "$want" ]] || fail "guard $index expected $want, got $got for inert input: $command_text"
  }
  probe 0 0 "$scratch/clean" 'task build'
  probe 0 2 "$scratch/dirty" 'task build'
  probe 0 0 "$scratch/dirty" 'git status'
  probe 1 2 "$scratch/clean" 'git push --force origin main'
  probe 1 2 "$scratch/clean" 'git rebase origin/main'
  probe 1 0 "$scratch/dirty" 'git status'
)
bash scripts/check-hook-command-guard.sh
echo 'codex-context: bridges and configured guard probes OK'
