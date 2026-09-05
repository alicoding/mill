package environment

import "testing"

func TestValidate_AcceptsAWellFormedEnvironment(t *testing.T) {
	e := Environment{Label: "Sandbox", Vars: []Variable{{Key: "API_BASE", Value: "https://x.test"}, {Key: "API_TOKEN", Secret: true}}}
	if err := Validate(e); err != nil {
		t.Fatalf("Validate(valid) = %v, want nil", err)
	}
}

func TestValidate_RejectsAnEmptyLabel(t *testing.T) {
	if err := Validate(Environment{Label: "  "}); err == nil {
		t.Fatal("Validate(empty label) = nil, want an error")
	}
}

func TestValidate_RejectsANameThatIsNotAnIdentifier(t *testing.T) {
	for _, key := range []string{"", "1API", "api-base", "api base", "API.BASE"} {
		if err := Validate(Environment{Label: "x", Vars: []Variable{{Key: key}}}); err == nil {
			t.Errorf("Validate(key %q) = nil, want an error", key)
		}
	}
}

func TestValidate_RejectsTheSameNameTwice(t *testing.T) {
	e := Environment{Label: "x", Vars: []Variable{{Key: "A", Value: "1"}, {Key: "A", Value: "2"}}}
	if err := Validate(e); err == nil {
		t.Fatal("Validate(duplicate key) = nil, want an error -- {{A}} would resolve by storage order")
	}
}

func TestSecretCount_CountsOnlySecretVariables(t *testing.T) {
	e := Environment{Vars: []Variable{{Key: "A"}, {Key: "B", Secret: true}, {Key: "C", Secret: true}}}
	if got := SecretCount(e); got != 2 {
		t.Errorf("SecretCount = %d, want 2", got)
	}
}

func TestBuiltIn_ReturnsValidEnvironments(t *testing.T) {
	envs := BuiltIn()
	if len(envs) != 2 {
		t.Fatalf("BuiltIn() returned %d environments, want 2 (Sandbox, Production)", len(envs))
	}
	ids := map[string]bool{}
	for _, e := range envs {
		ids[e.ID] = true
		if err := Validate(e); err != nil {
			t.Errorf("Validate(%q) = %v, want nil", e.ID, err)
		}
		for _, v := range e.Vars {
			if v.Secret && v.Value != "" {
				t.Errorf("%q's secret variable %q ships with a reference -- a seed may not name a store entry that does not exist", e.ID, v.Key)
			}
		}
	}
	if !ids[ExampleSandboxID] || !ids[ExampleProductionID] {
		t.Errorf("BuiltIn() = %v, want both seeded ids", ids)
	}
}
