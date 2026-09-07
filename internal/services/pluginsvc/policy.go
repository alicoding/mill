package pluginsvc

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"aead.dev/minisign"
	"github.com/Masterminds/semver/v3"

	"github.com/alicoding/mill/internal/domain/usererror"
)

// The organisation's extension policy (docs/goals/0349 S6, ADR-0047):
// one JSON file an administrator places on the machine -- by hand or
// through device management -- that decides which extensions may be
// installed and run. Nothing in Mill's own settings can loosen it:
// the file is read fresh on every scan and every install, and a file
// that cannot be read blocks every non-built-in extension rather than
// none (the managed-browser convention: a broken policy is a closed
// door, never an open one).
//
// The shape follows the converged managed-extension controls: an allow
// list that is exclusive once non-empty, a block list that always wins,
// a minimum trust tier, capabilities no extension may declare, and the
// sources installs may come from.

// PolicyPathEnv overrides the policy file's location -- server mode,
// tests, and an administrator trying a policy before deploying it.
const PolicyPathEnv = "MILL_PLUGIN_POLICY"

// policyFileName is the file's name under the system-wide directory.
const policyFileName = "plugin-policy.json"

// PolicyVersion is the only schema version this build reads.
const PolicyVersion = 1

// TierAny is the requiredTier value that accepts every tier.
const TierAny = "any"

// ErrPolicyUnreadable is the one sentence every malformed or unreadable
// policy file answers with. The detail is logged for the administrator;
// the person at the keyboard cannot fix the file and is told who can.
var ErrPolicyUnreadable = usererror.New("plugin-policy-unreadable", "The extension policy file can't be read. Ask your administrator.")

// PolicyRule names extensions by id, by the minisign key that signed
// them, or both, optionally narrowed to a version range ("^1.2",
// ">=1 <2").
type PolicyRule struct {
	ID           string `json:"id"`
	PublisherKey string `json:"publisherKey"`
	Versions     string `json:"versions"`
}

// Policy is the parsed file.
type Policy struct {
	Version             int          `json:"version"`
	ManagedBy           string       `json:"managedBy"`
	Allow               []PolicyRule `json:"allow"`
	Block               []PolicyRule `json:"block"`
	RequiredTier        string       `json:"requiredTier"`
	BlockedCapabilities []string     `json:"blockedCapabilities"`
	AllowedSources      []string     `json:"allowedSources"`
}

// PolicyState is what a load answers: whether a file is present, where
// it was read from, the parsed policy, and -- when the file could not
// be read -- the sentence every affected surface shows.
type PolicyState struct {
	Present bool
	Path    string
	Policy  Policy
	Error   string
}

// Managed reports whether the machine carries a policy at all -- a
// readable one or a broken one; both make the Extensions surface say
// so.
func (s PolicyState) Managed() bool { return s.Present }

// DefaultPolicyPath is the system-wide location device management
// writes to: the platform's all-users application-support directory.
func DefaultPolicyPath() string {
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join("/Library", "Application Support", "Mill", policyFileName)
	case "windows":
		base := os.Getenv("ProgramData")
		if base == "" {
			base = `C:\ProgramData`
		}
		return filepath.Join(base, "Mill", policyFileName)
	default:
		return filepath.Join("/etc", "mill", policyFileName)
	}
}

// PolicyPath resolves where the file is read from.
func PolicyPath() string {
	if p := strings.TrimSpace(os.Getenv(PolicyPathEnv)); p != "" {
		return p
	}
	return DefaultPolicyPath()
}

// LoadPolicy reads the policy file. A missing file is the unmanaged
// state; a present file that fails to parse or validate is the
// fail-closed state, with its detail logged once per load.
func LoadPolicy() PolicyState {
	path := PolicyPath()
	raw, err := os.ReadFile(path) // #nosec G304 -- the administrator's own policy path
	if errors.Is(err, os.ErrNotExist) {
		return PolicyState{Path: path}
	}
	state := PolicyState{Present: true, Path: path}
	if err != nil {
		slog.Warn("extension policy unreadable", "path", path, "error", err)
		state.Error = ErrPolicyUnreadable.Message
		return state
	}
	policy, parseErr := ParsePolicy(raw)
	if parseErr != nil {
		slog.Warn("extension policy invalid", "path", path, "error", parseErr)
		state.Error = ErrPolicyUnreadable.Message
		return state
	}
	state.Policy = policy
	return state
}

