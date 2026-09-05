# Client certificates

Some servers ask the caller to prove who it is with a certificate, not
just a token. Mill holds those certificates in **Configure ›
Certificates**, one per host, and presents the right one automatically
on every request it makes to that host.

Nothing about a client certificate lives on an individual request. You
name a host once; every integration, every workflow step and every
agent-driven call to that host uses it.

## Add one

1. Open **Configure › Certificates** and choose **New certificate**.
2. Give it a **Label** you will recognise in a list.
3. Set the **Host**. Either an exact host, `api.example.com`, or a
   wildcard covering one level of subdomain, `*.example.com`. Add a
   port when the server uses a non-standard one: `api.example.com:8443`.
4. Pick the **Certificate**, and the **Private key** beside it.

Both fields are pickers over your secret store, not file paths. If the
certificate is not stored yet, **Add** beside the picker opens the
store's own entry form without leaving the page.

Under **Advanced** there are two more fields, both optional: a
**Passphrase** for an encrypted key or bundle, and a **CA certificate**
for a server that presents a private root. The CA you add here is used
*alongside* the authorities your computer already trusts, never instead
of them.

## Which certificate a request uses

Mill picks the most specific host that matches:

- An exact host beats a wildcard.
- A longer wildcard suffix beats a shorter one, so `*.pay.example.com`
  wins over `*.example.com`.
- An entry naming a port only matches that port.

If nothing matches, the request goes out with no client certificate. A
server that wanted one then refuses the connection, and Mill says which
host had no match.

## Formats Mill reads

- A **PEM** certificate (or a chain, leaf first) beside a **PEM key**.
  The key may be PKCS#8, PKCS#1 or SEC 1, encrypted or not.
- A **PKCS#12 / PFX bundle**, which carries its own key. Pick it in the
  Certificate field and the Private key field disappears: the bundle
  already has one. Put the bundle's passphrase in the Passphrase field.

One format is refused on purpose: a PEM key encrypted the old way, with
a `Proc-Type: 4,ENCRYPTED` header. Its protection is not sound, and Mill
tells you to export the key as PKCS#8 or PKCS#12 instead. From OpenSSL,
`openssl pkcs8 -topk8 -in old.key -out new.key` does it.

## Reading the list

Each row shows its host and a status:

- **Ready** — the certificate works and is not near its end.
- **Expires in N days** — inside the last 30 days of validity.
- **Expired** — past its end date, or not yet started. Requests to that
  host fail until you replace it.
- **Needs a certificate and key** — you have not finished setting it up.
- **Can't read the certificate** — the material is named but cannot be
  opened. Unlock your secret store first; if it stays, the passphrase
  or the entry is wrong.

Only the certificate's subject, issuer and dates are read to build this.
The certificate and key themselves are never shown, copied or logged,
and each time Mill reads one it records the read in the secret audit
trail.

## Test a host

Open a certificate and choose **Test**. Mill opens a TLS connection to
the host, completes the handshake, and closes it without sending a
request. It reports either that the handshake succeeded or what stopped
it. A wildcard host names a family rather than one machine, so Test is
unavailable there.

## On a request

An integration's **Auth** section says which certificate its base URL's
host already has, or that the host has none and offers **Add one**,
which starts a new certificate with the host filled in. It is a
statement about the host, not a setting on the request.
