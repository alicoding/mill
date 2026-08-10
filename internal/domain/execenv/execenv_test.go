package execenv

import "testing"

func validEnv() ExecEnv {
	return ExecEnv{
		ID: "e1", Label: "Test env", Shell: ShellZsh, ProfileMode: ProfileClean,
		Dir: TempDirSentinel, Env: []string{"PATH=/usr/bin:/bin"},
	}
}

func TestValidate_Valid(t *testing.T) {
	if err := Validate(validEnv()); err != nil {
		t.Fatalf("Validate(valid) = %v, want nil", err)
	}
}

func TestValidate_EmptyLabel(t *testing.T) {
	e := validEnv()
	e.Label = "  "
	if err := Validate(e); err == nil {
		t.Fatal("Validate(empty label) = nil, want an error")
	}
}

func TestValidate_UnknownShell(t *testing.T) {
	e := validEnv()
	e.Shell = "fish"
	if err := Validate(e); err == nil {
		t.Fatal("Validate(unknown shell) = nil, want an error")
	}
}

func TestValidate_UnknownProfileMode(t *testing.T) {
	e := validEnv()
	e.ProfileMode = "sourced"
	if err := Validate(e); err == nil {
		t.Fatal("Validate(unknown profile mode) = nil, want an error")
	}
}

func TestValidate_EmptyDir(t *testing.T) {
	e := validEnv()
	e.Dir = ""
	if err := Validate(e); err == nil {
		t.Fatal("Validate(empty dir) = nil, want an error")
	}
}

func TestValidate_TempDirSentinelIsValid(t *testing.T) {
	e := validEnv()
	e.Dir = TempDirSentinel
	if err := Validate(e); err != nil {
		t.Fatalf("Validate(sentinel dir) = %v, want nil", err)
	}
}

func TestBuiltIn_ReturnsValidExecEnv(t *testing.T) {
	envs := BuiltIn()
	if len(envs) != 1 {
		t.Fatalf("BuiltIn() returned %d envs, want 1", len(envs))
	}
	if envs[0].ID != ExampleSafeSandboxID {
		t.Errorf("BuiltIn()[0].ID = %q, want %q", envs[0].ID, ExampleSafeSandboxID)
	}
	if err := Validate(envs[0]); err != nil {
		t.Fatalf("Validate(BuiltIn()[0]) = %v, want nil", err)
	}
}
