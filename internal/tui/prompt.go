// Package tui provides interactive terminal prompts with automatic
// fallback to errors in non-interactive (piped/scripted) contexts.
package tui

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"golang.org/x/term"
)

// IsInteractive returns true if stdin is a terminal (not piped or scripted).
func IsInteractive() bool {
	return term.IsTerminal(int(os.Stdin.Fd())) //nolint:gosec // uintptr->int is safe for file descriptors
}

// PromptString asks the user for a string value. In non-interactive mode,
// returns an error indicating the flag is required.
func PromptString(flag, description string) (string, error) {
	if !IsInteractive() {
		return "", fmt.Errorf("--%s is required", flag)
	}
	fmt.Printf("%s: ", description)
	scanner := bufio.NewScanner(os.Stdin)
	if !scanner.Scan() {
		return "", fmt.Errorf("no input received for %s", flag)
	}
	val := strings.TrimSpace(scanner.Text())
	if val == "" {
		return "", fmt.Errorf("%s cannot be empty", flag)
	}
	return val, nil
}

// PromptInt64 asks the user for an int64 value.
func PromptInt64(flag, description string) (int64, error) {
	s, err := PromptString(flag, description)
	if err != nil {
		return 0, err
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid number for %s: %w", flag, err)
	}
	return n, nil
}

// PromptPassword reads a value without echoing it to the terminal.
// In non-interactive mode, returns an error.
func PromptPassword(flag, description string) (string, error) {
	if !IsInteractive() {
		return "", fmt.Errorf("--%s is required", flag)
	}
	fmt.Printf("%s: ", description)
	val, err := term.ReadPassword(int(os.Stdin.Fd())) //nolint:gosec // uintptr->int is safe for file descriptors
	fmt.Println()                                     // newline after hidden input
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", flag, err)
	}
	s := strings.TrimSpace(string(val))
	if s == "" {
		return "", fmt.Errorf("%s cannot be empty", flag)
	}
	return s, nil
}

// PromptMultiline reads multiple lines until EOF (Ctrl+D).
// In non-interactive mode, returns an error.
func PromptMultiline(flag, description string) (string, error) {
	if !IsInteractive() {
		return "", fmt.Errorf("--%s is required", flag)
	}
	fmt.Printf("%s (then press Ctrl+D):\n", description)
	data, err := io.ReadAll(os.Stdin)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", flag, err)
	}
	s := strings.TrimSpace(string(data))
	if s == "" {
		return "", fmt.Errorf("%s cannot be empty", flag)
	}
	return s, nil
}
