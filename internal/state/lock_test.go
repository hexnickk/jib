package state

import (
	"errors"
	"sync"
	"testing"
	"time"
)

func TestAcquireAndRelease(t *testing.T) {
	dir := t.TempDir()

	lock, err := Acquire("testapp", dir, false, 0)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	if err := lock.Release(); err != nil {
		t.Fatalf("Release: %v", err)
	}
}

func TestNonBlockingReturnsBusy(t *testing.T) {
	dir := t.TempDir()

	lock1, err := Acquire("testapp", dir, false, 0)
	if err != nil {
		t.Fatalf("first Acquire: %v", err)
	}
	defer func() { _ = lock1.Release() }()

	_, err = Acquire("testapp", dir, false, 0)
	if !errors.Is(err, ErrLockBusy) {
		t.Fatalf("expected ErrLockBusy, got %v", err)
	}
}

func TestBlockingWaitsAndSucceeds(t *testing.T) {
	dir := t.TempDir()

	lock1, err := Acquire("testapp", dir, false, 0)
	if err != nil {
		t.Fatalf("first Acquire: %v", err)
	}

	var wg sync.WaitGroup
	var lock2 *Lock
	var lock2Err error

	wg.Add(1)
	go func() {
		defer wg.Done()
		lock2, lock2Err = Acquire("testapp", dir, true, 2*time.Second)
	}()

	// Release the first lock after a short delay so the goroutine can acquire it.
	time.Sleep(200 * time.Millisecond)
	if err := lock1.Release(); err != nil {
		t.Fatalf("Release lock1: %v", err)
	}

	wg.Wait()

	if lock2Err != nil {
		t.Fatalf("blocking Acquire failed: %v", lock2Err)
	}
	if lock2 == nil {
		t.Fatal("lock2 is nil")
	}
	if err := lock2.Release(); err != nil {
		t.Fatalf("Release lock2: %v", err)
	}
}

func TestBlockingTimeout(t *testing.T) {
	dir := t.TempDir()

	lock1, err := Acquire("testapp", dir, false, 0)
	if err != nil {
		t.Fatalf("first Acquire: %v", err)
	}
	defer func() { _ = lock1.Release() }()

	_, err = Acquire("testapp", dir, true, 200*time.Millisecond)
	if err == nil {
		t.Fatal("expected timeout error, got nil")
	}
}
