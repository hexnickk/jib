// Package util provides small shared utility functions.
package util

import (
	"fmt"
	"io"
	"os"
)

// CopyFile copies a file from src to dst, preserving executable permissions
// if the source has them.
func CopyFile(src, dst string) error {
	in, err := os.Open(src) //nolint:gosec // CLI tool reads user-specified files by design
	if err != nil {
		return fmt.Errorf("opening %s: %w", src, err)
	}
	defer func() { _ = in.Close() }()

	info, err := in.Stat()
	if err != nil {
		return fmt.Errorf("stat %s: %w", src, err)
	}

	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, info.Mode()) //nolint:gosec // CLI tool copies user-specified files by design
	if err != nil {
		return fmt.Errorf("creating %s: %w", dst, err)
	}

	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return fmt.Errorf("copying to %s: %w", dst, err)
	}
	return out.Close()
}
