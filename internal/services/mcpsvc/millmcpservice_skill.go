package mcpsvc

import (
	"context"
	"fmt"
	"io/fs"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// skillDocPath is the embedded userdocs tree's path to the canonical,
// hand-authored proficiency doc (goal 0160) -- ONE committed source
// (userdocs/agents/skill.md), served byte-for-byte over both mill://skill
// and the Settings export door (SkillDocument below), so the two can
// never drift: there is nothing to regenerate or diff, only one file to
// read.
const skillDocPath = "userdocs/agents/skill.md"

// registerSkillResource wires mill://skill: the practice-layer
// companion to mill://contract's reference layer (docs/goals/0160) --
// which tool fits which job, the approval/parking etiquette, and
// composition norms, read FIRST per serverInstructions and this
// resource's own Description.
func (m *MillMCPService) registerSkillResource() {
	m.server.AddResource(&mcp.Resource{
		URI: "mill://skill", Name: "skill", MIMEType: "text/markdown",
		Description: "Read this FIRST, before authoring a workflow, proposing an Atlas change, or calling any write tool: which tool fits which job, how approval/parking behaves, and the mistakes that waste turns. Reference schemas live separately at mill://contract.",
	}, m.readSkill)
}

func (m *MillMCPService) skillDoc() (string, error) {
	if m.userdocs == nil {
		return "", fmt.Errorf("skill doc: no userdocs content wired")
	}
	raw, err := fs.ReadFile(m.userdocs, skillDocPath)
	if err != nil {
		return "", fmt.Errorf("skill doc: %w", err)
	}
	return string(raw), nil
}

func (m *MillMCPService) readSkill(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	text, err := m.skillDoc()
	if err != nil {
		return nil, err
	}
	return &mcp.ReadResourceResult{
		Contents: []*mcp.ResourceContents{{URI: req.Params.URI, MIMEType: "text/markdown", Text: text}},
	}, nil
}

// SkillDocument is the same mill://skill read, exposed as a plain
// method for settingssvc.SettingsService.ExportSkillDoc to call --
// mirrors ContractDocument's own shape (millmcpservice_contract.go) so
// the Settings → Contract export door hands agents both documents
// through the identical late-bound s.mcpService proxy.
func (m *MillMCPService) SkillDocument() (string, error) {
	return m.skillDoc()
}
