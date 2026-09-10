package main

import (
	"fmt"
	"strings"
	"testing"
)

func TestAssetCatalogMetadataAcceptsCompiledForegroundProportion(t *testing.T) {
	if err := validateAssetCatalogMetadata(testAssetCatalogMetadata("143.36,143.36", "737.28,737.28")); err != nil {
		t.Fatal(err)
	}
}

func TestAssetCatalogMetadataRejectsSourceFractionAsComposerScale(t *testing.T) {
	err := validateAssetCatalogMetadata(testAssetCatalogMetadata("476,476", "72,72"))
	if err == nil || !strings.Contains(err.Error(), "is not 72%") {
		t.Fatalf("validateAssetCatalogMetadata() error = %v, want compiled foreground proportion error", err)
	}
}

func testAssetCatalogMetadata(position, size string) []byte {
	return fmt.Appendf(nil, `[
  {"AssetType":"IconImageStack","Name":"appicon","CanvasWidth":1024,"CanvasHeight":1024},
  {"AssetType":"IconGroup","Name":"appicon/Group","Layers":[
    {"Name":"appicon_Assets/mill-mark","LayerPosition":%q,"LayerSize":%q}
  ]}
]`, position, size)
}
