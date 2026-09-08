package remoteauthsvc

// Imported as devicedir: this package already declares its own
// unexported "device" type (remoteauthservice.go's persisted pairing
// record) -- the two are unrelated shapes that happen to share the
// obvious noun.
import devicedir "github.com/alicoding/mill/internal/domain/device"

// deviceAccepts is this build's ENTIRE device capability vocabulary
// (docs/goals/0372 decision 3): a phone can receive a plain
// notification; a paired browser is reserved for a future
// browser-replay push that nothing delivers yet; a webhook token is
// inbound-only. Extending a kind's Accepts means shipping a real
// delivery path for that event first -- never just adding a string
// here.
var deviceAccepts = map[string][]string{
	KindDevice:       {"notification"},
	KindBrowser:      {"browser-replay"},
	KindWebhookToken: {},
}

// deviceDirectoryAdapter adapts this service's three paired-credential
// lists (ListDevices/ListBrowsers/ListWebhookTokens) into devicedir.Directory --
// composition's "devices" OptionsSource resolves through this, never
// through remoteauthsvc's own storage-level Kind strings directly.
type deviceDirectoryAdapter struct{ s *RemoteAuthService }

// DeviceDirectory exposes this service as the devicedir.Directory port,
// for Go-side wiring/tests only -- not a frontend RPC (an interface
// value isn't something the generated bindings could usefully call).
// ListDeviceRefs below is the frontend's own door into the same data.
//
//wails:ignore
func (s *RemoteAuthService) DeviceDirectory() devicedir.Directory {
	return deviceDirectoryAdapter{s: s}
}

func (a deviceDirectoryAdapter) List() []devicedir.Ref {
	type source struct {
		storageKind string
		list        func() []DeviceInfo
		kind        devicedir.Kind
	}
	sources := []source{
		{KindDevice, a.s.ListDevices, devicedir.KindPhone},
		{KindBrowser, a.s.ListBrowsers, devicedir.KindBrowser},
		{KindWebhookToken, a.s.ListWebhookTokens, devicedir.KindWebhookToken},
	}

	refs := make([]devicedir.Ref, 0)
	for _, src := range sources {
		for _, d := range src.list() {
			refs = append(refs, devicedir.Ref{
				ID: d.ID, Label: d.Label, Kind: src.kind,
				LastSeenAt: d.LastSeenAt, Accepts: deviceAccepts[src.storageKind],
			})
		}
	}
	return refs
}

// ListDeviceRefs is composition's "devices" OptionsSource resolver
// (docs/goals/0372): every paired phone, browser, and webhook token as
// one directory, filtered to only the refs that accept at least one of
// needs (empty needs returns every ref unfiltered) -- the frontend
// picker calls this with a config field's own declared Needs so the
// offered list never includes a device the event could never reach.
func (s *RemoteAuthService) ListDeviceRefs(needs []string) []devicedir.Ref {
	return devicedir.Filter(s.DeviceDirectory().List(), needs)
}
