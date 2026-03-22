package state

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

// ErrLockBusy is returned when a non-blocking lock acquisition fails because
// the lock is already held by another process.
var ErrLockBusy = errors.New("lock is held by another process")

// DefaultLockDir returns the default directory for lock files.
func DefaultLockDir() string {
	return "/opt/jib/locks"
}

// Lock represents a held file lock.
type Lock struct {
	file *os.File
}

// Acquire acquires an exclusive flock on a per-app lock file. If blocking is
// true, it retries until the lock is acquired or timeout elapses. If blocking
// is false (e.g. for autodeploy), it returns ErrLockBusy immediately if the
// lock cannot be acquired.
func Acquire(app string, dir string, blocking bool, timeout time.Duration) (*Lock, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("creating lock directory: %w", err)
	}

	path := filepath.Join(dir, app+".lock")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, fmt.Errorf("opening lock file %s: %w", path, err)
	}

	if !blocking {
		err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err != nil {
			f.Close()
			if errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN) {
				return nil, ErrLockBusy
			}
			return nil, fmt.Errorf("flock %s: %w", path, err)
		}
		return &Lock{file: f}, nil
	}

	// Blocking mode: use a goroutine with blocking flock + timeout.
	type result struct {
		err error
	}
	ch := make(chan result, 1)
	go func() {
		ch <- result{err: syscall.Flock(int(f.Fd()), syscall.LOCK_EX)}
	}()

	select {
	case r := <-ch:
		if r.err != nil {
			f.Close()
			return nil, fmt.Errorf("flock %s: %w", path, r.err)
		}
		return &Lock{file: f}, nil
	case <-time.After(timeout):
		// The goroutine is still blocked on flock. We can't cancel it,
		// but closing the file will cause it to fail.
		f.Close()
		return nil, fmt.Errorf("timed out waiting for lock on %s", app)
	}
}

// Release releases the file lock and closes the underlying file.
func (l *Lock) Release() error {
	if l.file == nil {
		return nil
	}
	if err := syscall.Flock(int(l.file.Fd()), syscall.LOCK_UN); err != nil {
		l.file.Close()
		return fmt.Errorf("releasing flock: %w", err)
	}
	return l.file.Close()
}
