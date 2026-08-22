package mcpaudit

import (
	"fmt"
	"regexp"
)

// This file holds the ONE canonical copy of gateWrite's own "parked,
// poll me" wire text (mcpsvc's park-and-poll flow, docs/adr/0032) --
// previously duplicated as a literal Sprintf in mcpsvc and a second,
// independently-written regexp in agentloopsvc (which parses its own
// tool results to detect a parked write, by its own doc comment never
// importing mcpsvc to do so). Both now call the shared functions here;
// the audit middleware (internal/services/mcpauditsvc) is the third
// consumer, detecting the SAME text to record the interim
// OutcomeParked value -- one wire contract, three readers, no
// duplicated regex.
const parkedPendingTextFmt = "parked pending human approval; id=%s; call check_write_status with this id"

// ParkedPendingText renders gateWrite's parked-pending response for id.
func ParkedPendingText(id string) string {
	return fmt.Sprintf(parkedPendingTextFmt, id)
}

var parkedWriteIDPattern = regexp.MustCompile(`parked pending human approval; id=([^;]+);`)

// ParseParkedWriteID extracts the write id from a ParkedPendingText
// string, or ok=false if text doesn't match that shape.
func ParseParkedWriteID(text string) (id string, ok bool) {
	m := parkedWriteIDPattern.FindStringSubmatch(text)
	if m == nil {
		return "", false
	}
	return m[1], true
}

// DeniedInWindowText is gateWrite's own denial-within-the-courtesy-
// window error text -- the audit middleware matches this exact string
// to distinguish OutcomeDenied from an ordinary OutcomeError.
const DeniedInWindowText = "denied by the user in Mill's window"
