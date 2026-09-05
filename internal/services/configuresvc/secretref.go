package configuresvc

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/usererror"
	"github.com/alicoding/mill/internal/domain/vaultref"
)

// Every secret-shaped field on a Configure entity holds a REFERENCE,
// never a value (goal 0306): the token, key or certificate lives in the
// secret store, and the entity names it. That is what keeps one set of
// controls -- the unlock requirement, the audit trail (goal 0203), the
// guardrail secret attribute -- in front of every credential, whichever
// form a user first typed it into.
//
// vaultref.go's resolveVaultRefValue is the LENIENT resolver, for a
// field (an HTTP header, an env entry) whose value may legitimately be
// a literal. The resolvers here are STRICT: a dedicated secret field
// resolves a reference or reports why it cannot, so a literal can never
// silently become a credential again.

// ErrSecretNotChosen is the state a field is in before anyone has
// picked a secret for it. The code is the stable handle the frontend
// keys its own wording on.
//
// The sentence names the FIELD, never the entity: an entity's label is
// arbitrary user text, and a one-sentence user error carries no
// interpolated chain (usererror.ValidMessage). Which entity failed
// belongs to the surface reporting it, and to the wrapped cause the
// boundary log keeps.
var ErrSecretNotChosen = usererror.New("secret-not-chosen", "No secret is chosen for this integration yet.")

// ErrSecretRefInvalid is a field holding something that is not a
// reference at all -- an entity edited by hand, or an import from a
// Mill that predates references.
var ErrSecretRefInvalid = usererror.New("secret-ref-invalid", "This field holds a value instead of naming a stored secret.")

// resolveSecretRef resolves one reference field's value through the
// secret store, recording the read. field names the field for the
// error a reader sees ("Bearer token", "Consumer secret"); label names
// the entity it belongs to.
func (c *ConfigureService) resolveSecretRef(label, field, ref string, actx secretaudit.AccessContext) (string, error) {
	if ref == "" {
		return "", usererror.Wrap(ErrSecretNotChosen.Code,
			fmt.Sprintf("No secret is chosen for this integration's %s. Open it in Configure and pick one.", field),
			fmt.Errorf("request %q: no %s reference: %w", label, field, ErrSecretNotChosen))
	}
	id, ok := vaultref.Parse(ref)
	if !ok {
		return "", usererror.Wrap(ErrSecretRefInvalid.Code,
			fmt.Sprintf("This integration's %s holds a value instead of naming a stored secret.", field),
			fmt.Errorf("request %q: %s is not a reference: %w", label, field, ErrSecretRefInvalid))
	}
	return c.secretResolver(id, actx)
}

// resolveOptionalSecretRef is resolveSecretRef for a field that may
// legitimately be unset -- an AI provider reaching a local endpoint
// that wants no credential at all. An empty reference resolves to an
// empty value with no error and no audit line.
func (c *ConfigureService) resolveOptionalSecretRef(label, field, ref string, actx secretaudit.AccessContext) (string, error) {
	if ref == "" {
		return "", nil
	}
	return c.resolveSecretRef(label, field, ref, actx)
}
