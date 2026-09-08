package composition

import (
	"fmt"
	"strconv"

	"github.com/alicoding/mill/internal/domain/guardrail"
)

// RespondWebhookNodeTypeID is the respond step's registered id (goal
// 0373). "apply-" prefixed to satisfy nodetypes_test.go's Kind-prefix
// rule for KindApply -- idPrefixExceptions is a closed list that must
// never grow, so the bare "respond-webhook" id a design document may
// call it by cannot be the real registered id.
const RespondWebhookNodeTypeID = "apply-respond-webhook"

// WebhookResponder is how a respond-webhook node delivers its run's
// reply to whichever HTTP request the webhook ingress is holding open
// for it -- an interface so this domain package never imports the
// bridge/trigger HTTP plumbing on the other side of that seam
// (.claude/rules/backend.md). delivered is false when an earlier step
// in the SAME run already replied (first-wins, matching n8n's own
// "second Respond node is ignored" semantics); repliedBy then names
// that earlier step so the caller can record which one.
type WebhookResponder interface {
	Reply(stepID string, status int, contentType, body string) (delivered bool, repliedBy string)
}

const (
	defaultRespondStatus      = 200
	defaultRespondContentType = "application/json"
	// webhookReplyPreviewCap bounds what the run's own Record keeps of
	// a delivered reply body -- a diagnostic preview, never the whole
	// thing (goal 0373 design contract item 2).
	webhookReplyPreviewCap = 1024
)

func init() {
	RegisterNodeType(NodeType{
		ID: RespondWebhookNodeTypeID, Kind: KindApply,
		Label: "Answer the webhook",
		// ClassLocal: writes to an HTTP response Mill already holds
		// open -- no external effect of its own.
		Effect:       guardrail.ClassLocal,
		PaletteGroup: PaletteGroupApply,
		Complexity:   ComplexityBasic,
		Consumes:     []PayloadKind{PayloadNone},
		Produces:     PayloadProduce{Passthrough: true},
		Output:       "payload unchanged; the webhook's caller receives this step's status/body once",
		Description:  "Sends this run's reply to the tool that fired the webhook.",
		ConfigFields: []ConfigField{
			{
				Key: "status", Label: "Status code", Type: FieldNumber,
				Default:     strconv.Itoa(defaultRespondStatus),
				Description: "The HTTP status code the caller receives.",
			},
			{
				Key: "body", Label: "Reply body", Type: FieldText, Multiline: true,
				Description: "Usually JSON in the calling tool's own schema.",
			},
			{
				Key: "contentType", Label: "Content type", Type: FieldText,
				Default:     defaultRespondContentType,
				Description: "The reply's Content-Type header.",
			},
		},
	}, execRespondWebhook)
}

func execRespondWebhook(node Node, ctx ExecContext) (ExecContext, error) {
	status := defaultRespondStatus
	if raw := node.Config["status"]; raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			status = n
		}
	}
	contentType := node.Config["contentType"]
	if contentType == "" {
		contentType = defaultRespondContentType
	}
	// {{name}} against this run's own Attributes -- the same grammar
	// Environment variables already use (interpolate.go), so a reply
	// body composes from whatever the trigger/upstream steps captured
	// without a second templating syntax to learn.
	body, _ := Interpolate(node.Config["body"], stringAttrs(ctx.Attributes))

	if ctx.Responder == nil {
		ctx.Attributes["webhookReplyNote"] = "No caller to answer."
		return ctx, nil
	}
	delivered, repliedBy := ctx.Responder.Reply(ctx.CurrentStepID, status, contentType, body)
	if !delivered {
		ctx.Attributes["webhookReplyNote"] = fmt.Sprintf("Reply already sent by step %s.", repliedBy)
		return ctx, nil
	}

	preview := body
	if len(preview) > webhookReplyPreviewCap {
		preview = preview[:webhookReplyPreviewCap]
	}
	ctx.Attributes["webhookReply"] = map[string]any{
		"status":    status,
		"bodyBytes": preview,
		"stepID":    ctx.CurrentStepID,
	}
	return ctx, nil
}
