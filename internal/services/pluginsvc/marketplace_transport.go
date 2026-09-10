package pluginsvc

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
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
	if err := policyRequestRefusal(origin, rawURL, artifact); err != nil {
		return nil, "", err
	}
	if p.download != nil {
		data, err := p.download(rawURL, limit)
		return data, rawURL, err
	}
	return p.downloadHTTP(rawURL, limit, origin, artifact)
}

func (p *PluginService) downloadHTTP(rawURL string, limit int64, origin SourceOrigin, artifact bool) ([]byte, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), fetchTimeout)
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
	data, err := readHTTPResponse(resp, limit)
	if err != nil {
		return nil, "", err
	}
	return data, resp.Request.URL.String(), nil
}

func readHTTPResponse(resp *http.Response, limit int64) ([]byte, error) {
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, &httpStatusError{status: resp.StatusCode}
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
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
		raw, err := p.readSourceFile(filepath.Join(expandHome(src.Locator), filepath.FromSlash(IndexFile)))
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

func (p *PluginService) readSourceFile(path string) ([]byte, error) {
	if p.sourceRead != nil {
		return p.sourceRead(path)
	}
	return os.ReadFile(path) // #nosec G304 -- a source folder the user chose or an installed receipt recorded
}
