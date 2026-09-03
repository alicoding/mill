package brunosource

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func writeCollection(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	must := func(name, content string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(filepath.Join(dir, name)), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	must("bruno.json", `{"version":"1","name":"Steam Gazette API","type":"collection"}`)
	must(".env", "API_TOKEN=tok\n")
	must("environments/dev.bru", "vars {\n  host: https://dev\n}\nvars:secret [\n  API_TOKEN,\n  SIGNING_KEY\n]\n")
	must("environments/prod.bru", "vars:secret [ API_TOKEN, prodOnly ]\n")
	return dir
}

func TestRead_NamesEnvAndDeclaredSecrets(t *testing.T) {
	dir := writeCollection(t)
	for _, path := range []string{dir, filepath.Join(dir, "bruno.json")} {
		c, err := Read(path)
		if err != nil {
			t.Fatalf("Read(%s): %v", path, err)
		}
		if c.Name != "Steam Gazette API" || c.Dir != dir || c.EnvPath != filepath.Join(dir, ".env") {
			t.Fatalf("collection = %+v", c)
		}
		if !reflect.DeepEqual(c.SecretNames, []string{"API_TOKEN", "SIGNING_KEY", "prodOnly"}) {
			t.Fatalf("secret names = %v", c.SecretNames)
		}
	}
	if _, err := Read(t.TempDir()); err == nil {
		t.Fatal("a folder without bruno.json read as a collection")
	}
}
