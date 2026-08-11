package triggersvc

import "github.com/alicoding/mill/internal/adapters/schedule"

// Schema registers from internal/domain/composition/triggers.go, not
// here -- see that file's doc comment.
func init() {
	RegisterTrigger("trigger-schedule", func(s *TriggerService, workflowID string, config map[string]string) (*activeListener, error) {
		cronExpr := config["cron"]
		if cronExpr == "" {
			return nil, nil
		}
		b, err := schedule.Add(cronExpr, func() { s.fire(workflowID, "", "") })
		if err != nil {
			return nil, err
		}
		return &activeListener{schedule: b}, nil
	})
}
