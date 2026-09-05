package mcpsvc

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// registerClientCertResources wires mill://clientcerts beside the rest
// of the mill:// resources family.
func (m *MillMCPService) registerClientCertResources() {
	m.server.AddResource(&mcp.Resource{
		URI: "mill://clientcerts", Name: "clientcerts", MIMEType: "application/json",
		Description: "Every configured client certificate's ID, Label, host pattern, and status (ready/expiring/expired/incomplete). Never includes certificate or key material.",
	}, m.readClientCertsIndex)
}

// readClientCertsIndex answers which host presents which certificate,
// and whether it currently works -- an agent proposing an integration
// can see that a host is already covered without any material
// crossing the boundary.
func (m *MillMCPService) readClientCertsIndex(_ context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
	certs := m.cfg.ClientCertificates()
	statuses := map[string]string{}
	for _, s := range m.cfg.ClientCertificateStatuses() {
		statuses[s.ID] = string(s.State)
	}
	out := make([]clientCertIndexEntry, 0, len(certs))
	for _, c := range certs {
		out = append(out, clientCertIndexEntry{ID: c.ID, Label: c.Label, Host: c.Host, Status: statuses[c.ID]})
	}
	return jsonContents(req.Params.URI, out)
}

// clientCertIndexEntry is deliberately its own shape rather than
// resourceIndexEntry's: a client certificate's identifying fact is the
// host it covers, and its status is what an agent acts on.
type clientCertIndexEntry struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Host   string `json:"host"`
	Status string `json:"status"`
}