// ParsePolicy decodes and validates one policy document. The returned
// error names the field for the administrator's log; it is never the
// sentence a user sees (LoadPolicy substitutes ErrPolicyUnreadable).
func ParsePolicy(raw []byte) (Policy, error) {
	var p Policy
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&p); err != nil {
		return Policy{}, fmt.Errorf("not a valid policy document: %w", err)
	}
	if err := validatePolicyHeader(&p); err != nil {
		return Policy{}, err
	}
	if err := validatePolicyLists(&p); err != nil {
		return Policy{}, err
	}
	return p, nil
}

// validatePolicyHeader checks the document's own fields: the schema
// version and the organisation's name.
func validatePolicyHeader(p *Policy) error {
	if p.Version != PolicyVersion {
		return fmt.Errorf("version must be %d, got %d", PolicyVersion, p.Version)
	}
	p.ManagedBy = strings.TrimSpace(p.ManagedBy)
	if p.ManagedBy == "" {
		return errors.New("managedBy must name the organisation")
	}
	return nil
}

// validatePolicyLists checks every list the document carries: the
// rules, the tier, the blocked capabilities and the allowed sources.
func validatePolicyLists(p *Policy) error {
	for i := range p.Allow {
		if err := validatePolicyRule(&p.Allow[i]); err != nil {
			return fmt.Errorf("allow[%d]: %w", i, err)
		}
	}
	for i := range p.Block {
		if err := validatePolicyRule(&p.Block[i]); err != nil {
			return fmt.Errorf("block[%d]: %w", i, err)
		}
	}
	if err := validatePolicyTier(p); err != nil {
		return err
	}
	for i, c := range p.BlockedCapabilities {
		c = strings.TrimSpace(c)
		if !knownCapabilities[c] {
			return fmt.Errorf("blockedCapabilities[%d]: unknown capability %q", i, c)
		}
		p.BlockedCapabilities[i] = c
	}
	for i, s := range p.AllowedSources {
		s = strings.TrimSpace(s)
		if s == "" {
			return fmt.Errorf("allowedSources[%d]: empty", i)
		}
		p.AllowedSources[i] = s
	}
	return nil
}

// validatePolicyTier reads requiredTier, defaulting a blank one to
// "any" and refusing a value outside the enumerated tiers.
func validatePolicyTier(p *Policy) error {
	p.RequiredTier = strings.TrimSpace(p.RequiredTier)
	switch p.RequiredTier {
	case "", TierAny:
		p.RequiredTier = TierAny
	case TierVerified, TierHashPinned:
	default:
		return fmt.Errorf("requiredTier must be %q, %q or %q, got %q", TierVerified, TierHashPinned, TierAny, p.RequiredTier)
	}
	return nil
}

func validatePolicyRule(r *PolicyRule) error {
	r.ID = strings.TrimSpace(r.ID)
	r.PublisherKey = strings.TrimSpace(r.PublisherKey)
	r.Versions = strings.TrimSpace(r.Versions)
	if r.ID == "" && r.PublisherKey == "" {
		return errors.New("a rule needs an id or a publisherKey")
	}
	if r.ID != "" && !pluginIDPattern.MatchString(r.ID) {
		return fmt.Errorf("id %q must be lowercase letters, digits, and hyphens", r.ID)
	}
	if r.PublisherKey != "" {
		var pk minisign.PublicKey
		if err := pk.UnmarshalText([]byte(r.PublisherKey)); err != nil {
			return fmt.Errorf("publisherKey is not a minisign public key: %w", err)
		}
	}
	if r.Versions != "" {
		if _, err := semver.NewConstraint(r.Versions); err != nil {
			return fmt.Errorf("versions %q is not a version range: %w", r.Versions, err)
		}
	}
	return nil
}

// publisherKeys parses every key the policy's rules name, so a signed
// folder can be matched against the policy's own keys whether or not
// the settings file pins any.
func (p Policy) publisherKeys() []minisign.PublicKey {
	var keys []minisign.PublicKey
	seen := map[uint64]bool{}
	for _, r := range append(append([]PolicyRule{}, p.Allow...), p.Block...) {
		if r.PublisherKey == "" {
			continue
		}
		var pk minisign.PublicKey
		if err := pk.UnmarshalText([]byte(r.PublisherKey)); err != nil || seen[pk.ID()] {
			continue
		}
		seen[pk.ID()] = true
		keys = append(keys, pk)
	}
	return keys
}
