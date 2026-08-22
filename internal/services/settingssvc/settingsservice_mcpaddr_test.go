package settingssvc

import "testing"

func TestResolveMCPAddr_EnvAlwaysWins(t *testing.T) {
	addr, envOverride := ResolveMCPAddr("127.0.0.1:9999", "127.0.0.1:7777")
	if addr != "127.0.0.1:9999" || !envOverride {
		t.Errorf("ResolveMCPAddr with env set = (%q, %v), want the env value with envOverride true", addr, envOverride)
	}
}

func TestResolveMCPAddr_StoredWinsOverDefault(t *testing.T) {
	addr, envOverride := ResolveMCPAddr("", "127.0.0.1:7777")
	if addr != "127.0.0.1:7777" || envOverride {
		t.Errorf("ResolveMCPAddr with only a stored value = (%q, %v), want the stored value with envOverride false", addr, envOverride)
	}
}

func TestResolveMCPAddr_DefaultsWhenNeitherIsSet(t *testing.T) {
	addr, envOverride := ResolveMCPAddr("", "")
	if addr != MCPAddrDefault || envOverride {
		t.Errorf("ResolveMCPAddr with nothing set = (%q, %v), want the default with envOverride false", addr, envOverride)
	}
}

func TestValidateMCPAddr(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		wantErr bool
	}{
		{"empty clears to default", "", false},
		{"valid loopback", "127.0.0.1:8090", false},
		{"valid non-loopback", "0.0.0.0:8090", false},
		{"missing port", "127.0.0.1", true},
		{"non-numeric port", "127.0.0.1:abc", true},
		{"port zero", "127.0.0.1:0", true},
		{"port too high", "127.0.0.1:70000", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidateMCPAddr(c.in)
			if c.wantErr && err == nil {
				t.Errorf("ValidateMCPAddr(%q) = nil, want an error", c.in)
			}
			if !c.wantErr && err != nil {
				t.Errorf("ValidateMCPAddr(%q) = %v, want nil", c.in, err)
			}
		})
	}
}

func TestSetMCPAccessAddress_ValidatesAndPersists(t *testing.T) {
	set := newTestSettingsService(t)
	if err := set.SetMCPAccessAddress("127.0.0.1:9091"); err != nil {
		t.Fatalf("valid address rejected: %v", err)
	}
	if got := set.MCPAccessAddress(); got != "127.0.0.1:9091" {
		t.Errorf("MCPAccessAddress() = %q after save", got)
	}
	if err := set.SetMCPAccessAddress("not-an-address"); err == nil {
		t.Error("malformed address accepted")
	}
	if err := set.SetMCPAccessAddress(""); err != nil {
		t.Fatalf("clearing rejected: %v", err)
	}
	if got := set.MCPAccessAddress(); got != "" {
		t.Errorf("MCPAccessAddress() = %q after clear", got)
	}
}

func TestMCPAccessAddressInfo_ReflectsPrecedence(t *testing.T) {
	set := newTestSettingsService(t)
	if info := set.MCPAccessAddressInfo(); info.Address != MCPAddrDefault || info.EnvOverride {
		t.Errorf("MCPAccessAddressInfo() with nothing set = %+v, want the default with no override", info)
	}
	if err := set.SetMCPAccessAddress("127.0.0.1:9091"); err != nil {
		t.Fatalf("SetMCPAccessAddress: %v", err)
	}
	if info := set.MCPAccessAddressInfo(); info.Address != "127.0.0.1:9091" || info.EnvOverride {
		t.Errorf("MCPAccessAddressInfo() with a stored value = %+v, want it reflected with no override", info)
	}
	t.Setenv(MCPAddrEnvVar, "127.0.0.1:9092")
	if info := set.MCPAccessAddressInfo(); info.Address != "127.0.0.1:9092" || !info.EnvOverride {
		t.Errorf("MCPAccessAddressInfo() with env set = %+v, want the env value with envOverride true", info)
	}
}
