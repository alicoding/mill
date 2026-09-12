package pluginsvc

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/domain/usererror"
)

// fetchTimeout bounds every user-initiated download. Long enough for a
// slow release asset, short enough that a hung host does not hold the
// UI's notice open forever.
const fetchTimeout = 60 * time.Second

// maxIndexBytes caps an index download; an index is a small JSON file,
// and anything larger is a wrong address, not a marketplace.
const maxIndexBytes int64 = 4 << 20

// maxDownloadBytes caps an archive download.
const maxDownloadBytes int64 = maxArchiveBytes

func (p *PluginService) httpGetBytesForOrigin(rawURL string, limit int64, origin SourceOrigin, artifact bool) ([]byte, string, error) {
	return p.httpGetBytesForOriginContext(context.Background(), rawURL, limit, origin, artifact)
}

func (p *PluginService) httpGetBytesForOriginContext(ctx context.Context, rawURL string, limit int64, origin SourceOrigin, artifact bool) ([]byte, string, error) {
	if err := policyRequestRefusal(origin, rawURL, artifact); err != nil {
		return nil, "", err
	}
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
	if p.download != nil {
		data, err := p.download(rawURL, limit)
		if err == nil {
			err = ctx.Err()
		}
		return data, rawURL, err
	}
	return p.downloadHTTPContext(ctx, rawURL, limit, origin, artifact)
}

func (p *PluginService) downloadHTTPContext(parent context.Context, rawURL string, limit int64, origin SourceOrigin, artifact bool) ([]byte, string, error) {
	ctx, cancel := context.WithTimeout(parent, fetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("that address can't be read")
	}
	client := &http.Client{Timeout: fetchTimeout, CheckRedirect: func(next *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return fmt.Errorf("too many redirects")
		}
		if len(via) > 0 && via[len(via)-1].URL.Scheme == "https" && next.URL.Scheme == "http" {
			return fmt.Errorf("an https download cannot redirect to http")
		}
		return policyRequestRefusal(origin, next.URL.String(), artifact)
	}}
	resp, err := client.Do(req)
	if err != nil {
		var userErr *usererror.Error
		if errors.As(err, &userErr) {
			return nil, "", userErr
		}
		return nil, "", fmt.Errorf("couldn't reach that address")
	}
	defer func() { _ = resp.Body.Close() }()
	data, err := readHTTPResponseContext(ctx, resp, limit)
	if err != nil {
		return nil, "", err
	}
	return data, resp.Request.URL.String(), nil
}

func readHTTPResponse(resp *http.Response, limit int64) ([]byte, error) {
	return readHTTPResponseContext(context.Background(), resp, limit)
}

func readHTTPResponseContext(ctx context.Context, resp *http.Response, limit int64) ([]byte, error) {
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, &httpStatusError{status: resp.StatusCode}
	}
	data, err := io.ReadAll(io.LimitReader(&contextReader{ctx: ctx, reader: resp.Body}, limit+1))
	if err != nil {
		return nil, fmt.Errorf("that download stopped partway")
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("that download is too large")
	}
	return data, nil
}

type httpStatusError struct {
	status int
}

func (e *httpStatusError) Error() string {
	if e.status == http.StatusNotFound {
		return "nothing is published at that address"
	}
	return fmt.Sprintf("that address answered %d", e.status)
}

// fetchIndex reads one source's index from disk for a folder source
// and over HTTPS for every other kind. Only Add and Refresh call it.
func (p *PluginService) fetchIndex(src MarketplaceSource) (MarketplaceIndex, error) {
	if err := policySourceRegistrationRefusal(src.Name, src); err != nil {
		return MarketplaceIndex{}, err
	}
	if src.Kind == "path" {
		raw, err := p.readSourceFile(src.Origin, IndexFile)
		if err != nil {
			return MarketplaceIndex{}, fmt.Errorf("that folder has no %s file", IndexFile)
		}
		return ParseIndex(raw)
	}
	url, err := IndexURL(src)
	if err != nil {
		return MarketplaceIndex{}, err
	}
	raw, _, err := p.httpGetBytesForOrigin(url, maxIndexBytes, src.Origin, false)
	if err != nil {
		return MarketplaceIndex{}, err
	}
	return ParseIndex(raw)
}

func pathAcquisitionRoot(origin SourceOrigin) (string, error) {
	if origin.Kind != "path" || !filepath.IsAbs(origin.Locator) {
		return "", fmt.Errorf("source folder identity is invalid")
	}
	st := LoadPolicy()
	if !st.Present {
		return filepath.Clean(origin.Locator), nil
	}
	if st.Error != "" {
		return "", ErrPolicyUnreadable
	}
	if st.Policy.Version != PolicyVersion || st.Policy.Sources == nil {
		return filepath.Clean(origin.Locator), nil
	}
	for _, rule := range st.Policy.Sources {
		if rule.Kind == "path" && sourceRuleMatches(rule, origin) {
			return filepath.Clean(rule.Locator), nil
		}
	}
	return "", policyRefused(st.Policy.SourceRefusal())
}

func (p *PluginService) openSourceDirectory(origin SourceOrigin, relative string) (*os.Root, error) {
	boundary, err := pathAcquisitionRoot(origin)
	if err != nil {
		return nil, err
	}
	if p.sourceRead != nil {
		p.sourceRead(filepath.Join(origin.Locator, filepath.FromSlash(relative)))
	}
	root, err := os.OpenRoot(boundary)
	if err != nil {
		return nil, err
	}
	originRel, err := filepath.Rel(boundary, filepath.Clean(origin.Locator))
	if err != nil || originRel == ".." || strings.HasPrefix(originRel, ".."+string(filepath.Separator)) {
		_ = root.Close()
		return nil, fmt.Errorf("source folder is outside its allowed root")
	}
	directory := filepath.Clean(filepath.Join(originRel, filepath.FromSlash(relative)))
	if filepath.IsAbs(directory) || directory == ".." || strings.HasPrefix(directory, ".."+string(filepath.Separator)) {
		_ = root.Close()
		return nil, fmt.Errorf("source folder path is invalid")
	}
	nested, err := root.OpenRoot(directory)
	_ = root.Close()
	return nested, err
}

func (p *PluginService) readSourceFile(origin SourceOrigin, relative string) ([]byte, error) {
	root, err := p.openSourceDirectory(origin, ".")
	if err != nil {
		return nil, err
	}
	defer func() { _ = root.Close() }()
	name := filepath.Clean(filepath.FromSlash(relative))
	raw, err := root.ReadFile(name)
	if err != nil {
		return nil, err
	}
	return raw, nil
}

func (p *PluginService) copySourceFolderContext(ctx context.Context, origin SourceOrigin, relative, destination string) error {
	root, err := p.openSourceDirectory(origin, relative)
	if err != nil {
		return err
	}
	defer func() { _ = root.Close() }()
	return copyPluginFolderFSContext(ctx, root.FS(), destination)
}

func (p *PluginService) sourceInstallChecks(origin SourceOrigin, relative string, manifest Manifest) ([]string, []string, error) {
	root, err := p.openSourceDirectory(origin, relative)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = root.Close() }()
	refusals, warnings := installChecksFS(root.FS(), manifest)
	return refusals, warnings, nil
}
