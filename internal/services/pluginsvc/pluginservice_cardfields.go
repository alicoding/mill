package pluginsvc

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/services/guardrailsvc"
)

// The card-field edit door (docs/goals/0357): a plugin with the
// "edit-card-fields" capability merge-writes named typed-field values
// onto an existing card -- the ONE write door for field values (the
// roadmap view's own placement writes), through the same guarded plane
// WriteContentForPlugin rides, kept a separate door because its
// capability is separate: field edits are the shape a read-mostly
// board view asks for on their own. Refusals that need no rule --
// undeclared capability, a malformed ask -- happen BEFORE the
// guardrail is consulted, exactly as WriteContentForPlugin orders its
// own.

// CardFieldsKind is the guardrail action kind a plugin card-field
// edit is evaluated under; attributes carry the target card id and
// the written field keys.
const CardFieldsKind = "card.set-fields"

// SetCardFieldsForPlugin performs one guarded card-field merge-write.
// The write itself lives in atlassvc's own plugin-actor door
// (journaled, undoable), reaching here through the wired
// ContentWriter.
func (p *PluginService) SetCardFieldsForPlugin(pluginID, cardID string, fields map[string]string) (PluginContentWriteResult, error) {
	plugin := p.resolvePlugin(pluginID)
	if plugin.Error != "" {
		return PluginContentWriteResult{}, fmt.Errorf("plugin %q: %s", pluginID, plugin.Error)
	}
	if !hasCapability(plugin.Manifest, "edit-card-fields") {
		return PluginContentWriteResult{}, fmt.Errorf("plugin %q does not declare the \"edit-card-fields\" capability in its manifest", pluginID)
	}
	if strings.TrimSpace(cardID) == "" {
		return PluginContentWriteResult{}, errors.New("a card-field edit needs a cardId")
	}
	if len(fields) == 0 {
		return PluginContentWriteResult{}, errors.New("a card-field edit needs at least one field")
	}
	keys := make([]string, 0, len(fields))
	for k := range fields {
		keys = append(keys, k)
	}
	if p.guardrail == nil || p.content == nil {
		return PluginContentWriteResult{}, errors.New("card-field edits unavailable: a plugin write is always guarded and wired at the composition root")
	}
	decision, err := p.guardrail.RequestGuardedAction(context.Background(), guardrailsvc.GuardedAction{
		Kind: CardFieldsKind,
		Attributes: map[string]string{
			"cardId": cardID,
			"fields": strings.Join(keys, ","),
		},
		Description: fmt.Sprintf("Set field values on card %s", cardID),
		Source:      "plugin:" + pluginID,
	})
	if err != nil {
		return PluginContentWriteResult{}, err
	}
	out := PluginContentWriteResult{Approved: decision.Approved, Effect: string(decision.Effect), RuleLabel: decision.RuleLabel}
	if !decision.Approved {
		return out, nil
	}
	if err := p.content.SetCardFields(cardID, fields); err != nil {
		return out, err
	}
	out.ID = cardID
	return out, nil
}
