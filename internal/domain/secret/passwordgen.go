package secret

import (
	"crypto/rand"
	"fmt"
	"math/big"
)

// GenerateOptions picks which character classes a generated password may
// draw from -- the same knob set KeePassXC's own generator exposes.
// Every field false is invalid (Generate rejects it): a password with no
// allowed character class can't be generated at all.
type GenerateOptions struct {
	Length  int
	Upper   bool
	Lower   bool
	Digits  bool
	Symbols bool
}

const (
	upperChars   = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	lowerChars   = "abcdefghijklmnopqrstuvwxyz"
	digitChars   = "0123456789"
	symbolChars  = "!@#$%^&*()-_=+[]{};:,.<>?"
	minLength    = 4
	maxLength    = 128
	defaultLenth = 20
)

// DefaultGenerateOptions mirrors KeePassXC's own shipped default: 20
// characters, upper/lower/digits on, symbols off (symbols are the class
// most likely to break a site's own password-field validation, so
// off-by-default is the safer starting point).
func DefaultGenerateOptions() GenerateOptions {
	return GenerateOptions{Length: defaultLenth, Upper: true, Lower: true, Digits: true}
}

// Generate returns a CSPRNG-drawn password from opts' allowed character
// classes -- crypto/rand is stdlib, so this is "compose," not "adopt a
// library," per the goal's capability map ("the hard part (CSPRNG) is
// stdlib; no library worth a dependency").
func Generate(opts GenerateOptions) (string, error) {
	if opts.Length < minLength || opts.Length > maxLength {
		return "", fmt.Errorf("password length must be between %d and %d characters", minLength, maxLength)
	}
	var charset string
	if opts.Upper {
		charset += upperChars
	}
	if opts.Lower {
		charset += lowerChars
	}
	if opts.Digits {
		charset += digitChars
	}
	if opts.Symbols {
		charset += symbolChars
	}
	if charset == "" {
		return "", fmt.Errorf("at least one character class must be enabled")
	}

	out := make([]byte, opts.Length)
	max := big.NewInt(int64(len(charset)))
	for i := range out {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", fmt.Errorf("generating password: %w", err)
		}
		out[i] = charset[n.Int64()]
	}
	return string(out), nil
}
