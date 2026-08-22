package settingssvc

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
)

// MCPAddrEnvVar is the deploy/env override for Mill's own MCP listener
// (main.go reads it directly at boot; named here so ResolveMCPAddr and
// the Settings UI's precedence caption agree on the same variable).
const MCPAddrEnvVar = "MILL_MCP_ADDR"

// MCPAddrDefault is the built-in bind address when neither the env
// override nor a stored setting names one -- loopback-only, the
// conservative default for a new, unauthenticated local listener
// (docs/SPEC.md's MCP-plane entry).
const MCPAddrDefault = "127.0.0.1:8090"

// mcpAccessAddressKey persists the user's MCP bind-address override.
const mcpAccessAddressKey = "mcpAccessAddress"

// ResolveMCPAddr picks the effective bind address: the env override
// ALWAYS wins (a deploy/env-level decision), then the persisted
// setting, then MCPAddrDefault. envOverride reports whether the env
// value is the one in effect, so the Settings UI can render the
// address field read-only when editing it there would have no effect
// until the env var itself is unset.
func ResolveMCPAddr(env, stored string) (addr string, envOverride bool) {
	if env != "" {
		return env, true
	}
	if stored != "" {
		return stored, false
	}
	return MCPAddrDefault, false
}

// ValidateMCPAddr checks the host:port shape a bind address needs.
// Empty is valid -- it clears the stored override back to
// MCPAddrDefault. Loopback vs. non-loopback binding is the caller's
// choice (a remote-reachable instance is a real posture, not an
// error) -- only the syntax and port range are checked.
func ValidateMCPAddr(raw string) error {
	if raw == "" {
		return nil
	}
	_, portStr, err := net.SplitHostPort(raw)
	if err != nil {
		return fmt.Errorf("enter an address as host:port, like 127.0.0.1:8090")
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("the port must be a number between 1 and 65535")
	}
	return nil
}

// MCPAccessAddress returns the persisted bind-address override ("" =
// none stored, MCPAddrDefault applies unless the env overrides).
func (s *SettingsService) MCPAccessAddress() string {
	v, _ := s.store.Get(mcpAccessAddressKey).(string)
	return v
}

// SetMCPAccessAddress validates and persists the bind-address
// override; "" clears it back to MCPAddrDefault. Applies at Mill's
// next launch -- MillMCPService.Start is only ever called once, at
// boot (main.go).
func (s *SettingsService) SetMCPAccessAddress(raw string) error {
	raw = strings.TrimSpace(raw)
	if err := ValidateMCPAddr(raw); err != nil {
		return err
	}
	return s.store.Set(mcpAccessAddressKey, raw)
}

// MCPAddrInfo is the Settings UI's read model: the address this run
// resolved to, and whether an env override is the reason.
type MCPAddrInfo struct {
	Address     string `json:"address"`
	EnvOverride bool   `json:"envOverride"`
}

// MCPAccessAddressInfo reports the effective bind address and whether
// MILL_MCP_ADDR is the reason -- the Settings > MCP access address
// field reads this to decide whether it's editable.
func (s *SettingsService) MCPAccessAddressInfo() MCPAddrInfo {
	addr, envOverride := ResolveMCPAddr(os.Getenv(MCPAddrEnvVar), s.MCPAccessAddress())
	return MCPAddrInfo{Address: addr, EnvOverride: envOverride}
}
