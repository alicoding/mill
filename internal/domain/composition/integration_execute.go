package composition

import (
	"fmt"

	"github.com/alicoding/mill/internal/adapters/openapispec"
)

// ExecuteOperation performs ONE declared operation of an already
// -configured HTTPRequest for a non-workflow caller (goal 0374: a
// plugin's guarded read/write against a Configure Integration entity)
// through the EXACT SAME execution tail (auth, URL join, JOSE,
// redaction) integration-http and decision-outcome's webhook already
// share via sendHTTPRequest -- never a second HTTP path. path/method
// name one operation the request's own OpenAPISpec declares
// (ConfigureService.ListHTTPRequestOperations is the discovery half);
// values fill that operation's declared input fields the same way
// openapispec.BuildRequest already does for every other caller.
func ExecuteOperation(requestID, path, method string, values map[string]string, run SecretAccessRun) (string, error) {
	rc, err := lookupHTTPRequestFn(requestID, run)
	if err != nil {
		return "", err
	}
	if rc.OpenAPISpec == "" {
		return "", fmt.Errorf("request %q has no OpenAPI spec configured", requestID)
	}
	doc, err := openapispec.Parse([]byte(rc.OpenAPISpec))
	if err != nil {
		return "", err
	}
	op, err := doc.Operation(path, method)
	if err != nil {
		return "", err
	}
	resolvedPath, query, headers, body, err := openapispec.BuildRequest(path, op, values)
	if err != nil {
		return "", err
	}
	return sendHTTPRequest(rc, method, resolvedPath, body, headers, query, nil, run)
}
