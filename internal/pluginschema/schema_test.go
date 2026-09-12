package pluginschema_test

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"github.com/alicoding/mill/internal/pluginschema"
	validator "github.com/santhosh-tekuri/jsonschema/v6"
)

func TestGeneratedSchemaMatchesPublishedSDKArtifact(t *testing.T) {
	fresh, err := pluginschema.Generate()
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	committed, err := os.ReadFile("../../frontend/plugin-sdk/manifest.schema.json")
	if err != nil {
		t.Fatalf("read published schema: %v", err)
	}
	if !bytes.Equal(fresh, committed) {
		t.Fatal("published plugin manifest schema is stale; run `task regen`")
	}
}

func TestGeneratedSchemaDescribesManifestStructure(t *testing.T) {
	data, err := pluginschema.Generate()
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	doc, err := validator.UnmarshalJSON(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decode schema: %v", err)
	}
	compiler := validator.NewCompiler()
	if err := compiler.AddResource(pluginschema.ID, doc); err != nil {
		t.Fatalf("AddResource: %v", err)
	}
	schema, err := compiler.Compile(pluginschema.ID)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	cases := []struct {
		name    string
		raw     string
		wantErr bool
	}{
		{"representative manifest", `{"id":"demo","name":"Demo","version":"1.0.0","contributes":{"commands":[{"id":"demo.run","label":"Run"}]}}`, false},
		{"missing loader core fields", `{"contributes":{}}`, true},
		{"wrong field type", `{"id":42,"contributes":{}}`, true},
		{"wrong contribution shape", `{"id":"demo","contributes":{"commands":{}}}`, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var instance any
			if err := json.Unmarshal([]byte(tc.raw), &instance); err != nil {
				t.Fatal(err)
			}
			err := schema.Validate(instance)
			if (err != nil) != tc.wantErr {
				t.Fatalf("Validate error = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}
