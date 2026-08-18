package main

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

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
	for _, line := range strings.Split(string(psOutput), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.SplitN(line, " ", 2)
		if len(fields) != 2 {
			continue
		}
		if _, err := strconv.Atoi(fields[0]); err != nil {
			continue
		}
		command := fields[1]
		if strings.Contains(command, "wails3 dev") && strings.Contains(command, "-config ./build/config.yml") {
			return fmt.Errorf("task dev is already running (%s) -- stop it first; a second concurrent desktop window risks the same crash class internal/devguard guards `task dev` against", command)
		}
		if strings.Contains(command, "Mill.app/Contents/MacOS/mill") {
			return fmt.Errorf("the installed Mill.app is already running (%s) -- quit it first before running the bridge smoke, which launches its own separate desktop window", command)
		}
	}
	if portInUse(mcpHost, mcpPort) {
		return fmt.Errorf("%s:%d is already bound -- another -tags mcp instance (or something else) is already listening there", mcpHost, mcpPort)
	}
	return nil
}
