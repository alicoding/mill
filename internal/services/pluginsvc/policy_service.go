package pluginsvc

import (
	"os"
	"path/filepath"

	"aead.dev/minisign"

	"github.com/alicoding/mill/internal/domain/usererror"
)

// The policy's doors into the service (docs/goals/0349 S6): every scan
// stamps each folder with the policy's verdict, every install asks it
// before anything is written, and the Extensions surface reads it to
// say who manages this Mac. The file is loaded fresh per call -- a
// policy pushed by device management takes effect on the next scan,
// with no restart and nothing cached to go stale.

// PolicyView is what the Extensions banner and Settings > Security
// render: the read-only summary of the file on this machine.
type PolicyView struct {
	Version             int
	Managed             bool
	ManagedBy           string
	RequiredTier        string
	BlockedCapabilities []string
	AllowedSources      []string
	SourceRules         []SourcePolicyRule
	LegacySourceRules   bool
	AllowCount          int
	BlockCount          int
	Path                string
	// Error is the fail-closed sentence when the file is present but
	// cannot be read; "" otherwise.
	Error string
}

// PluginPolicy answers the policy summary for the surfaces that show
// it. Never fails: an unreadable file is a state, not an error.
func (p *PluginService) PluginPolicy() (PolicyView, error) {
	st := LoadPolicy()
	view := PolicyView{Managed: st.Present, Path: st.Path, Error: st.Error}
	if !st.Present || st.Error != "" {
		return view, nil
	}
	view.ManagedBy = st.Policy.ManagedBy
	view.Version = st.Policy.Version
	view.RequiredTier = st.Policy.RequiredTier
	view.BlockedCapabilities = append([]string{}, st.Policy.BlockedCapabilities...)
	view.AllowedSources = append([]string{}, st.Policy.AllowedSources...)
	view.SourceRules = append([]SourcePolicyRule{}, st.Policy.Sources...)
	view.LegacySourceRules = st.Policy.Version == PolicyVersionLegacy && st.Policy.AllowedSources != nil
	view.AllowCount = len(st.Policy.Allow)
	view.BlockCount = len(st.Policy.Block)
	return view, nil
}

// applyPolicy stamps one scanned folder with the policy's verdict. A
// broken policy file refuses every non-built-in folder with the same
// sentence -- the door is closed until an administrator fixes it.
func (p *PluginService) applyPolicy(info *PluginInfo) {
	if info.Builtin {
		return
	}
	st := LoadPolicy()
	if !st.Present {
		return
	}
	if st.Error != "" {
		info.PolicyBlocked = st.Error
		return
	}
	record, hasRecord := ReadInstallRecord(info.Dir)
	info.PolicyBlocked = st.Policy.Refusal(PolicySubject{
		ID:             info.Manifest.ID,
		Version:        info.Manifest.Version,
		Tier:           info.Tier,
		Capabilities:   info.Manifest.Capabilities,
		PublisherKeyID: signedByKey(info.Dir, info.ContentHash, st.Policy.publisherKeys()),
		Origin:         record.Origin,
		OriginVerified: hasRecord && record.Origin.Kind != "",
	})
}

// PolicyAllows is the run policy's question (wiring's mayRun): a
// plugin the policy refuses never runs, whatever the user allowed.
//
//wails:ignore
func (p *PluginService) PolicyAllows(id string) bool {
	info := p.resolvePlugin(id)
	return info.Builtin || info.PolicyBlocked == ""
}

// policyInstallRefusal asks the policy about a remote archive preview,
// where no staged folder or signature is available yet.
func policyInstallRefusal(m Manifest, tier, marketplace string) error {
	return policyInstallRefusalAt(m, tier, marketplace, "", "", "")
}

func policyInstallRefusalAt(m Manifest, tier, marketplace, locator, dir, hash string) error {
	st := LoadPolicy()
	if !st.Present {
		return nil
	}
	if st.Error != "" {
		return ErrPolicyUnreadable
	}
	if !st.Policy.SourceAllowed(marketplace, locator) {
		return policyRefused(st.Policy.SourceRefusal())
	}
	keyID := uint64(0)
	if dir != "" {
		keyID = signedByKey(dir, hash, st.Policy.publisherKeys())
	}
	reason := st.Policy.Refusal(PolicySubject{ID: m.ID, Version: m.Version, Tier: tier, Capabilities: m.Capabilities, PublisherKeyID: keyID})
	if reason == "" {
		return nil
	}
	return policyRefused(reason)
}

