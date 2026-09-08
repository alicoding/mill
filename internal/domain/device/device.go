// Package device holds Mill's read-only device directory (docs/goals/
// 0372): the paired phones, browsers, and webhook tokens
// internal/services/remoteauthsvc already tracks, restated as ONE
// addressable vocabulary a workflow step can offer a picker over. A
// leaf package deliberately (zero internal imports beyond stdlib,
// mirroring internal/domain/typedfield): composition's config-field
// schema names a runtime source by a plain string
// (typedfield.Field.OptionsSource == "devices"), never this package
// directly, so composition/decision/list stay free to declare an array
// field without importing remoteauthsvc's storage layer.
package device

import (
	"slices"
	"time"
)

// Kind is the vocabulary of paired-credential SHAPES a Ref can be --
// distinct from remoteauthsvc's own storage-level kind strings (""/
// "browser"/"hook"), which are an implementation detail the
// remoteauthsvc adapter translates away from.
type Kind string

const (
	KindPhone        Kind = "phone"
	KindBrowser      Kind = "browser"
	KindWebhookToken Kind = "webhook-token"
)

// Ref is one paired credential's read model for composition: enough to
// label it in a picker and decide whether it can receive a given
// event. Never carries the credential itself (remoteauthsvc's own
// DeviceInfo already excludes that) -- this is a directory entry, not
// an auth artifact.
type Ref struct {
	ID         string    `json:"id"`
	Label      string    `json:"label"`
	Kind       Kind      `json:"kind"`
	LastSeenAt time.Time `json:"lastSeenAt"`
	// Accepts names the event kinds this device can receive (Home
	// Assistant's per-device capability discovery, docs/goals/0372
	// decision 3 -- v1 vocabulary: only "notification" is ever actually
	// delivered). A ref whose Accepts doesn't intersect a field's own
	// Needs is never offered by that field's picker. Empty means this
	// device accepts nothing composition can address yet (a webhook
	// token is an inbound-only credential).
	Accepts []string `json:"accepts"`
}

// Directory lists every paired device, browser, and webhook token as
// one directory -- the port composition's frontend picker resolves the
// "devices" OptionsSource through. remoteauthsvc is the only adapter
// today (remoteauthservice_directory.go).
type Directory interface {
	List() []Ref
}

// Filter returns every ref in refs whose Accepts intersects needs --
// the "declared need" half of the OptionsSource contract
// (typedfield.Field.Needs). Empty needs returns refs unfiltered, since
// no declared need means no filter.
func Filter(refs []Ref, needs []string) []Ref {
	if len(needs) == 0 {
		return refs
	}
	out := make([]Ref, 0, len(refs))
	for _, r := range refs {
		if acceptsAny(r.Accepts, needs) {
			out = append(out, r)
		}
	}
	return out
}

func acceptsAny(accepts, needs []string) bool {
	for _, a := range accepts {
		if slices.Contains(needs, a) {
			return true
		}
	}
	return false
}
