package usererror

import (
	"encoding/json"
	"log/slog"
)

// MarshalForWails is the error marshaller every bound service is
// registered with (application.ServiceOptions.MarshalError). It decides
// the ONE thing the frontend receives about a failure:
//
//   - a *Error anywhere in the chain marshals to its code and sentence;
//   - anything else is logged with its full chain and reaches the
//     frontend as CodeUnexpected, so an internal chain can never become
//     UI copy.
//
// The application-level Options.MarshalError is NOT a substitute: in
// Wails v3.0.0-beta.12 it only reaches Bindings.marshalError, which no
// call path reads, while BoundMethod.Call marshals through the
// per-service marshaller (pkg/application/bindings.go, Add and Call).
// A nil return would fall back to the library default, which marshals a
// plain error to "{}"; this never returns nil.
func MarshalForWails(logger *slog.Logger) func(error) []byte {
	generic, err := json.Marshal(&Error{Code: CodeUnexpected, Message: UnexpectedMessage})
	if err != nil {
		panic("usererror: the generic boundary error does not marshal: " + err.Error())
	}
	return func(boundary error) []byte {
		if boundary == nil {
			return generic
		}
		if userErr, ok := Of(boundary); ok {
			encoded, marshalErr := json.Marshal(userErr)
			if marshalErr == nil {
				return encoded
			}
		}
		if logger != nil {
			logger.Warn("unhandled error at the boundary", "error", boundary)
		}
		return generic
	}
}