func policyInstallRefusalOriginAt(m Manifest, tier string, origin SourceOrigin, marketplace, dir, hash string) error {
	st := LoadPolicy()
	if !st.Present {
		return nil
	}
	if st.Error != "" {
		return ErrPolicyUnreadable
	}
	if st.Policy.Version == PolicyVersionLegacy && !st.Policy.SourceAllowed(marketplace, origin.Locator) {
		return policyRefused(st.Policy.SourceRefusal())
	}
	if st.Policy.Version == PolicyVersion && !st.Policy.SourceOriginAllowed(origin) {
		return policyRefused(st.Policy.SourceRefusal())
	}
	keyID := uint64(0)
	if dir != "" {
		keyID = signedByKey(dir, hash, st.Policy.publisherKeys())
	}
	reason := st.Policy.Refusal(PolicySubject{ID: m.ID, Version: m.Version, Tier: tier, Capabilities: m.Capabilities, PublisherKeyID: keyID, Origin: origin, OriginVerified: true})
	if reason != "" {
		return policyRefused(reason)
	}
	return nil
}

func policySourceRegistrationRefusal(marketplace string, source MarketplaceSource) error {
	st := LoadPolicy()
	if !st.Present {
		return nil
	}
	if st.Error != "" {
		return ErrPolicyUnreadable
	}
	if st.Policy.Version == PolicyVersionLegacy {
		if st.Policy.SourceAllowed(marketplace, source.Locator) {
			return nil
		}
	} else if st.Policy.SourceOriginAllowed(source.Origin) {
		return nil
	}
	return policyRefused(st.Policy.SourceRefusal())
}

// policySourceRefusal is the Add-source and install-from-link gate.
func policySourceRefusal(marketplace, locator string) error {
	st := LoadPolicy()
	if !st.Present {
		return nil
	}
	if st.Error != "" {
		return ErrPolicyUnreadable
	}
	if st.Policy.SourceAllowed(marketplace, locator) {
		return nil
	}
	return policyRefused(st.Policy.SourceRefusal())
}

func policyRequestRefusal(origin SourceOrigin, rawURL string, artifact bool) error {
	if origin.Kind == "" {
		return nil
	}
	st := LoadPolicy()
	if !st.Present {
		return nil
	}
	if st.Error != "" {
		return ErrPolicyUnreadable
	}
	if !st.Policy.SourceOriginAllowed(origin) {
		return policyRefused(st.Policy.SourceRefusal())
	}
	if artifact {
		if !st.Policy.ArtifactURLAllowed(origin, rawURL) {
			return policyRefused("Your organisation does not allow this extension download address.")
		}
		return nil
	}
	source := MarketplaceSource{Kind: origin.Kind, Locator: origin.Locator, Ref: origin.Ref, Origin: origin}
	want, err := IndexURL(source)
	if err != nil {
		return err
	}
	wantCanonical, err := canonicalHTTPURL(want, false)
	if err != nil {
		return err
	}
	gotCanonical, err := canonicalHTTPURL(rawURL, false)
	if err != nil {
		return err
	}
	if wantCanonical != gotCanonical {
		return policyRefused("Your organisation does not allow this source redirect.")
	}
	return nil
}

// PolicyRefusedCode is the error code every policy refusal carries;
// the install prompt keys its headline on it and shows the sentence.
const PolicyRefusedCode = "plugin-policy-refused"

func policyRefused(sentence string) error {
	return usererror.New(PolicyRefusedCode, sentence)
}

// signedByKey answers the id of the key in keys that verifies the
// folder's signature, 0 when none does.
func signedByKey(dir, contentHash string, keys []minisign.PublicKey) uint64 {
	if len(keys) == 0 || contentHash == "" || dir == "" {
		return 0
	}
	sig, err := os.ReadFile(filepath.Join(dir, SignatureFile)) // #nosec G304 G703 -- the plugin's own folder, resolved by the scan
	if err != nil {
		return 0
	}
	for _, pk := range keys {
		if minisign.Verify(pk, []byte(contentHash), sig) {
			return pk.ID()
		}
	}
	return 0
}
