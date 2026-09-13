package aiprovider

import "github.com/alicoding/mill/internal/domain/reference"

const RevisionAbsent = "absent"

type ChangeBlockerCode string

const (
	ChangeBlockerProviderInUse                  ChangeBlockerCode = "provider-in-use"
	ChangeBlockerProviderUseIndeterminate       ChangeBlockerCode = "provider-use-indeterminate"
	ChangeBlockerProviderOwnershipUnestablished ChangeBlockerCode = "provider-ownership-unestablished"
	ChangeBlockerProviderCheckUnavailable       ChangeBlockerCode = "provider-check-unavailable"
)

// ChangeImpact reports execution evidence separately from authored consumers.
// RunIDs and WorkflowIDs contain only confirmed provider references; a safety
// check that cannot prove absence is represented by its blocker code.
type ChangeImpact struct {
	ProviderID      string              `json:"providerId"`
	ConfigRevision  string              `json:"configRevision"`
	RunIDs          []string            `json:"runIDs"`
	WorkflowIDs     []string            `json:"workflowIDs"`
	MutationAllowed bool                `json:"mutationAllowed"`
	BlockerCodes    []ChangeBlockerCode `json:"blockerCodes"`
}

type ImportMode string

const (
	ImportModeCreate  ImportMode = "create"
	ImportModeReplace ImportMode = "replace"
)

// ImportProjection is the credential-free subset shown before an import.
type ImportProjection struct {
	Label    string `json:"label"`
	Kind     Kind   `json:"kind"`
	Endpoint string `json:"endpoint"`
	Model    string `json:"model"`
	KeyRef   string `json:"keyRef"`
}

// ImportPreview is a compare-and-apply token plus the information needed to
// review a provider import without resolving a secret or contacting its host.
type ImportPreview struct {
	ProviderID       string            `json:"providerId"`
	Mode             ImportMode        `json:"mode"`
	ExpectedRevision string            `json:"expectedRevision"`
	Current          *ImportProjection `json:"current,omitempty"`
	Proposed         ImportProjection  `json:"proposed"`
	References       reference.Refs    `json:"references"`
	Impact           ChangeImpact      `json:"impact"`
}
