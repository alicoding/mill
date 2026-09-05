package triggersvc

import (
	"time"

	"github.com/alicoding/mill/internal/adapters/clipboard"
)

// Schema registers from internal/domain/composition/triggers.go, not
// here -- see that file's doc comment.
func init() {
	RegisterTrigger("trigger-clipboard-watch", func(s *TriggerService, workflowID string, _ map[string]string) (*activeListener, error) {
		// clipboard.New() resolves to the in-memory Port inside a go
		// test binary (goal 0356) -- never the real pasteboard by
		// default.
		stop := clipboard.New().WatchChanges(2*time.Second, func(string) { s.fire(workflowID, "", "") })
		return &activeListener{clipStop: stop}, nil
	})
}
