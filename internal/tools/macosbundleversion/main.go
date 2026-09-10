// Package main stamps a generated macOS bundle plist with Mill's effective version.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const plistBuddyPath = "/usr/libexec/PlistBuddy"

type buildConfig struct {
	Info *struct {
		Version *string `yaml:"version"`
	} `yaml:"info"`
}

func main() {
	if err := run(os.Args[1:], os.Getenv); err != nil {
		fmt.Fprintf(os.Stderr, "macosbundleversion: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string, getenv func(string) string) error {
	if len(args) != 2 {
		return errors.New("usage: macosbundleversion <build-config.yml> <Info.plist>")
	}

	version, err := effectiveVersion(args[0], getenv)
	if err != nil {
		return err
	}
	return stampPlist(args[1], version)
}

func effectiveVersion(configPath string, getenv func(string) string) (string, error) {
	if version := getenv("MILL_VERSION"); version != "" {
		return version, nil
	}
	if version := getenv("MILL_UPDATE_VERSION"); version != "" {
		return version, nil
	}

	raw, err := os.ReadFile(configPath) // #nosec G304,G703 -- the packaging task supplies the repository-owned config path
	if err != nil {
		return "", fmt.Errorf("read build config: %w", err)
	}
	var config buildConfig
	if err := yaml.Unmarshal(raw, &config); err != nil {
		return "", fmt.Errorf("parse build config: %w", err)
	}
	if config.Info == nil {
		return "", errors.New("build config is missing info")
	}
	if config.Info.Version == nil {
		return "", errors.New("build config is missing info.version")
	}
	version := strings.TrimSpace(*config.Info.Version)
	if version == "" {
		return "", errors.New("build config info.version is empty")
	}
	return version, nil
}

func stampPlist(plistPath, version string) error {
	info, err := os.Stat(plistPath) // #nosec G703 -- the packaging task supplies the generated bundle plist path
	if err != nil {
		return fmt.Errorf("stat plist: %w", err)
	}
	original, err := os.ReadFile(plistPath) // #nosec G304,G703 -- the packaging task supplies the generated bundle plist path
	if err != nil {
		return fmt.Errorf("read plist: %w", err)
	}

	temporary, err := os.CreateTemp(filepath.Dir(plistPath), "."+filepath.Base(plistPath)+".version-*")
	if err != nil {
		return fmt.Errorf("create temporary plist: %w", err)
	}
	temporaryPath := temporary.Name()
	keepTemporary := true
	defer func() {
		if keepTemporary {
			_ = os.Remove(temporaryPath) // #nosec G703 -- CreateTemp returned this same-directory path
		}
	}()

	if _, err := temporary.Write(original); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("copy plist to temporary file: %w", err)
	}
	if err := temporary.Chmod(info.Mode().Perm()); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("preserve plist permissions: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary plist: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	command := exec.CommandContext( // #nosec G204 -- the executable is the fixed native PlistBuddy path
		ctx,
		plistBuddyPath,
		"-c", "Set :CFBundleShortVersionString "+version,
		"-c", "Set :CFBundleVersion "+version,
		temporaryPath,
	)
	if output, err := command.CombinedOutput(); err != nil {
		return fmt.Errorf("stamp plist: %w: %s", err, strings.TrimSpace(string(output)))
	}
	if err := os.Rename(temporaryPath, plistPath); err != nil { // #nosec G703 -- both paths are in the generated plist's directory
		return fmt.Errorf("replace plist: %w", err)
	}
	keepTemporary = false
	return nil
}
