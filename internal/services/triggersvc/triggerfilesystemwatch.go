package triggersvc

import "github.com/alicoding/mill/internal/adapters/filewatch"

// Schema registers from internal/domain/composition/triggers.go, not
// here -- see that file's doc comment.
func init() {
	RegisterTrigger("trigger-filesystem-watch", func(s *TriggerService, workflowID string, config map[string]string) (*activeListener, error) {
		path := config["path"]
		if path == "" {
			return nil, nil
		}
		b, err := filewatch.Watch(path, func() { s.fire(workflowID, "") })
		if err != nil {
			return nil, err
		}
		return &activeListener{fileWatch: b}, nil
	})
}
