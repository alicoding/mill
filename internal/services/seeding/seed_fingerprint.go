package seeding

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/execenv"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/list"
	"github.com/alicoding/mill/internal/domain/mcpserver"
	"github.com/alicoding/mill/internal/domain/seedorigin"
)

// SeedFingerprint is one golden's committed authoring record
// (docs/goals/0037 item 7): the SeedRevision the code currently
// declares, and a content hash. seed_fingerprint_test.go compares this
// against every golden's ACTUAL current content+revision on every CI
// run -- a content change without a matching revision bump fails the
// build, since that's exactly the "shipped content silently changed
// but nothing signals existing installs should reconsider it" gap this
// whole goal exists to close. The hash itself is authoring-time CI
// enforcement, never runtime drift detection (docs/goals/0037's design
// note: legitimate here, the opposite of the client-side-diff approach
// the design's own research moved away from for reconcile itself).
type SeedFingerprint struct {
	SeedRevision int    `json:"seedRevision"`
	Fingerprint  string `json:"fingerprint"`
}

// fingerprintContent hashes v's JSON encoding -- used identically for
// every golden type below. Callers pass a copy with identity/
// timestamp/provenance fields already zeroed, so the hash reflects
// only the content a revision bump is meant to track.
func fingerprintContent(v any) string {
	data, err := json.Marshal(v)
	if err != nil {
		// Every golden type here is a plain, already-marshaled-elsewhere
		// domain struct -- a marshal failure would mean a golden's own
		// shape is broken, which every other test in this codebase would
		// also be failing on. Panicking (rather than threading an error
		// through every call site) keeps this helper's signature simple;
		// seed_fingerprint_test.go is the only caller, and a panic there
		// still fails the test, just louder.
		panic("seeding: fingerprint content: " + err.Error())
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// AllSeedFingerprints computes the CURRENT fingerprint of every golden
// this codebase ships, keyed by ID -- the "what SHOULD the committed
// file say" side of seed_fingerprint_test.go's comparison. Central so
// the test and any future "print me the up-to-date file" tooling share
// one definition of "golden content" per type.
func AllSeedFingerprints() map[string]SeedFingerprint {
	out := make(map[string]SeedFingerprint)

	for _, wf := range composition.BuiltInWorkflows() {
		id := wf.ID
		rev := wf.Seed.SeedRevision
		wf.ID, wf.CreatedAt, wf.UpdatedAt, wf.Seed = "", time.Time{}, time.Time{}, seedorigin.Origin{}
		out[keyFor("workflow", id)] = SeedFingerprint{SeedRevision: rev, Fingerprint: fingerprintContent(wf)}
	}
	for _, r := range httprequest.BuiltIn() {
		id := r.ID
		rev := r.Seed.SeedRevision
		r.ID, r.CreatedAt, r.UpdatedAt, r.Seed = "", time.Time{}, time.Time{}, seedorigin.Origin{}
		out[keyFor("request", id)] = SeedFingerprint{SeedRevision: rev, Fingerprint: fingerprintContent(r)}
	}
	for _, d := range decision.BuiltIn() {
		id := d.ID
		rev := d.Seed.SeedRevision
		d.ID, d.CreatedAt, d.UpdatedAt, d.Seed = "", time.Time{}, time.Time{}, seedorigin.Origin{}
		out[keyFor("decision", id)] = SeedFingerprint{SeedRevision: rev, Fingerprint: fingerprintContent(d)}
	}
	for _, l := range list.BuiltIn() {
		id := l.ID
		rev := l.Seed.SeedRevision
		l.ID, l.CreatedAt, l.UpdatedAt, l.Seed = "", time.Time{}, time.Time{}, seedorigin.Origin{}
		for i := range l.Rows {
			l.Rows[i].CreatedAt, l.Rows[i].UpdatedAt = time.Time{}, time.Time{}
		}
		out[keyFor("list", id)] = SeedFingerprint{SeedRevision: rev, Fingerprint: fingerprintContent(l)}
	}
	for _, s := range mcpserver.BuiltIn() {
		id := s.ID
		rev := s.Seed.SeedRevision
		s.ID, s.CreatedAt, s.UpdatedAt, s.Seed = "", time.Time{}, time.Time{}, seedorigin.Origin{}
		out[keyFor("mcpserver", id)] = SeedFingerprint{SeedRevision: rev, Fingerprint: fingerprintContent(s)}
	}
	for _, e := range execenv.BuiltIn() {
		id := e.ID
		rev := e.Seed.SeedRevision
		e.ID, e.CreatedAt, e.UpdatedAt, e.Seed = "", time.Time{}, time.Time{}, seedorigin.Origin{}
		out[keyFor("execenv", id)] = SeedFingerprint{SeedRevision: rev, Fingerprint: fingerprintContent(e)}
	}
	return out
}

// keyFor namespaces a golden's fingerprint-file key by its entity kind
// -- IDs are unique per-kind already (each domain package's own
// ExampleXID constants), but namespacing avoids ever relying on that
// staying true across five independent domain packages.
func keyFor(kind, id string) string {
	return kind + ":" + id
}
