package configuresvc

import (
	"sort"
	"strings"

	"github.com/alicoding/mill/internal/domain/vaultref"
)

// unknownVaultLabel is DeriveSecretLabels' own placeholder for a
// "vault:<id>" reference it cannot resolve to a real entry title right
// now -- a dangling id (the entry was deleted) and a currently-locked
// vault (secretvault.ErrLocked: nothing decrypted yet, so no title to
// read) both land here. The reference itself is never silently dropped
// from what a guardrail rule sees, even when its exact identity can't
// currently be shown.
const unknownVaultLabel = "unrecognized vault entry"

// secretNodeConfigKeys names, for each NodeType whose own exec function
// resolves a "vault:" reference at run time (mcpcall.go/integration.go/
// codeexec.go via vaultref.go's resolveVaultRefEnv/resolveVaultRefValue),
// which single Config key carries the Configure-entity id
// DeriveSecretLabels must follow to reach that entity's own vault-
// referenceable field -- kept as one map so this file and
// DeriveSecretLabels' own switch can't silently drift apart from each
// other.
var secretNodeConfigKeys = map[string]string{
	"mcp-tool-call":    "mcpServerId",
	"code-execution":   "envId",
	"integration-http": "requestId",
}

// DeriveSecretLabels answers, statically from a node's own type and
// config -- never by resolving a real secret VALUE -- which vault
// entries its execution will resolve, as sorted, deduped LABELS (goal
// 0203 S2). This must compute the exact same answer a real run's own
// vault-reference resolution (vaultref.go) would reach: WorkflowVerdicts
// (the canvas nothing-hidden badge) calls this before anyone runs the
// workflow, so a step that will actually touch a secret can never show
// a clean badge the live gate then contradicts.
func (c *ConfigureService) DeriveSecretLabels(nodeTypeID string, config map[string]string) []string {
	key, ok := secretNodeConfigKeys[nodeTypeID]
	if !ok {
		return []string{}
	}
	entityID := strings.TrimSpace(config[key])
	if entityID == "" {
		return []string{}
	}

	var ids []string
	switch nodeTypeID {
	case "mcp-tool-call":
		ids = c.vaultIDsInMCPServer(entityID)
	case "code-execution":
		ids = c.vaultIDsInExecEnv(entityID)
	case "integration-http":
		ids = c.vaultIDsInHTTPRequest(entityID)
	}
	return c.labelsForVaultIDs(ids)
}

func (c *ConfigureService) vaultIDsInMCPServer(id string) []string {
	c.mu.Lock()
	var env []string
	for i := range c.mcpServers {
		if c.mcpServers[i].ID == id {
			env = c.mcpServers[i].Env
			break
		}
	}
	c.mu.Unlock()
	return vaultIDsInEnv(env)
}

func (c *ConfigureService) vaultIDsInExecEnv(id string) []string {
	c.mu.Lock()
	var env []string
	for i := range c.execEnvs {
		if c.execEnvs[i].ID == id {
			env = c.execEnvs[i].Env
			break
		}
	}
	c.mu.Unlock()
	return vaultIDsInEnv(env)
}

func (c *ConfigureService) vaultIDsInHTTPRequest(id string) []string {
	c.mu.Lock()
	var headers map[string]string
	for i := range c.requests {
		if c.requests[i].ID == id {
			headers = c.requests[i].Headers
			break
		}
	}
	c.mu.Unlock()
	var ids []string
	for _, v := range headers {
		if refID, isRef := vaultref.Parse(v); isRef {
			ids = append(ids, refID)
		}
	}
	return ids
}

// vaultIDsInEnv scans a KEY=VALUE env list (MCPServer.Env/ExecEnv.Env's
// shared shape) for "vault:<id>" values -- the read-only sibling of
// vaultref.go's resolveVaultRefEnv, which does the same parse but then
// resolves the real secret; this only ever returns the id.
func vaultIDsInEnv(env []string) []string {
	var ids []string
	for _, kv := range env {
		_, value, hasEq := strings.Cut(kv, "=")
		if !hasEq {
			continue
		}
		if id, isRef := vaultref.Parse(value); isRef {
			ids = append(ids, id)
		}
	}
	return ids
}

// labelsForVaultIDs maps ids (possibly containing duplicates) to
// sorted, deduped display labels -- each id's real vault entry Title
// when c.secretLabelsLister can currently supply one, unknownVaultLabel
// otherwise (a dangling id, or the vault not currently unlocked).
func (c *ConfigureService) labelsForVaultIDs(ids []string) []string {
	if len(ids) == 0 {
		return []string{}
	}
	titles := map[string]string{}
	if summaries, err := c.secretLabelsLister(); err == nil {
		for _, s := range summaries {
			titles[s.ID] = s.Title
		}
	}
	seen := map[string]bool{}
	var labels []string
	for _, id := range ids {
		label := titles[id]
		if label == "" {
			label = unknownVaultLabel
		}
		if !seen[label] {
			seen[label] = true
			labels = append(labels, label)
		}
	}
	sort.Strings(labels)
	return labels
}
