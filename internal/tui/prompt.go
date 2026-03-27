// Package tui provides interactive terminal prompts with automatic
// fallback to errors in non-interactive (piped/scripted) contexts.
package tui

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/charmbracelet/huh"
	"golang.org/x/term"
)

// IsInteractive returns true if stdin is a terminal (not piped or scripted).
func IsInteractive() bool {
	return term.IsTerminal(int(os.Stdin.Fd())) //nolint:gosec // uintptr->int is safe for file descriptors
}

func requireInteractive(flag string) error {
	if !IsInteractive() {
		return fmt.Errorf("--%s is required", flag)
	}
	return nil
}

// PromptString asks the user for a string value. In non-interactive mode,
// returns an error indicating the flag is required.
func PromptString(flag, description string) (string, error) {
	if err := requireInteractive(flag); err != nil {
		return "", err
	}
	var val string
	err := huh.NewInput().
		Title(description).
		Value(&val).
		Validate(func(s string) error {
			if strings.TrimSpace(s) == "" {
				return fmt.Errorf("%s cannot be empty", flag)
			}
			return nil
		}).
		Run()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(val), nil
}

// PromptStringOptional is like PromptString but allows empty input.
// In non-interactive mode, returns an empty string (no error).
func PromptStringOptional(description string) (string, error) {
	if !IsInteractive() {
		return "", nil
	}
	var val string
	err := huh.NewInput().
		Title(description).
		Value(&val).
		Run()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(val), nil
}

// PromptInt64 asks the user for an int64 value.
func PromptInt64(flag, description string) (int64, error) {
	if err := requireInteractive(flag); err != nil {
		return 0, err
	}
	var val string
	err := huh.NewInput().
		Title(description).
		Value(&val).
		Validate(func(s string) error {
			s = strings.TrimSpace(s)
			if s == "" {
				return fmt.Errorf("%s cannot be empty", flag)
			}
			if _, err := strconv.ParseInt(s, 10, 64); err != nil {
				return fmt.Errorf("must be a valid number")
			}
			return nil
		}).
		Run()
	if err != nil {
		return 0, err
	}
	n, _ := strconv.ParseInt(strings.TrimSpace(val), 10, 64)
	return n, nil
}

// PromptPassword reads a value without echoing it to the terminal.
// In non-interactive mode, returns an error.
func PromptPassword(flag, description string) (string, error) {
	if err := requireInteractive(flag); err != nil {
		return "", err
	}
	var val string
	err := huh.NewInput().
		Title(description).
		EchoMode(huh.EchoModePassword).
		Value(&val).
		Validate(func(s string) error {
			if strings.TrimSpace(s) == "" {
				return fmt.Errorf("%s cannot be empty", flag)
			}
			return nil
		}).
		Run()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(val), nil
}

// PromptPEM reads a PEM-encoded block. Uses a text area; validates that the
// content contains proper PEM BEGIN/END markers.
// In non-interactive mode, returns an error.
func PromptPEM(flag, description string) (string, error) {
	if err := requireInteractive(flag); err != nil {
		return "", err
	}
	var val string
	err := huh.NewText().
		Title(description).
		Value(&val).
		Validate(func(s string) error {
			s = strings.TrimSpace(s)
			if s == "" {
				return fmt.Errorf("%s cannot be empty", flag)
			}
			if !strings.Contains(s, "-----BEGIN ") || !strings.Contains(s, "-----END ") {
				return fmt.Errorf("does not look like a valid PEM block")
			}
			return nil
		}).
		Run()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(val), nil
}

// PromptConfirm asks a yes/no question. defaultYes controls the default selection.
// In non-interactive mode, returns an error.
func PromptConfirm(description string, defaultYes bool) (bool, error) {
	if !IsInteractive() {
		return false, fmt.Errorf("confirmation required (run interactively)")
	}
	val := defaultYes
	err := huh.NewConfirm().
		Title(description).
		Affirmative("Yes").
		Negative("No").
		Value(&val).
		Run()
	if err != nil {
		return false, err
	}
	return val, nil
}

// SelectOption represents a single option in a select prompt.
type SelectOption struct {
	Label string
	Value string
}

// PromptSelect presents a list of options and returns the selected value.
// In non-interactive mode, returns an error.
func PromptSelect(description string, options []SelectOption) (string, error) {
	if !IsInteractive() {
		return "", fmt.Errorf("selection required (run interactively)")
	}
	opts := make([]huh.Option[string], len(options))
	for i, o := range options {
		opts[i] = huh.NewOption(o.Label, o.Value)
	}
	var val string
	err := huh.NewSelect[string]().
		Title(description).
		Options(opts...).
		Value(&val).
		Run()
	if err != nil {
		return "", err
	}
	return val, nil
}

// PromptContinue pauses until the user confirms.
// In non-interactive mode, returns nil (no-op).
func PromptContinue(description string) error {
	if !IsInteractive() {
		return nil
	}
	var confirmed bool
	return huh.NewConfirm().
		Title(description).
		Affirmative("OK").
		Negative("Cancel").
		Value(&confirmed).
		Run()
}
