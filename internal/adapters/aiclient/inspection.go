package aiclient

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/alicoding/mill/internal/adapters/httpconnector"
)

const (
	inspectionBodyLimit  = 1 << 20
	inspectionModelLimit = 1000
)

type InspectionRequest struct {
	Kind    Kind
	BaseURL string
	Model   string
	APIKey  string
	Context context.Context
}

type InspectionResult struct {
	Endpoint          string
	Transport         string
	Inspection        string
	Authentication    string
	Models            []string
	InventoryComplete bool
	SelectedFound     *bool
	ReasonCodes       []string
}

type modelListItem struct {
	ID string `json:"id"`
}

type compatibleModelList struct {
	Data *[]modelListItem `json:"data"`
}

type anthropicModelList struct {
	Data    *[]modelListItem `json:"data"`
	FirstID string           `json:"first_id"`
	LastID  string           `json:"last_id"`
	HasMore bool             `json:"has_more"`
}

// InspectionEndpoint returns the sanitized metadata endpoint without making a
// request. Configure uses it in the approval prompt before any secret read.
func InspectionEndpoint(kind Kind, configured string) (string, error) {
	endpoint, err := inspectionEndpoint(kind, configured)
	if err != nil {
		return "", err
	}
	return endpoint.String(), nil
}

func Inspect(req InspectionRequest) (InspectionResult, error) {
	endpoint, err := inspectionEndpoint(req.Kind, req.BaseURL)
	if err != nil {
		return InspectionResult{
			Transport: "invalid-configuration", Inspection: "failed", Authentication: "unknown",
			ReasonCodes: []string{"invalid-endpoint"},
		}, nil
	}
	result := InspectionResult{Endpoint: endpoint.String(), Transport: "unchecked", Inspection: "not-checked", Authentication: "unknown"}
	resp, err := inspectGET(req, endpoint)
	if err != nil {
		return inspectionTransportFailure(result, err)
	}
	if resp.StatusCode != http.StatusOK {
		return inspectionHTTPFailure(result, resp.StatusCode), nil
	}

	switch req.Kind {
	case KindOpenAICompat:
		return inspectCompatibleResponse(req, result, resp.Body), nil
	case KindAnthropic:
		return inspectAnthropicResponse(req, endpoint, result, resp.Body)
	default:
		return InspectionResult{
			Transport: "invalid-configuration", Inspection: "failed", Authentication: "unknown",
			ReasonCodes: []string{"unknown-provider-kind"},
		}, nil
	}
}

func inspectCompatibleResponse(req InspectionRequest, result InspectionResult, body string) InspectionResult {
	var payload compatibleModelList
	if err := decodeInspectionJSON(body, &payload); err != nil || payload.Data == nil {
		return malformedInspection(result)
	}
	allModels, valid := modelIDs(*payload.Data)
	if !valid {
		return malformedInspection(result)
	}
	result.Models = boundedStrings(allModels)
	result.InventoryComplete = len(*payload.Data) <= inspectionModelLimit
	switch {
	case containsModel(allModels, req.Model):
		result.SelectedFound = boolPointer(true)
	case !result.InventoryComplete:
		result.ReasonCodes = append(result.ReasonCodes, "metadata-inventory-incomplete")
	default:
		result.SelectedFound = boolPointer(false)
		result.ReasonCodes = append(result.ReasonCodes, "selected-model-not-listed")
	}
	return successfulInspection(result, req.APIKey != "")
}

func inspectAnthropicResponse(req InspectionRequest, endpoint *url.URL, result InspectionResult, body string) (InspectionResult, error) {
	var payload anthropicModelList
	if err := decodeInspectionJSON(body, &payload); err != nil || payload.Data == nil {
		return malformedInspection(result), nil
	}
	allModels, valid := modelIDs(*payload.Data)
	if !valid {
		return malformedInspection(result), nil
	}
	result.Models = boundedStrings(allModels)
	result.InventoryComplete = !payload.HasMore && len(*payload.Data) <= inspectionModelLimit
	if containsModel(allModels, req.Model) {
		result.SelectedFound = boolPointer(true)
	} else {
		var err error
		result, err = retrieveAnthropicModel(req, endpoint, result)
		if err != nil || result.Inspection == "failed" {
			return result, err
		}
	}
	return successfulInspection(result, req.APIKey != ""), nil
}

func inspectionEndpoint(kind Kind, configured string) (*url.URL, error) {
	base := configured
	if kind == KindAnthropic && strings.TrimSpace(base) == "" {
		base = defaultAnthropicBaseURL
	}
	if kind != KindOpenAICompat && kind != KindAnthropic {
		return nil, fmt.Errorf("unknown provider kind %q", kind)
	}
	u, err := url.Parse(strings.TrimRight(base, "/") + "/v1/models")
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, errors.New("invalid provider endpoint")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, errors.New("provider endpoint must use http or https")
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("provider endpoint must not contain credentials, a query, or a fragment")
	}
	u.Host = strings.ToLower(u.Host)
	return u, nil
}

