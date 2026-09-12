package aiclient

import (
	"bytes"
	"errors"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

var (
	// ErrInvalidSchema reports that a requested structured-output schema
	// could not be decoded or compiled without exposing its contents.
	ErrInvalidSchema = errors.New("aiclient: invalid structured-output schema")
	// ErrInvalidStructuredResult reports that a provider result does not
	// satisfy the exact schema supplied with the request.
	ErrInvalidStructuredResult = errors.New("aiclient: invalid structured result")
)

const structuredSchemaResourceURL = "https://mill.invalid/aiclient/structured-output-schema.json"

type refusingSchemaLoader struct{}

func (refusingSchemaLoader) Load(string) (any, error) {
	return nil, errors.New("external schema resources are disabled")
}

type structuredResultValidator struct {
	schema *jsonschema.Schema
}

func compileStructuredResultValidator(raw []byte) (*structuredResultValidator, error) {
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return nil, ErrInvalidSchema
	}

	compiler := jsonschema.NewCompiler()
	compiler.UseLoader(refusingSchemaLoader{})
	if err := compiler.AddResource(structuredSchemaResourceURL, doc); err != nil {
		return nil, ErrInvalidSchema
	}
	schema, err := compiler.Compile(structuredSchemaResourceURL)
	if err != nil {
		return nil, ErrInvalidSchema
	}
	return &structuredResultValidator{schema: schema}, nil
}

func (v *structuredResultValidator) validate(raw []byte) error {
	value, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return ErrInvalidStructuredResult
	}
	if err := v.schema.Validate(value); err != nil {
		return ErrInvalidStructuredResult
	}
	return nil
}
