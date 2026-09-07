package audit

import "fmt"

// AllowedAttributes is, per Kind, the ONLY keys a producer may put in
// Entry.Attributes -- the goal 0351 Decision 1 gate: an audit row must
// never carry secret material. Every value here is a size/count/label
// already safe to log today (mcpaudit.Record and secretaudit.Record
// carried the same fields as plain columns before this envelope
// existed); a new key needs a deliberate edit here, never a silent
// pass-through of a field that might hold a credential.
var AllowedAttributes = map[Kind][]string{
	KindMCPCall: {
		"direction", "session_id", "duration_ms", "arg_bytes",
		"error_text", "parked_write_id",
	},
	KindSecretAccess: {
		"error_text",
	},
	KindBridgeCommand: {
		"error_text", "status_code",
	},
}

// ValidateAttributes rejects any key not in kind's own AllowedAttributes
// -- called by every producer's adapter before a row reaches storage.
func ValidateAttributes(kind Kind, attrs map[string]string) error {
	allowed := AllowedAttributes[kind]
	for key := range attrs {
		if !containsKey(allowed, key) {
			return fmt.Errorf("audit: attribute %q not allowed for kind %q", key, kind)
		}
	}
	return nil
}

func containsKey(keys []string, key string) bool {
	for _, k := range keys {
		if k == key {
			return true
		}
	}
	return false
}
