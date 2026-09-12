package pluginsvc

import (
	"context"
	"errors"

	"github.com/alicoding/mill/internal/adapters/pluginstate"
)

// LoadApprovalState exposes the state adapter without giving it a plugin domain model.
func LoadApprovalState(p *PluginService) ([]byte, int64, bool, error) {
	return p.state.LoadApproval(context.Background())
}

// UpdateApprovalState publishes one settings-owned approval mutation.
func UpdateApprovalState(p *PluginService, approvalInitializer func() ([]byte, error), change func([]byte) ([]byte, error)) ([]byte, int64, error) {
	catalogInitializer, err := p.catalogInitializer()
	if err != nil {
		return nil, 0, err
	}
	return p.state.UpdateApproval(context.Background(), catalogInitializer, pluginstate.Initializer(approvalInitializer), pluginstate.Change(change))
}

func (p *PluginService) catalogInitializer() (pluginstate.Initializer, error) {
	_, _, present, err := p.state.Load(context.Background())
	if err != nil {
		return nil, err
	}
	initial, err := p.initialCatalogPayload(present)
	if err != nil {
		return nil, err
	}
	return func() ([]byte, error) {
		if initial == nil {
			return nil, errors.New("extension source state disappeared during schema migration")
		}
		return append([]byte(nil), initial...), nil
	}, nil
}
