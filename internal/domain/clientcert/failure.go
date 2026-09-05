package clientcert

import (
	"errors"
	"fmt"
	"time"

	"github.com/alicoding/mill/internal/adapters/certmaterial"
	"github.com/alicoding/mill/internal/adapters/httpconnector"
	"github.com/alicoding/mill/internal/domain/usererror"
)

// The sentences a client-certificate failure shows. Each names
// something the person configuring the certificate can change; the
// cause stays wrapped for the log.

const (
	CodeRequired   = "client-cert-required"
	CodeMismatch   = "client-cert-mismatch"
	CodeExpired    = "client-cert-expired"
	CodeLegacyPEM  = "client-cert-legacy-pem"
	CodePassphrase = "client-cert-passphrase"
	CodeUnreadable = "client-cert-unreadable"
	CodeNoKey      = "client-cert-no-key"
)

// ErrLegacyPEM/ErrMismatch/ErrPassphrase/ErrUnreadable are the
// material failures a caller can report without a host in hand.
var (
	ErrLegacyPEM  = usererror.New(CodeLegacyPEM, "This key uses an old encryption Mill doesn't read. Export it as PKCS#8 or PKCS#12.")
	ErrMismatch   = usererror.New(CodeMismatch, "The certificate and key don't match.")
	ErrPassphrase = usererror.New(CodePassphrase, "The passphrase doesn't open this certificate.")
	ErrUnreadable = usererror.New(CodeUnreadable, "This certificate can't be read.")
	// ErrNoKeyChosen is a PEM certificate with no key beside it -- an
	// entity someone has started rather than one that is broken.
	ErrNoKeyChosen = usererror.New(CodeNoKey, "Pick the private key that goes with this certificate.")
)

// DescribeMaterialFailure maps a decoding failure onto its sentence.
func DescribeMaterialFailure(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, certmaterial.ErrLegacyEncryptedPEM):
		return usererror.Wrap(CodeLegacyPEM, ErrLegacyPEM.Message, err)
	case errors.Is(err, certmaterial.ErrMismatch):
		return usererror.Wrap(CodeMismatch, ErrMismatch.Message, err)
	case errors.Is(err, certmaterial.ErrPassphrase):
		return usererror.Wrap(CodePassphrase, ErrPassphrase.Message, err)
	}
	return usererror.Wrap(CodeUnreadable, ErrUnreadable.Message, err)
}

// ExpiredError is the sentence a matched certificate that has run out
// shows, naming the host it was for and the day it stopped working.
func ExpiredError(host string, notAfter time.Time) error {
	return usererror.Wrap(CodeExpired,
		fmt.Sprintf("The certificate for %s expired on %s.", host, notAfter.Format("2 January 2006")),
		fmt.Errorf("client certificate for %q expired at %s", host, notAfter.Format(time.RFC3339)))
}

// DescribeHandshakeFailure reports a Test that could not complete: the
// server refusing the certificate Mill offered gets the same sentence
// a real request would, and anything else stays the transport's own
// error for the log.
func DescribeHandshakeFailure(err error, host string) error {
	if err == nil {
		return nil
	}
	if described := DescribeTransportFailure(err, host); described != err {
		return described
	}
	return usererror.Wrap(CodeUnreadable,
		fmt.Sprintf("Mill couldn't complete a TLS handshake with %s.", host),
		err)
}

// DescribeTransportFailure turns the one transport failure a client
// certificate explains -- the server asking for one Mill did not send
// -- into its sentence, and leaves every other error alone.
func DescribeTransportFailure(err error, host string) error {
	if err == nil || !httpconnector.IsClientCertificateRequired(err) {
		return err
	}
	return usererror.Wrap(CodeRequired,
		fmt.Sprintf("The server asked for a client certificate and none matches %s.", host),
		err)
}
