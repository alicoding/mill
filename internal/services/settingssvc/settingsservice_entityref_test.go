package settingssvc

import (
	"testing"

	"github.com/alicoding/mill/internal/domain/reference"
	"github.com/alicoding/mill/internal/services/dataevent"
)

// captureLifecycleEmits mirrors atlassvc's own helper
// (atlaslifecycleevent_test.go) -- dataevent.LifecycleTestHook is the
// only way to observe an emitLifecycle call under `go test`.
func captureLifecycleEmits(t *testing.T) *[]dataevent.LifecycleEvent {
	t.Helper()
	var got []dataevent.LifecycleEvent
	dataevent.LifecycleTestHook = func(ev dataevent.LifecycleEvent) { got = append(got, ev) }
	t.Cleanup(func() { dataevent.LifecycleTestHook = nil })
	return &got
}

func findLifecycleEvent(events []dataevent.LifecycleEvent, name string) (dataevent.LifecycleEvent, bool) {
	for _, ev := range events {
		if ev.Event == name {
			return ev, true
		}
	}
	return dataevent.LifecycleEvent{}, false
}

// TestSetExtensionSetting_EntityRef_FiresReferencedThenDereferenced is
// docs/goals/0400's own lifecycle proof: picking an entityRef setting
// fires entity.referenced naming the plugin+setting; changing it to a
// different id fires entity.dereferenced for the old one (with the
// live remaining count) and entity.referenced for the new one; a
// non-entityRef setting (never wired to the lookup) fires neither.
func TestSetExtensionSetting_EntityRef_FiresReferencedThenDereferenced(t *testing.T) {
	s := newTestSettingsService(t)
	s.WireEntityReferenceEvents(
		func(pluginID, key string) (string, bool) {
			if pluginID == "mill-live-view" && key == "integrationId" {
				return "request", true
			}
			return "", false
		},
		func(entityKind, id string) reference.Refs {
			return reference.Refs{} // nothing else references it once cleared
		},
	)
	got := captureLifecycleEmits(t)

	if err := s.SetExtensionSetting("mill-live-view", "integrationId", `"req-1"`); err != nil {
		t.Fatalf("SetExtensionSetting: %v", err)
	}
	referenced, ok := findLifecycleEvent(*got, "entity.referenced")
	if !ok || referenced.EntityKind != "request" || referenced.EntityID != "req-1" {
		t.Fatalf("entity.referenced = %+v, ok=%v, want request/req-1", referenced, ok)
	}
	if referenced.By == nil || referenced.By.PluginID != "mill-live-view" || referenced.By.SettingKey != "integrationId" {
		t.Fatalf("entity.referenced.By = %+v, want the plugin+setting", referenced.By)
	}

	*got = nil
	if err := s.SetExtensionSetting("mill-live-view", "integrationId", `"req-2"`); err != nil {
		t.Fatalf("SetExtensionSetting: %v", err)
	}
	if _, ok := findLifecycleEvent(*got, "entity.referenced"); !ok {
		t.Error("changing the picked entity must fire entity.referenced for the new one")
	}
	dereferenced, ok := findLifecycleEvent(*got, "entity.dereferenced")
	if !ok || dereferenced.EntityID != "req-1" || dereferenced.Remaining == nil || *dereferenced.Remaining != 0 {
		t.Fatalf("entity.dereferenced = %+v, ok=%v, want req-1 with Remaining 0", dereferenced, ok)
	}

	*got = nil
	if err := s.SetExtensionSetting("mill-live-view", "otherSetting", `"unrelated"`); err != nil {
		t.Fatalf("SetExtensionSetting: %v", err)
	}
	if len(*got) != 0 {
		t.Errorf("a non-entityRef setting must fire no lifecycle event, got %+v", *got)
	}
}

func TestSetExtensionSetting_EntityRef_NoOpUntilWired(t *testing.T) {
	s := newTestSettingsService(t)
	got := captureLifecycleEmits(t)

	if err := s.SetExtensionSetting("mill-live-view", "integrationId", `"req-1"`); err != nil {
		t.Fatalf("SetExtensionSetting: %v", err)
	}
	if len(*got) != 0 {
		t.Errorf("with WireEntityReferenceEvents never called, want no lifecycle events, got %+v", *got)
	}
}
