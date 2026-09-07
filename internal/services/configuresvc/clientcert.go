package configuresvc

import (
	"log/slog"
	"time"

	"github.com/alicoding/mill/internal/adapters/httpconnector"
	"github.com/alicoding/mill/internal/domain/clientcert"
	"github.com/alicoding/mill/internal/domain/seedorigin"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/entitystore"
	"github.com/alicoding/mill/internal/services/seeding"
)

// Client certificates (goal 0306 S1): which certificate Mill presents
// to which host. Same entity recipe as every other kind here; the only
// thing particular to this one is that a write drops the cached
// transports, so an edited certificate is in force on the next call
// rather than living on inside a pooled connection.

const clientCertsKey = "configure-clientcerts"

var clientCertDescriptor = entitystore.Descriptor[clientcert.ClientCertificate]{
	Label:     "client certificate",
	GetID:     func(c clientcert.ClientCertificate) string { return c.ID },
	IsBuiltIn: func(c clientcert.ClientCertificate) bool { return c.BuiltIn },
	GetSeed:   func(c clientcert.ClientCertificate) seedorigin.Origin { return c.Seed },
	SetSeed: func(c clientcert.ClientCertificate, o seedorigin.Origin) clientcert.ClientCertificate {
		c.Seed = o
		return c
	},
	StampNew: func(c clientcert.ClientCertificate, now time.Time) clientcert.ClientCertificate {
		c.CreatedAt, c.UpdatedAt = now, now
		return c
	},
	Upgrade: func(existing, golden clientcert.ClientCertificate, now time.Time) clientcert.ClientCertificate {
		golden.CreatedAt = existing.CreatedAt
		golden.UpdatedAt = now
		return golden
	},
	BuiltIn: clientcert.BuiltIn,
}

func (c *ConfigureService) ClientCertificates() []clientcert.ClientCertificate {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]clientcert.ClientCertificate, len(c.clientCerts))
	copy(out, c.clientCerts)
	return out
}

func (c *ConfigureService) CreateClientCertificate(label, host, certRef, keyRef, passphraseRef, caRef, notes string) (clientcert.ClientCertificate, error) {
	now := time.Now()
	entity := clientcert.ClientCertificate{
		ID: seeding.NewSlugID(label, "clientcert"), Label: label, Host: host,
		CertRef: certRef, KeyRef: keyRef, PassphraseRef: passphraseRef, CARef: caRef,
		Notes: notes, CreatedAt: now, UpdatedAt: now,
	}
	if err := clientcert.Validate(&entity); err != nil {
		return clientcert.ClientCertificate{}, err
	}
	if err := entitystore.Insert(&c.mu, &c.clientCerts, c.persistClientCertificates, clientCertDescriptor, entity); err != nil {
		return clientcert.ClientCertificate{}, err
	}
	c.clientCertsChanged(entity.ID)
	return entity, nil
}

func (c *ConfigureService) UpdateClientCertificate(id, label, host, certRef, keyRef, passphraseRef, caRef, notes string) (clientcert.ClientCertificate, error) {
	entity := clientcert.ClientCertificate{
		ID: id, Label: label, Host: host,
		CertRef: certRef, KeyRef: keyRef, PassphraseRef: passphraseRef, CARef: caRef, Notes: notes,
	}
	if err := clientcert.Validate(&entity); err != nil {
		return clientcert.ClientCertificate{}, err
	}
	updated, err := entitystore.Update(&c.mu, &c.clientCerts, c.persistClientCertificates, clientCertDescriptor, id, func(existing clientcert.ClientCertificate) (clientcert.ClientCertificate, error) {
		entity.BuiltIn = existing.BuiltIn
		entity.CreatedAt = existing.CreatedAt
		entity.UpdatedAt = time.Now()
		entity.Seed = existing.Seed.Touch()
		return entity, nil
	})
	if err != nil {
		return clientcert.ClientCertificate{}, err
	}
	c.clientCertsChanged(updated.ID)
	return updated, nil
}

func (c *ConfigureService) DeleteClientCertificate(id string) error {
	return deleteEntity(c, "clientcert", &c.clientCerts, c.persistClientCertificates, clientCertDescriptor, nil,
		func(cert clientcert.ClientCertificate) string { return cert.Label }, c.clientCertsChanged, id)
}

// DuplicateClientCertificate copies one entity's fields onto a new one,
// so a second host reusing the same material is one action rather than
// a re-pick of every reference.
func (c *ConfigureService) DuplicateClientCertificate(id string) (clientcert.ClientCertificate, error) {
	for _, existing := range c.ClientCertificates() {
		if existing.ID != id {
			continue
		}
		return c.CreateClientCertificate(existing.Label+" copy", existing.Host, existing.CertRef, existing.KeyRef, existing.PassphraseRef, existing.CARef, existing.Notes)
	}
	return clientcert.ClientCertificate{}, clientCertNotFound(id)
}

// clientCertsChanged announces the write and drops both caches that
// could otherwise answer from the previous revision: the built
// transports, and the certificate statuses the list reads.
func (c *ConfigureService) clientCertsChanged(id string) {
	httpconnector.InvalidateClientTLS()
	c.clientCertStatuses.Clear()
	dataevent.Emit("clientcert", id)
}

func (c *ConfigureService) persistClientCertificates() error {
	return entitystore.Persist(&c.mu, &c.clientCerts, c.store, clientCertsKey, clientCertDescriptor)
}

func (c *ConfigureService) restoreClientCertificates() {
	entitystore.Load(&c.mu, &c.clientCerts, c.store, clientCertsKey)
}

func (c *ConfigureService) reconcileBuiltInClientCertificates() {
	tombstones := seeding.LoadTombstones(c.store)
	if _, changed := entitystore.Reconcile(&c.mu, &c.clientCerts, tombstones, clientCertDescriptor); changed {
		if err := c.persistClientCertificates(); err != nil {
			slog.Error("failed to reconcile built-in client certificates", "error", err)
		}
	}
}
