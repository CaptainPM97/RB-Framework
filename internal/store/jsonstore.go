// Package store implements JSON-file-backed persistence, mirroring the
// data shapes of the original PHP app's data/*.json files. A single Go
// process replaces PHP's LOCK_EX (needed against concurrent Apache
// workers) with a per-file mutex, plus atomic temp-file+rename writes.
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type fileGuard struct {
	mu   sync.RWMutex
	path string
}

func newFileGuard(path string) *fileGuard {
	return &fileGuard{path: path}
}

// read unmarshals the file into v. A missing file is not an error; v is
// left at its zero value so callers can apply their own defaults.
func (f *fileGuard) read(v any) error {
	f.mu.RLock()
	defer f.mu.RUnlock()
	data, err := os.ReadFile(f.path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, v)
}

func (f *fileGuard) write(v any) error {
	f.mu.Lock()
	defer f.mu.Unlock()

	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}

	dir := filepath.Dir(f.path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}
	if err := os.Chmod(tmpPath, 0600); err != nil {
		os.Remove(tmpPath)
		return err
	}
	return os.Rename(tmpPath, f.path)
}
