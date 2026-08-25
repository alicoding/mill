package settingssvc

// The updater's outbound-proxy support (goal 0123) -- split from
// settingsservice_updates.go at the 500-line convention along the
// proxy-vs-updater-core seam.

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	gproxy "github.com/rapid7/go-get-proxied/proxy"
)

// updaterUserAgentTransport stamps a descriptive User-Agent on every
// updater request. The provider's default client sends Go's anonymous
// "Go-http-client", which managed-network proxies commonly filter;
// identifying as Mill's own updater names the traffic honestly in
// proxy logs either way. Clones the request per the RoundTripper
// contract (a RoundTrip must not mutate its argument).
type updaterUserAgentTransport struct {
	agent string
	base  http.RoundTripper
}

func (t updaterUserAgentTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.Header.Set("User-Agent", t.agent)
	return t.base.RoundTrip(clone)
}

func newUpdaterHTTPClient(currentVersion, proxyURL string) *http.Client {
	// A dedicated transport, not http.DefaultTransport: the proxy
	// choice (goal 0123) must not mutate the process-wide default.
	base := http.DefaultTransport.(*http.Transport).Clone()
	base.Proxy = updaterProxyFunc(proxyURL)
	return &http.Client{
		Timeout: 30 * time.Second,
		Transport: updaterUserAgentTransport{
			agent: "Mill-Updater/" + currentVersion,
			base:  base,
		},
	}
}

// outboundProxyKey persists the app-level outbound proxy URL (goal
// 0123, the multi-purpose-surface rule's network instance): first
// consumer is the updater's HTTP client -- a managed network that
// 403s direct non-browser downloads allows the same fetch through
// its proxy. Empty = Go's ProxyFromEnvironment (env vars keep
// working for server-mode/CLI launches; a Finder-launched app has
// none, which is exactly why this preference exists). Applies at
// boot, same restart semantics as the channel preference.
const outboundProxyKey = "outboundProxyURL"

// OutboundProxyURL returns the persisted proxy URL ("" = none).
func (s *SettingsService) OutboundProxyURL() string {
	v, _ := s.store.Get(outboundProxyKey).(string)
	return v
}

// SetOutboundProxyURL validates and persists the proxy URL; "" clears.
func (s *SettingsService) SetOutboundProxyURL(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw != "" && raw != proxyModeOff {
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return fmt.Errorf("the proxy must be an http or https URL, like http://proxy.example.com:8080")
		}
	}
	return s.store.Set(outboundProxyKey, raw)
}

// proxyModeOff is the persisted sentinel for "always connect
// directly" -- distinct from "" (Auto), which detects the system
// proxy. Stored in the same key as a manual URL; never a valid URL.
const proxyModeOff = "off"

// updaterProxyFunc picks the transport proxy by mode (goal 0123):
// a manual URL always wins; "off" forces direct; "" (Auto, the
// default) asks the OS for its configured proxy per request via
// go-get-proxied (macOS scutil/env; PAC-only setups aren't resolved
// -- the named gap -- and fall through to environment resolution).
func updaterProxyFunc(pref string) func(*http.Request) (*url.URL, error) {
	switch pref {
	case proxyModeOff:
		return func(*http.Request) (*url.URL, error) { return nil, nil }
	case "":
		provider := gproxy.NewProvider("")
		return func(req *http.Request) (*url.URL, error) {
			if p := provider.GetProxy(req.URL.Scheme, req.URL.String()); p != nil {
				return p.URL(), nil
			}
			return http.ProxyFromEnvironment(req)
		}
	}
	fixed, err := url.Parse(pref)
	if err != nil {
		return http.ProxyFromEnvironment
	}
	return http.ProxyURL(fixed)
}
