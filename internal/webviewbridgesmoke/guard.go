package main

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// process is one line of `ps -axwwo pid=,command=` output -- same shape
// as internal/devguard's own, kept local since the two packages can't
// share an unexported type across package main boundaries.
type process struct {
	pid     int
	command string
}

// parsePSOutput parses `ps -axwwo pid=,command=` output, tolerant of a
// malformed line the same way internal/devguard's parseProcesses is
// (skips it rather than failing the whole scan).
func parsePSOutput(output string) []process {
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

// findConflictingProcess scans for either of the two conflicting-
// instance shapes this script refuses to run alongside: this repo's
// own `task dev` (same marker internal/devguard matches on: `wails3
// dev` plus its `-config ./build/config.yml` invocation path, so an
// unrelated project's own dev loop never false-positives) or the
// installed Mill.app. Returns the matched process and a reason
// sentence naming which one, or found=false when neither is running.
func findConflictingProcess(procs []process) (proc process, reason string, found bool) {
	for _, p := range procs {
		if strings.Contains(p.command, "wails3 dev") && strings.Contains(p.command, "-config ./build/config.yml") {
			return p, fmt.Sprintf("task dev is already running (%s) -- stop it first; a second concurrent desktop window risks the same crash class internal/devguard guards `task dev` against", p.command), true
		}
		if strings.Contains(p.command, "Mill.app/Contents/MacOS/mill") {
			return p, fmt.Sprintf("the installed Mill.app is already running (%s) -- quit it first before running the bridge smoke, which launches its own separate desktop window", p.command), true
		}
	}
	return process{}, "", false
}

// guardNoOtherInstance refuses to launch a second real desktop window
// alongside one that's already running -- mirrors internal/devguard's
// own approach (a `ps` scan for this repo's own dev-loop marker) plus
// two checks devguard doesn't need: the INSTALLED app (a real user
// session, not a dev loop) and the MCP port itself, since this script
// launches a genuine second Cocoa window rather than serving over
// server-mode HTTP. Refuses only -- never kills a conflicting process.
func guardNoOtherInstance() error {
	psOutput, err := exec.Command("ps", "-axwwo", "pid=,command=").Output() //nolint:gosec,noctx // static args, one-shot CLI tool
	if err != nil {
		return fmt.Errorf("couldn't list processes to check for a conflicting Mill instance: %w", err)
	}
	if _, reason, found := findConflictingProcess(parsePSOutput(string(psOutput))); found {
		return fmt.Errorf("%s", reason)
	}
	if portInUse(mcpHost, mcpPort) {
		return fmt.Errorf("%s:%d is already bound -- another -tags mcp instance (or something else) is already listening there", mcpHost, mcpPort)
	}
	return nil
}
