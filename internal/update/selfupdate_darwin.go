//go:build darwin

package update

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// AssetName is the release asset this platform downloads for a self-update.
const AssetName = "ResourceBay-Framework-macOS.dmg"

// Apply mounts the downloaded .dmg, hands off to a small detached helper
// script that (after this process has fully exited) replaces the running
// .app bundle with the new one and relaunches it, then exits this process.
// On success this function does not return — the caller should treat any
// returned error as "update aborted, still running the old version".
func Apply(downloadedDMGPath string) error {
	exePath, err := os.Executable()
	if err != nil {
		return err
	}
	// exePath is .../ResourceBay Framework.app/Contents/MacOS/resourcebay-desktop
	appBundle := filepath.Dir(filepath.Dir(filepath.Dir(exePath)))
	if !strings.HasSuffix(appBundle, ".app") {
		return fmt.Errorf("konnte App-Bundle-Pfad nicht bestimmen (%s)", appBundle)
	}

	mountPoint, err := os.MkdirTemp("", "rb-update-mount-*")
	if err != nil {
		return err
	}

	attach := exec.Command("hdiutil", "attach", downloadedDMGPath, "-nobrowse", "-mountpoint", mountPoint)
	if out, err := attach.CombinedOutput(); err != nil {
		os.RemoveAll(mountPoint)
		return fmt.Errorf("DMG konnte nicht eingehängt werden: %v (%s)", err, string(out))
	}

	entries, err := os.ReadDir(mountPoint)
	if err != nil {
		exec.Command("hdiutil", "detach", mountPoint).Run()
		os.RemoveAll(mountPoint)
		return err
	}
	var newApp string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".app") {
			newApp = filepath.Join(mountPoint, e.Name())
			break
		}
	}
	if newApp == "" {
		exec.Command("hdiutil", "detach", mountPoint).Run()
		os.RemoveAll(mountPoint)
		return fmt.Errorf("kein .app im heruntergeladenen Installationsabbild gefunden")
	}

	// The helper script runs *after* this process has exited (sleep 1 as a
	// safety margin), so it's always safe for it to remove/replace the
	// bundle we're currently executing from.
	script := fmt.Sprintf(`#!/bin/bash
sleep 1
rm -rf "%s"
cp -R "%s" "%s"
hdiutil detach "%s" >/dev/null 2>&1
rm -rf "%s"
rm -f "%s"
open "%s"
rm -- "$0"
`, appBundle, newApp, appBundle, mountPoint, mountPoint, downloadedDMGPath, appBundle)

	scriptFile, err := os.CreateTemp("", "rb-update-*.sh")
	if err != nil {
		exec.Command("hdiutil", "detach", mountPoint).Run()
		os.RemoveAll(mountPoint)
		return err
	}
	if _, err := scriptFile.WriteString(script); err != nil {
		scriptFile.Close()
		exec.Command("hdiutil", "detach", mountPoint).Run()
		os.RemoveAll(mountPoint)
		return err
	}
	scriptFile.Close()
	if err := os.Chmod(scriptFile.Name(), 0700); err != nil {
		exec.Command("hdiutil", "detach", mountPoint).Run()
		os.RemoveAll(mountPoint)
		return err
	}

	cmd := exec.Command("/bin/bash", scriptFile.Name())
	if err := cmd.Start(); err != nil {
		exec.Command("hdiutil", "detach", mountPoint).Run()
		os.RemoveAll(mountPoint)
		return err
	}

	os.Exit(0)
	return nil // unreachable
}
