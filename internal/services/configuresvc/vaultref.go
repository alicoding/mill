package configuresvc

import (
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/vaultref"
)

// This file owns vault-reference resolution (goal 0203 S1): the single
// place every Configure entity whose own field may name a stored
// secret goes through, so a locked vault, an unknown id, or a plain
// (non-"vault:") literal all resolve identically no matter which
// entity's field they came from. Originally MCPServer.Env's own private
// logic (configuremcpserver.go); lifted here once ExecEnv.Env
// (resolveExecEnv) and HTTPRequest.Headers (resolveHTTPRequest) became
// the second and third consumers. Every call site here also carries a
// secretaudit.AccessContext (goal 0203 S3) -- ContextMCPServerSpawn/
// ContextExecEnv/ContextHTTPHeader are statically known by whichever of
// the three resolve* callers built it, never guessed at this layer.

// resolveVaultRefEnv substitutes every "vault:<id>" value (vaultref.
// Parse) in a KEY=VALUE env list with that vault entry's real secret
// via c.secretResolver -- a locked vault surfaces here as this call's
// own error, never a silent empty/wrong secret. kind/label name the
// caller's own entity in a wrapped error (e.g. `MCP server "GitHub"`).
// A plain (non-"vault:") value passes through unresolved, unchanged --
// and never reaches c.secretResolver, so no audit line for a field that
// never named a vault entry.
func (c *ConfigureService) resolveVaultRefEnv(kind, label string, env []string, actx secretaudit.AccessContext) ([]string, error) {
	if len(env) == 0 {
		return nil, nil
	}
	out := make([]string, len(env))
	for i, kv := range env {
		key, value, hasEq := strings.Cut(kv, "=")
		id, isRef := vaultref.Parse(value)
		if !hasEq || !isRef {
			out[i] = kv
			continue
		}
		secret, err := c.secretResolver(id, actx)
		if err != nil {
			return nil, fmt.Errorf("%s %q: resolving vault secret for %s: %w", kind, label, key, err)
		}
		out[i] = key + "=" + secret
	}
	return out, nil
}

// resolveVaultRefValue resolves a single "vault:<id>" reference
// (vaultref.Parse) via c.secretResolver, for a field whose ENTIRE
// value (not a KEY=VALUE env entry) may name a vault entry -- an
// HTTPRequest custom header's own value. A plain (non-"vault:") value
// passes through unresolved, unchanged.
func (c *ConfigureService) resolveVaultRefValue(value string, actx secretaudit.AccessContext) (string, error) {
	id, isRef := vaultref.Parse(value)
	if !isRef {
		return value, nil
	}
	return c.secretResolver(id, actx)
}

// resolveVaultRefHeaders applies resolveVaultRefValue across an
// HTTPRequest's own custom Headers map -- nil in, nil out (an
// HTTPRequest with no custom headers never allocates one, same
// pass-through-unchanged shape resolveVaultRefEnv's own len==0 guard
// gives its callers). label names the request in a wrapped error.
func (c *ConfigureService) resolveVaultRefHeaders(label string, headers map[string]string, actx secretaudit.AccessContext) (map[string]string, error) {
	if len(headers) == 0 {
		return nil, nil
	}
	out := make(map[string]string, len(headers))
	for k, v := range headers {
		resolved, err := c.resolveVaultRefValue(v, actx)
		if err != nil {
			return nil, fmt.Errorf("request %q: resolving vault secret for header %q: %w", label, k, err)
		}
		out[k] = resolved
	}
	return out, nil
}
