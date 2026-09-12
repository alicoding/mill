package pluginsvc

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"io/fs"
	"path"
	"regexp"
	"strings"
)

const tooManyPackageEntries = "This extension contains too many files or folders (limit: 65,536)."

var windowsDrivePath = regexp.MustCompile(`^[A-Za-z]:`)

type folderCopyEntry struct {
	rel       string
	directory bool
	mode      fs.FileMode
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r *contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}

func sanitizedFileMode(mode fs.FileMode) fs.FileMode {
	if mode&0o111 != 0 {
		return 0o700
	}
	return 0o600
}

func entryLimitError(count int) error {
	if count > maxPackageEntries {
		return fmt.Errorf("%s", tooManyPackageEntries)
	}
	return nil
}

func validateArchiveIndex(files []*zip.File) (string, error) {
	if err := entryLimitError(len(files)); err != nil {
		return "", err
	}
	for _, file := range files {
		if _, _, err := portableArchivePath(file.Name); err != nil {
			return "", err
		}
	}
	prefix := commonZipPrefix(files)
	index := newPortablePathIndex()
	for _, file := range files {
		if err := validateArchiveEntry(file, prefix, index); err != nil {
			return "", err
		}
	}
	return prefix, nil
}

func validateArchiveEntry(file *zip.File, prefix string, index *portablePathIndex) error {
	name := strings.TrimPrefix(file.Name, prefix)
	if name == "" {
		if !file.FileInfo().IsDir() {
			return invalidPackagePath(file.Name)
		}
		return nil
	}
	clean, directory, err := portableArchivePath(name)
	if err != nil {
		return err
	}
	mode := file.Mode()
	if mode&fs.ModeSymlink != 0 {
		return fmt.Errorf("that archive contains a symbolic link, so Mill won't install it")
	}
	if !directory && !mode.IsRegular() {
		return fmt.Errorf("that archive contains an unsupported special file, so Mill won't install it")
	}
	return index.add(clean, directory)
}

func portableArchivePath(name string) (string, bool, error) {
	if name == "" || strings.ContainsRune(name, 0) || strings.Contains(name, `\`) || strings.HasPrefix(name, "/") || windowsDrivePath.MatchString(name) {
		return "", false, invalidPackagePath(name)
	}
	directory := strings.HasSuffix(name, "/")
	trimmed := strings.TrimSuffix(name, "/")
	if trimmed == "" || strings.HasSuffix(trimmed, "/") {
		return "", false, invalidPackagePath(name)
	}
	parts := strings.Split(trimmed, "/")
	for _, part := range parts {
		if !portablePathComponent(part) {
			return "", false, invalidPackagePath(name)
		}
	}
	clean := path.Clean(trimmed)
	if clean != trimmed || clean == "." || strings.HasPrefix(clean, "../") {
		return "", false, invalidPackagePath(name)
	}
	return clean, directory, nil
}

func portablePathComponent(component string) bool {
	if component == "" || component == "." || component == ".." || strings.HasSuffix(component, ".") || strings.HasSuffix(component, " ") {
		return false
	}
	if strings.ContainsAny(component, "\n\r<>:\"|?*") {
		return false
	}
	stem := component
	if before, _, found := strings.Cut(component, "."); found {
		stem = before
	}
	upper := strings.ToUpper(stem)
	switch upper {
	case "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9":
		return false
	default:
		return true
	}
}

func invalidPackagePath(name string) error {
	return fmt.Errorf("that package contains an invalid portable path %q", name)
}

type portablePathIndex struct {
	kinds    map[string]bool
	explicit map[string]bool
	names    map[string]string
}

func newPortablePathIndex() *portablePathIndex {
	return &portablePathIndex{
		kinds:    make(map[string]bool),
		explicit: make(map[string]bool),
		names:    make(map[string]string),
	}
}

func (i *portablePathIndex) add(name string, directory bool) error {
	clean, encodedDirectory, err := portableArchivePath(name)
	if err != nil {
		return err
	}
	directory = directory || encodedDirectory
	key := strings.ToLower(clean)
	if existingDirectory, exists := i.kinds[key]; exists {
		if directory && existingDirectory && !i.explicit[key] && i.names[key] == clean {
			i.explicit[key] = true
			return nil
		}
		return fmt.Errorf("that package contains duplicate or aliased paths at %q", name)
	}
	parts := strings.Split(clean, "/")
	for n := 1; n < len(parts); n++ {
		parentName := strings.Join(parts[:n], "/")
		parent := strings.ToLower(parentName)
		parentDirectory, exists := i.kinds[parent]
		if exists {
			if !parentDirectory || i.names[parent] != parentName {
				return fmt.Errorf("that package uses a file as a folder at %q", name)
			}
		} else {
			i.kinds[parent] = true
			i.names[parent] = parentName
		}
	}
	i.kinds[key] = directory
	i.explicit[key] = true
	i.names[key] = clean
	return nil
}
