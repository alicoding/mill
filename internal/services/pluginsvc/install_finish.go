package pluginsvc

import (
	"fmt"
)

func (p *PluginService) validateMarketplaceSourceIdentity(expected *MarketplaceSource) error {
	if expected == nil || expected.Kind == "bundled" {
		return nil
	}
	current, found, err := p.sourceFor(expected.Name)
	if err != nil {
		return err
	}
	if !found || current.Incarnation != expected.Incarnation || current.Origin != expected.Origin {
		return fmt.Errorf("%q is no longer the registered source used for this installation", expected.Name)
	}
	return nil
}
