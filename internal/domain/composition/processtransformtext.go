package composition

import (
	"crypto/md5"  // #nosec G501 -- offered as a user-chosen text operation (legacy checksums), never for security
	"crypto/sha1" // #nosec G505 -- same: a user-chosen checksum operation
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/url"
	"strings"

	"github.com/google/uuid"
)

// transformOperations is the closed vocabulary the Transform text step
// offers, in the order the picker lists them. Hashes are one-way by
// nature; the decode operations pair with their encoders.
var transformOperations = []string{
	"sha256", "sha1", "md5",
	"base64-encode", "base64-decode",
	"url-encode", "url-decode",
	"hex-encode", "hex-decode",
	"uuid", "trim", "upper", "lower",
}

func init() {
	RegisterNodeType(NodeType{
		ID: "process-transform-text", Kind: KindProcess,
		Label:       "Transform text",
		Complexity:  ComplexityBasic,
		Consumes:    []PayloadKind{PayloadText, PayloadHTML},
		Produces:    PayloadProduce{Kind: PayloadText},
		Output:      "the transformed text",
		Description: "Hashes or encodes the payload -- SHA-256, base64, URL encoding and more. Hashes are one-way; decoding applies to base64, URL, and hex.",
		ConfigFields: []ConfigField{
			{
				Key: "operation", Label: "Operation",
				Description: "What to do with the text.",
				Default:     "sha256",
				Type:        FieldOptions,
				Options:     transformOperations,
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		out, err := transformText(node.Config["operation"], ctx.Payload)
		if err != nil {
			return ctx, err
		}
		ctx.Payload = out
		if ctx.Attributes == nil {
			ctx.Attributes = map[string]any{}
		}
		ctx.Attributes["transform"] = node.Config["operation"]
		return ctx, nil
	})
}

// transformText applies one named operation to text. Exported for the
// step's own tests through the exec path; pure, so every operation is
// checked against known vectors.
func transformText(operation, text string) (string, error) {
	switch operation {
	case "sha256":
		sum := sha256.Sum256([]byte(text))
		return hex.EncodeToString(sum[:]), nil
	case "sha1":
		sum := sha1.Sum([]byte(text)) // #nosec G401 -- user-chosen checksum operation
		return hex.EncodeToString(sum[:]), nil
	case "md5":
		sum := md5.Sum([]byte(text)) // #nosec G401 -- user-chosen checksum operation
		return hex.EncodeToString(sum[:]), nil
	case "base64-encode":
		return base64.StdEncoding.EncodeToString([]byte(text)), nil
	case "base64-decode":
		b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(text))
		if err != nil {
			return "", fmt.Errorf("transform text: base64-decode: %w", err)
		}
		return string(b), nil
	case "url-encode":
		return url.QueryEscape(text), nil
	case "url-decode":
		s, err := url.QueryUnescape(text)
		if err != nil {
			return "", fmt.Errorf("transform text: url-decode: %w", err)
		}
		return s, nil
	case "hex-encode":
		return hex.EncodeToString([]byte(text)), nil
	case "hex-decode":
		b, err := hex.DecodeString(strings.TrimSpace(text))
		if err != nil {
			return "", fmt.Errorf("transform text: hex-decode: %w", err)
		}
		return string(b), nil
	case "uuid":
		return uuid.NewString(), nil
	case "trim":
		return strings.TrimSpace(text), nil
	case "upper":
		return strings.ToUpper(text), nil
	case "lower":
		return strings.ToLower(text), nil
	default:
		return "", fmt.Errorf("transform text: unknown operation %q", operation)
	}
}
