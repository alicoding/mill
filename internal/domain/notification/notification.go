// Package notification holds the pure types the notification spine
// (docs/goals/0171-notification-spine.md) is built from: the durable
// Record shape, the Event a producer publishes, and the Channel
// interface every delivery destination implements. No persistence, no
// state, no adapter imports (.claude/rules/backend.md) -- storage lives
// in internal/services/notificationsvc, and each Channel implementation
// lives wherever it already owns the OS/browser mechanics it wraps
// (internal/services/settingssvc's desktop banner and dock bounce, for
// instance), never here.
package notification

import "time"

// Record is one durable notification, keyed by DedupeKey so publishing
// the same logical event twice (a restart, two independent producers
// for the same underlying item) resolves to the same Record rather than
// a duplicate. Field names follow CloudEvents' own id/type/time/data
// shape (id, type, time here as CreatedAt, data as Title+Body) --
// naming alignment only, the CloudEvents SDK itself is not imported
// (docs/goals/0171's own commodity verdict: adopt the envelope shape,
// defer the SDK).
type Record struct {
	ID        string     `json:"id"`
	Type      string     `json:"type"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	DedupeKey string     `json:"dedupeKey"`
	// SourceRef names the underlying item this notification is about
	// (a run ID, an MCP write ID, an update version) -- what a click
	// would navigate to, kept separate from DedupeKey since a future
	// producer's dedupe key and navigation target could genuinely
	// differ even though today every producer sets them equal.
	SourceRef string     `json:"sourceRef,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	ReadAt    *time.Time `json:"readAt,omitempty"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	// DeliveredChannels names every Channel that has already run
	// Deliver for this Record -- the one dedupe mechanism (goal 0171),
	// persisted alongside the record itself so it survives a reload
	// instead of resetting the way two separate in-memory Sets used to.
	// A channel appears here at most once; a Publish call for an
	// already-published DedupeKey re-attempts only the channels still
	// missing from this list, so a second producer of the same logical
	// event (e.g. a second browser tab) still gets ITS OWN channel
	// delivered without re-delivering one that already fired.
	DeliveredChannels []string `json:"deliveredChannels,omitempty"`
}

// Event is what a producer hands to Publish -- Record's input-facing
// counterpart, the same input/full-record split MCPWriteRequest/
// MCPWriteRecord already establish (millmcpservice_approval.go).
type Event struct {
	Type      string `json:"type"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	DedupeKey string `json:"dedupeKey"`
	SourceRef string `json:"sourceRef,omitempty"`
	// Focused is the producer's own presence reading for the surface
	// that originated this event (a frontend's document.hasFocus()),
	// threaded through rather than read here since only the caller
	// knows it. The zero value (false) fails toward "away" -- a
	// backend-originated event with no window to read focus from (a
	// run finishing unattended) is exactly the case a channel's
	// presence gate should err toward delivering for, not suppressing.
	Focused bool `json:"focused"`
}

// Channel is one notification delivery destination. ShouldDeliver and
// Deliver are split so the registry can decide whether a channel wants
// this event without ever calling into OS/browser-bound code -- the
// same reason settingssvc's own dockBounceFn is a swappable package
// var rather than inlined, applied here at the interface level so a
// headless test can register a channel and assert ShouldDeliver's
// verdict without touching real notification machinery.
type Channel interface {
	// Name identifies this channel in Record.DeliveredChannels -- must
	// be stable across a process restart (it's compared against
	// persisted data) and unique among registered channels.
	Name() string
	ShouldDeliver(evt Event) bool
	Deliver(evt Event, rec Record) error
}
