// Package main implements devguard, the `task dev` concurrent-start
// check (docs/goals/BACKLOG.md Standing #8b, owner-hit 2026-08-12
// evening: THREE concurrent mill.dev.app instances in the dock, a real
// crash risk on a 16GB machine). Root cause: `task dev` run a second
// time while a first session was already live -- the existing
// orphan-sweep (Taskfile.yml's `dev:` task, goal 0029) unconditionally
// kills whatever's on the Vite port and any leftover mill.dev.app
// process before starting, which is exactly correct for a genuine
// orphan (a SIGHUP'd terminal's leftover, goal 0029's own target) but
// WRONG for a second concurrent `task dev`: it would kill the FIRST
// session's live vite/app instead of refusing to start, leaving two
// half-torn-down dev loops running against the same data files
// (CLAUDE.md's own never-two-data-sharing-instances rule).
//
// devguard runs as the FIRST step of Taskfile.yml's `dev:` task, before
// the destructive sweep steps: it checks for an already-running
// `wails3 dev` process for THIS repo (the authoritative "is a session
// already live" signal -- matched on the config path Taskfile.yml
// always passes, not just the bare "wails3 dev" substring, so an
// unrelated Wails project's own dev loop elsewhere on the machine never
// false-positives) and exits non-zero, naming the conflicting PID, if
// one is found. Task aborts the whole `dev:` task on the first failing
// step (its own default), so the sweep below never runs in that case.
//
// A bare occupied Vite port with NO live `wails3 dev` process is
// deliberately NOT a block condition here -- that's exactly the
// orphaned-vite-from-a-SIGHUP'd-terminal case goal 0029's sweep already
// exists to clean up safely; blocking on the port alone would break
// that legitimate recovery path. The port is still checked and
// reported as corroborating detail in the refusal message when a live
// process IS found, per this item's own "check vite port + running
// wails3 dev process" spec -- just not as an independent trigger.
package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// process is one line of `ps -axwwo pid=,command=` output. A plain
// struct (not tied to exec.Cmd) so parsing/decision logic below is
// unit-testable without actually running ps -- see guard_test.go.
type process struct {
	pid     int
	command string
}

// parseProcesses parses `ps -axwwo pid=,command=` output. Tolerant of
// the leading whitespace ps pads the pid field with; skips any line
// that doesn't start with a valid integer PID rather than failing the
// whole scan over one malformed line.
func parseProcesses(output string) []process {
	var procs []process
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.SplitN(line, " ", 2)
		pid, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}
		command := ""
		if len(fields) == 2 {
			command = strings.TrimSpace(fields[1])
		}
		procs = append(procs, process{pid: pid, command: command})
	}
	return procs
}

// wailsDevMarker is the exact combined substring that identifies THIS
// repo's own `wails3 dev` invocation, spelled precisely the way
// Taskfile.yml's `dev:` task always invokes it (`wails3 dev -config
// ./build/config.yml -port ...`). Deliberately ONE combined string, not
// two independent "wails3 dev" + "build/config.yml" checks: a wails3 v3
// project's default scaffold always names its config `build/config.yml`
// relative to ITS OWN root, so a bare AND of the two loose substrings
// would false-positive on a DIFFERENT wails3 project's own dev loop
// running elsewhere on the same machine (e.g. `-config
// ./other-project/build/config.yml` contains "build/config.yml" too).
// The combined "-config ./build/config.yml" substring only matches this
// repo's own relative invocation path, confirmed against a real
// false-positive this exact scenario produced in guard_test.go before
// being tightened to this shape.
const wailsDevMarker = "-config ./build/config.yml"

// findWailsDevProcess returns the first process that looks like this
// repo's own already-running `wails3 dev` supervisor, excluding
// selfPID (devguard's own process never matches "wails3 dev" in
// practice, but excluding it keeps the function correct regardless).
// Returns nil if none is running.
func findWailsDevProcess(procs []process, selfPID int) *process {
	for i := range procs {
		p := procs[i]
		if p.pid == selfPID {
			continue
		}
		if strings.Contains(p.command, "wails3 dev") && strings.Contains(p.command, wailsDevMarker) {
			return &p
		}
	}
	return nil
}

// parsePIDList parses `lsof -ti :<port>` output -- one PID per line,
// empty when nothing is bound to the port.
func parsePIDList(output string) []int {
	var pids []int
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if pid, err := strconv.Atoi(line); err == nil {
			pids = append(pids, pid)
		}
	}
	return pids
}

func joinInts(ints []int) string {
	strs := make([]string, len(ints))
	for i, n := range ints {
		strs[i] = strconv.Itoa(n)
	}
	return strings.Join(strs, ", ")
}

// blockedMessage formats the refusal Taskfile.yml's `dev:` task prints
// before exiting non-zero -- names the actual conflicting PID so the
// owner can act on it directly (kill it, or find its terminal) instead
// of guessing. Only called once devProc is known non-nil (main's own
// gate); portPIDs is optional corroborating detail.
func blockedMessage(devProc *process, portPIDs []int, port int) string {
	var b strings.Builder
	b.WriteString("task dev is already running -- Mill's own never-two-data-sharing-instances rule (CLAUDE.md) forbids a second concurrent dev loop.\n")
	fmt.Fprintf(&b, "  wails3 dev is already running (PID %d).\n", devProc.pid)
	if len(portPIDs) > 0 {
		fmt.Fprintf(&b, "  Vite dev port %d is also bound (PID %s).\n", port, joinInts(portPIDs))
	}
	b.WriteString("Stop the existing session first (kill the PID above, or Ctrl-C its terminal) before starting a new one.")
	return b.String()
}

func main() {
	port := flag.Int("port", 9245, "the Vite dev-server port to check")
	flag.Parse()

	// Deliberately exec.Command, not exec.CommandContext: this is a
	// short-lived, one-shot CLI invocation (not a long-running server
	// request) with no cancellation source to plumb through --
	// mirrors internal/adapters/procexec.go's own identical precedent
	// and reasoning. Args are fully static (ps) or a parsed int flag
	// formatted into a port spec (lsof, never untrusted/user-supplied
	// text), not a shell-injection-shaped input.
	psOutput, psErr := exec.Command("ps", "-axwwo", "pid=,command=").Output() //nolint:gosec,noctx // static args, one-shot CLI tool, no request context to plumb through
	// lsof exits non-zero with empty output when nothing is bound to
	// the port -- the common case, not a real error worth surfacing;
	// its error is deliberately ignored here, only the (possibly empty)
	// output matters.
	lsofOutput, _ := exec.Command("lsof", "-ti", fmt.Sprintf(":%d", *port)).Output() //nolint:gosec,noctx // port is a parsed int flag, not untrusted input; one-shot CLI tool

	if psErr != nil {
		// Fails OPEN, not closed: a missing/broken `ps` on the host is
		// a worse regression than the orphan-accumulation bug this
		// guards against -- never block every dev-loop start over a
		// tooling gap.
		fmt.Fprintf(os.Stderr, "devguard: couldn't list processes (%v) -- skipping the concurrent-start check\n", psErr)
		os.Exit(0)
	}

	procs := parseProcesses(string(psOutput))
	devProc := findWailsDevProcess(procs, os.Getpid())
	if devProc == nil {
		os.Exit(0)
	}
	portPIDs := parsePIDList(string(lsofOutput))
	fmt.Fprintln(os.Stderr, blockedMessage(devProc, portPIDs, *port))
	os.Exit(1)
}
