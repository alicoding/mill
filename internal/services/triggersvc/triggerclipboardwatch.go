package triggersvc

import (
	"time"

	"github.com/alicoding/mill/internal/adapters/clipboard"
)

// Schema registers from internal/domain/composition/triggers.go, not
// here -- see that file's doc comment.
func init() {
	RegisterTrigger("trigger-clipboard-watch", func(s *TriggerService, workflowID string, _ map[string]string) (*activeListener, error) {
		stop := clipboard.WatchChanges(2*time.Second, func() { s.fire(workflowID, "") })
		return &activeListener{clipStop: stop}, nil
	})
}
