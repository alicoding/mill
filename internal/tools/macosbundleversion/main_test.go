package main

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestRunStampsProductionAndDevTemplatesFromConfig(t *testing.T) {
	requirePlistBuddy(t)
	configPath := repoPath(t, "build", "config.yml")

	tests := []struct {
		name      string
		template  string
		otherKeys []string
	}{
		{
			name:      "production",
			template:  "Info.plist",
			otherKeys: []string{"CFBundleIdentifier", "CFBundleName", "CFBundleIconName"},
		},
		{
			name:      "development",
			template:  "Info.dev.plist",
			otherKeys: []string{"CFBundleIdentifier", "CFBundleName", "NSAppTransportSecurity:NSAllowsLocalNetworking"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plistPath := copyFixture(t, repoPath(t, "build", "darwin", test.template))
			before := plistValues(t, plistPath, test.otherKeys)

			if err := run([]string{configPath, plistPath}, emptyEnvironment); err != nil {
				t.Fatalf("run: %v", err)
			}

			assertVersions(t, plistPath, "0.5.0")
			after := plistValues(t, plistPath, test.otherKeys)
			if !reflect.DeepEqual(after, before) {
				t.Fatalf("unrelated plist values changed: before=%v after=%v", before, after)
			}
		})
	}
}

func TestRunPreservesOverridePrecedence(t *testing.T) {
	requirePlistBuddy(t)
	configPath := repoPath(t, "build", "config.yml")

	tests := []struct {
		name string
		env  map[string]string
		want string
	}{
		{name: "both absent use config", env: map[string]string{}, want: "0.5.0"},
		{name: "release override", env: map[string]string{"MILL_VERSION": "1.2.3"}, want: "1.2.3"},
		{name: "beta override", env: map[string]string{"MILL_UPDATE_VERSION": "0.6.0-beta.123"}, want: "0.6.0-beta.123"},
		{
			name: "release wins over beta",
			env:  map[string]string{"MILL_VERSION": "1.2.3", "MILL_UPDATE_VERSION": "0.6.0-beta.123"},
			want: "1.2.3",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plistPath := copyFixture(t, repoPath(t, "build", "darwin", "Info.plist"))
			if err := run([]string{configPath, plistPath}, mapEnvironment(test.env)); err != nil {
				t.Fatalf("run: %v", err)
			}
			assertVersions(t, plistPath, test.want)
		})
	}
}

func TestRunRejectsInvalidConfigWithoutChangingPlist(t *testing.T) {
	requirePlistBuddy(t)

	tests := []struct {
		name   string
		config string
		want   string
	}{
		{name: "malformed yaml", config: "info: [\n", want: "parse build config"},
		{name: "missing info", config: "version: '3'\n", want: "missing info"},
		{name: "missing version", config: "info:\n  productName: Mill\n", want: "missing info.version"},
		{name: "empty version", config: "info:\n  version: '  '\n", want: "info.version is empty"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			workDir := t.TempDir()
			configPath := filepath.Join(workDir, "config.yml")
			if err := os.WriteFile(configPath, []byte(test.config), 0o600); err != nil {
				t.Fatalf("write config: %v", err)
			}
			plistPath := copyFixtureTo(t, repoPath(t, "build", "darwin", "Info.plist"), workDir)
			before, err := os.ReadFile(plistPath) // #nosec G304 -- test path is a disposable fixture
			if err != nil {
				t.Fatalf("read before: %v", err)
			}

			err = run([]string{configPath, plistPath}, emptyEnvironment)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("run error = %v, want containing %q", err, test.want)
			}
			after, readErr := os.ReadFile(plistPath) // #nosec G304 -- test path is a disposable fixture
			if readErr != nil {
				t.Fatalf("read after: %v", readErr)
			}
			if !bytes.Equal(after, before) {
				t.Fatal("plist bytes changed after config refusal")
			}
		})
	}
}

func TestRunLeavesOriginalUntouchedWhenSecondPlistUpdateFails(t *testing.T) {
	requirePlistBuddy(t)
	plistPath := copyFixture(t, repoPath(t, "build", "darwin", "Info.plist"))
	runPlistBuddy(t, plistPath, "Delete :CFBundleVersion")
	before, err := os.ReadFile(plistPath) // #nosec G304 -- test path is a disposable fixture
	if err != nil {
		t.Fatalf("read before: %v", err)
	}

	err = run(
		[]string{repoPath(t, "build", "config.yml"), plistPath},
		mapEnvironment(map[string]string{"MILL_VERSION": "1.2.3"}),
	)
	if err == nil || !strings.Contains(err.Error(), "stamp plist") {
		t.Fatalf("run error = %v, want plist stamping failure", err)
	}
	after, readErr := os.ReadFile(plistPath) // #nosec G304 -- test path is a disposable fixture
	if readErr != nil {
		t.Fatalf("read after: %v", readErr)
	}
	if !bytes.Equal(after, before) {
		t.Fatal("original plist changed after the second Set failed")
	}
}

func requirePlistBuddy(t *testing.T) {
	t.Helper()
	if runtime.GOOS != "darwin" {
		t.Skip("native PlistBuddy is only available on macOS")
	}
	if _, err := os.Stat(plistBuddyPath); err != nil {
		t.Fatalf("PlistBuddy unavailable: %v", err)
	}
}

func repoPath(t *testing.T, parts ...string) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", ".."))
	if err != nil {
		t.Fatalf("resolve repository root: %v", err)
	}
	return filepath.Join(append([]string{root}, parts...)...)
}

func copyFixture(t *testing.T, source string) string {
	t.Helper()
	return copyFixtureTo(t, source, t.TempDir())
}

func copyFixtureTo(t *testing.T, source, destinationDir string) string {
	t.Helper()
	raw, err := os.ReadFile(source) // #nosec G304 -- tests supply repository fixtures
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	destination := filepath.Join(destinationDir, filepath.Base(source))
	if err := os.WriteFile(destination, raw, 0o600); err != nil { // #nosec G703 -- destination is inside t.TempDir
		t.Fatalf("write fixture: %v", err)
	}
	return destination
}

func emptyEnvironment(string) string { return "" }

func mapEnvironment(values map[string]string) func(string) string {
	return func(key string) string { return values[key] }
}

func assertVersions(t *testing.T, plistPath, want string) {
	t.Helper()
	for _, key := range []string{"CFBundleShortVersionString", "CFBundleVersion"} {
		if got := plistValue(t, plistPath, key); got != want {
			t.Errorf("%s = %q, want %q", key, got, want)
		}
	}
}

func plistValues(t *testing.T, plistPath string, keys []string) map[string]string {
	t.Helper()
	values := make(map[string]string, len(keys))
	for _, key := range keys {
		values[key] = plistValue(t, plistPath, key)
	}
	return values
}

func plistValue(t *testing.T, plistPath, key string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, plistBuddyPath, "-c", "Print :"+key, plistPath) // #nosec G204 -- test keys and paths are controlled fixtures
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("PlistBuddy Print %s: %v: %s", key, err, output)
	}
	return strings.TrimSpace(string(output))
}

func runPlistBuddy(t *testing.T, plistPath, commandText string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, plistBuddyPath, "-c", commandText, plistPath) // #nosec G204 -- test command and path are controlled fixtures
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("PlistBuddy %q: %v: %s", commandText, err, output)
	}
}
