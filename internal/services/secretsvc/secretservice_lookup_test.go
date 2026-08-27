package secretsvc

import "testing"

func TestLookupVaultSecretByEnvName_MatchesNormalizedTitle(t *testing.T) {
	s := newTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	created, err := s.CreateSecret("GitHub Token", "", "lookup-pw-fake", "", "", "")
	if err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}

	id, label, found := s.LookupVaultSecretByEnvName("GITHUB_TOKEN")
	if !found {
		t.Fatal("LookupVaultSecretByEnvName: want found=true for a title that normalizes to the same name")
	}
	if id != created.ID {
		t.Errorf("id = %q, want %q", id, created.ID)
	}
	if label != "GitHub Token" {
		t.Errorf("label = %q, want the entry's own title", label)
	}
}

func TestLookupVaultSecretByEnvName_NoMatch(t *testing.T) {
	s := newTestService(t)
	if err := s.SetupVault(); err != nil {
		t.Fatalf("SetupVault: %v", err)
	}
	if _, err := s.CreateSecret("Unrelated Entry", "", "pw", "", "", ""); err != nil {
		t.Fatalf("CreateSecret: %v", err)
	}

	if _, _, found := s.LookupVaultSecretByEnvName("GITHUB_TOKEN"); found {
		t.Error("LookupVaultSecretByEnvName: want found=false, no entry names this var")
	}
}

func TestNormalizeSecretEnvName_Table(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"GITHUB_TOKEN", "GITHUB_TOKEN"},
		{"GitHub Token", "GITHUB_TOKEN"},
		{"github-token", "GITHUB_TOKEN"},
		{"  GitHub   Token  ", "GITHUB_TOKEN"},
		{"AWS/Secret.Key", "AWS_SECRET_KEY"},
	}
	for _, c := range cases {
		if got := normalizeSecretEnvName(c.in); got != c.want {
			t.Errorf("normalizeSecretEnvName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
