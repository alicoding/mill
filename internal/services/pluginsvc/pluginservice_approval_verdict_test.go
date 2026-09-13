package pluginsvc

import (
	"errors"
	"testing"
)

type approvalVerdictTrust struct {
	approvals []PluginApproval
	err       error
	calls     int
}

func (t *approvalVerdictTrust) Enabled(string) bool { return true }
func (t *approvalVerdictTrust) Allowlist() []string { return nil }
func (t *approvalVerdictTrust) Approval() (PluginApproval, error) {
	t.calls++
	if t.err != nil {
		return PluginApproval{}, t.err
	}
	index := t.calls - 1
	if index >= len(t.approvals) {
		index = len(t.approvals) - 1
	}
	return t.approvals[index], nil
}

func TestListPlugins_UsesOneApprovalRevisionForTheWholeScan(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "mill-a", `{"id":"mill-a","name":"A","version":"1.0.0"}`, nil)
	writePlugin(t, root, "mill-b", `{"id":"mill-b","name":"B","version":"1.0.0"}`, nil)
	aHash, err := CodeHash(root + "/mill-a")
	if err != nil {
		t.Fatal(err)
	}
	bHash, err := CodeHash(root + "/mill-b")
	if err != nil {
		t.Fatal(err)
	}
	trust := &approvalVerdictTrust{approvals: []PluginApproval{
		{Revision: 1, Allowed: []string{"mill-a", "mill-b"}, Locks: map[string]PluginApprovalLock{
			"mill-a": {Hash: aHash, Grant: PluginGrant{}},
			"mill-b": {Hash: bHash, Grant: PluginGrant{}},
		}},
		{Revision: 2, Allowed: []string{}, Locks: map[string]PluginApprovalLock{}},
	}}
	svc := newTestPluginService(t, root, nil, "")
	svc.WireAudit(trust, nil)

	infos, err := svc.ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	if trust.calls != 1 {
		t.Fatalf("Approval calls = %d, want one detached scan snapshot", trust.calls)
	}
	byID := pluginInfosByID(infos)
	if byID["mill-a"].ApprovalState != pluginApprovalAllowed || byID["mill-b"].ApprovalState != pluginApprovalAllowed {
		t.Fatalf("approval states = %q, %q, want the same revision's allowed verdict", byID["mill-a"].ApprovalState, byID["mill-b"].ApprovalState)
	}
}

func TestListPlugins_ApprovalVerdictsAreFailClosedAndPreserveLegacyMarker(t *testing.T) {
	root := t.TempDir()
	writePlugin(t, root, "mill-a", `{"id":"mill-a","name":"A","version":"1.0.0"}`, nil)
	writePlugin(t, root, "mill-b", `{"id":"mill-b","name":"B","version":"1.0.0"}`, nil)
	trust := &approvalVerdictTrust{approvals: []PluginApproval{{
		Revision: 1, Allowed: []string{"mill-a", "mill-b"}, Locks: map[string]PluginApprovalLock{}, LegacyUnpinned: []string{"mill-a"},
	}}}
	svc := newTestPluginService(t, root, nil, "")
	svc.WireAudit(trust, nil)

	infos, err := svc.ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	byID := pluginInfosByID(infos)
	if byID["mill-a"].ApprovalState != pluginApprovalAllowed {
		t.Fatalf("marked legacy approval = %q, want allowed", byID["mill-a"].ApprovalState)
	}
	if byID["mill-b"].ApprovalState != pluginApprovalUnallowed {
		t.Fatalf("unmarked missing lock = %q, want unallowed", byID["mill-b"].ApprovalState)
	}

	trust.err = errors.New("approval database unavailable")
	infos, err = svc.ListPlugins()
	if err != nil {
		t.Fatal(err)
	}
	byID = pluginInfosByID(infos)
	if byID["mill-a"].ApprovalState != pluginApprovalUnavailable || byID["mill-b"].ApprovalState != pluginApprovalUnavailable {
		t.Fatalf("failed approval read = %q, %q, want unavailable", byID["mill-a"].ApprovalState, byID["mill-b"].ApprovalState)
	}
}

func TestListPlugins_DistinguishesWidenedChangedAndAllowed(t *testing.T) {
	root := t.TempDir()
	manifest := `{"id":"mill-a","name":"A","version":"1.0.0","capabilities":["open-url"]}`
	writePlugin(t, root, "mill-a", manifest, nil)
	hash, err := CodeHash(root + "/mill-a")
	if err != nil {
		t.Fatal(err)
	}
	contentHash, err := ContentHash(root + "/mill-a")
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name    string
		lock    PluginApprovalLock
		want    string
		widened bool
	}{
		{name: "allowed", lock: PluginApprovalLock{Hash: hash, Grant: PluginGrant{Capabilities: []string{"open-url"}}}, want: pluginApprovalAllowed},
		{name: "legacy whole package", lock: PluginApprovalLock{Hash: contentHash, Grant: PluginGrant{}}, want: pluginApprovalAllowed},
		{name: "widened", lock: PluginApprovalLock{Hash: hash, Grant: PluginGrant{}}, want: pluginApprovalUnallowed, widened: true},
		{name: "changed", lock: PluginApprovalLock{Hash: "sha256-stale", Grant: PluginGrant{Capabilities: []string{"open-url"}}}, want: pluginApprovalChanged},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			trust := &approvalVerdictTrust{approvals: []PluginApproval{{Allowed: []string{"mill-a"}, Locks: map[string]PluginApprovalLock{"mill-a": test.lock}}}}
			svc := newTestPluginService(t, root, nil, "")
			svc.WireAudit(trust, nil)
			infos, err := svc.ListPlugins()
			if err != nil {
				t.Fatal(err)
			}
			info := pluginInfosByID(infos)["mill-a"]
			if info.ApprovalState != test.want || (info.Widened != nil) != test.widened {
				t.Fatalf("verdict = %q, widened = %v; want %q, %v", info.ApprovalState, info.Widened != nil, test.want, test.widened)
			}
		})
	}
}

func pluginInfosByID(infos []PluginInfo) map[string]PluginInfo {
	out := make(map[string]PluginInfo, len(infos))
	for _, info := range infos {
		out[info.Manifest.ID] = info
	}
	return out
}
