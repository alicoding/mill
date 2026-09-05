package secret

import "strings"

// Kind classifies what a vault entry holds (goal 0306): the field that
// lets a picker offer only the entries a field can actually use -- a
// client-certificate field lists certificates, a signing-key field
// lists keys -- and lets the entry editor offer a multi-line control
// for the PEM-shaped ones instead of a single-line password box.
//
// Kind is a classification, not a storage change: every kind's value
// lives in the same protected Password field. An entry written before
// this field existed decodes as KindText (NormalizeKind), so no
// migration pass is needed to read an older vault.
type Kind string

const (
	// KindText is any single-line secret: a token, an API key, a
	// password. The default for an entry that names no kind.
	KindText Kind = "text"
	// KindKey is a private key, normally multi-line PEM.
	KindKey Kind = "key"
	// KindCertificate is an X.509 certificate, normally multi-line PEM.
	KindCertificate Kind = "certificate"
	// KindFile is the contents of a credential file a tool expects on
	// disk (a service-account JSON, a keytab rendered as text).
	KindFile Kind = "file"
)

// Kinds lists every kind in the order a picker or editor offers them.
var Kinds = []Kind{KindText, KindKey, KindCertificate, KindFile}

// Multiline reports whether a kind's value is normally more than one
// line -- what the entry editor keys its control choice on.
func (k Kind) Multiline() bool {
	switch NormalizeKind(string(k)) {
	case KindKey, KindCertificate, KindFile:
		return true
	}
	return false
}

// NormalizeKind maps a stored or wire value onto a known kind. An
// empty or unrecognized value is KindText, so an entry authored by
// KeePassXC (which knows nothing of this attribute) is still usable.
func NormalizeKind(v string) Kind {
	switch Kind(strings.ToLower(strings.TrimSpace(v))) {
	case KindKey:
		return KindKey
	case KindCertificate:
		return KindCertificate
	case KindFile:
		return KindFile
	}
	return KindText
}