func inspectGET(req InspectionRequest, endpoint *url.URL) (httpconnector.Response, error) {
	headers := map[string]string{"Accept": "application/json"}
	if req.Kind == KindAnthropic {
		headers["anthropic-version"] = anthropicVersion
		if req.APIKey != "" {
			headers["x-api-key"] = req.APIKey
		}
	} else if req.APIKey != "" {
		headers["Authorization"] = "Bearer " + req.APIKey
	}
	ctx := req.Context
	if ctx == nil {
		ctx = context.Background()
	}
	requestURL := *endpoint
	if req.Kind == KindAnthropic && strings.HasSuffix(requestURL.Path, "/v1/models") {
		query := requestURL.Query()
		query.Set("limit", "1000")
		requestURL.RawQuery = query.Encode()
	}
	return httpconnector.ExecuteConfined(httpconnector.Request{
		Method: http.MethodGet, URL: requestURL.String(), Headers: headers, Context: ctx,
		NoRedirect: true, ReturnLastResponse: true,
	}, func(host string) bool { return host == endpoint.Host }, inspectionBodyLimit)
}

func inspectionTransportFailure(result InspectionResult, err error) (InspectionResult, error) {
	switch {
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return result, err
	case errors.Is(err, httpconnector.ErrResponseTooLarge):
		result.Transport = "responded"
		result.Inspection = "failed"
		result.ReasonCodes = []string{"metadata-response-too-large"}
		return result, nil
	default:
		result.Transport = "unreachable"
		result.Inspection = "failed"
		result.ReasonCodes = []string{"provider-unreachable"}
		return result, nil
	}
}

func inspectionHTTPFailure(result InspectionResult, status int) InspectionResult {
	result.Transport = "responded"
	result.Inspection = "failed"
	switch {
	case status == http.StatusNotFound || status == http.StatusMethodNotAllowed:
		result.Inspection = "unsupported"
		result.ReasonCodes = []string{"metadata-api-unsupported"}
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		result.Authentication = "rejected"
		result.ReasonCodes = []string{"metadata-auth-rejected"}
	case status == http.StatusTooManyRequests:
		result.ReasonCodes = []string{"metadata-rate-limited"}
	case status >= 300 && status < 400:
		result.ReasonCodes = []string{"metadata-redirect-refused"}
	case status >= 500:
		result.ReasonCodes = []string{"metadata-service-failed"}
	default:
		result.ReasonCodes = []string{"metadata-http-failed"}
	}
	return result
}

func successfulInspection(result InspectionResult, keyUsed bool) InspectionResult {
	result.Transport = "responded"
	result.Inspection = "available"
	if keyUsed {
		result.Authentication = "metadata-authorized"
	} else {
		result.Authentication = "not-required"
	}
	result.ReasonCodes = append(result.ReasonCodes, "metadata-available")
	return result
}

func malformedInspection(result InspectionResult) InspectionResult {
	result.Transport = "responded"
	result.Inspection = "failed"
	result.ReasonCodes = []string{"metadata-response-malformed"}
	return result
}

func retrieveAnthropicModel(req InspectionRequest, listEndpoint *url.URL, result InspectionResult) (InspectionResult, error) {
	retrieveURL := *listEndpoint
	basePath := strings.TrimRight(retrieveURL.Path, "/")
	baseRawPath := strings.TrimRight(retrieveURL.EscapedPath(), "/")
	retrieveURL.Path = basePath + "/" + req.Model
	retrieveURL.RawPath = baseRawPath + "/" + url.PathEscape(req.Model)
	resp, err := inspectGET(req, &retrieveURL)
	if err != nil {
		failed, transportErr := inspectionTransportFailure(result, err)
		if transportErr != nil {
			return failed, transportErr
		}
		return failed, nil
	}
	switch resp.StatusCode {
	case http.StatusOK:
		var model modelListItem
		if err := decodeInspectionJSON(resp.Body, &model); err != nil || strings.TrimSpace(model.ID) == "" {
			return malformedInspection(result), nil
		}
		result.SelectedFound = boolPointer(true)
		if !containsModel(result.Models, model.ID) && len(result.Models) < inspectionModelLimit {
			result.Models = append(result.Models, model.ID)
		}
		return result, nil
	case http.StatusNotFound:
		result.SelectedFound = boolPointer(false)
		result.ReasonCodes = append(result.ReasonCodes, "selected-model-missing")
		return result, nil
	case http.StatusMethodNotAllowed:
		if result.InventoryComplete {
			result.ReasonCodes = append(result.ReasonCodes, "selected-model-unverified")
		} else {
			result.ReasonCodes = append(result.ReasonCodes, "metadata-inventory-incomplete")
		}
		return result, nil
	default:
		return inspectionHTTPFailure(result, resp.StatusCode), nil
	}
}

func decodeInspectionJSON(body string, dst any) error {
	decoder := json.NewDecoder(strings.NewReader(body))
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("response has trailing JSON")
	}
	return nil
}

func modelIDs(items []modelListItem) ([]string, bool) {
	out := make([]string, 0, len(items))
	seen := make(map[string]bool, len(items))
	for _, item := range items {
		if strings.TrimSpace(item.ID) == "" {
			return nil, false
		}
		if seen[item.ID] {
			continue
		}
		seen[item.ID] = true
		out = append(out, item.ID)
	}
	return out, true
}

func boundedStrings(values []string) []string {
	if len(values) <= inspectionModelLimit {
		return values
	}
	return values[:inspectionModelLimit]
}

func containsModel(models []string, selected string) bool {
	for _, model := range models {
		if model == selected {
			return true
		}
	}
	return false
}

func boolPointer(value bool) *bool { return &value }
