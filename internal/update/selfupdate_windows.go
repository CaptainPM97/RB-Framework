//go:build windows

package update

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

// AssetName is the release asset this platform downloads for a self-update.
// The plain portable .exe is used (not the NSIS Setup.exe) since a
// straight file swap works the same whether the current install originally
// came from the installer or the portable download — both end up as the
// same executable sitting at the same path.
const AssetName = "ResourceBay-Framework-Windows-portable.exe"

// Apply hands off to a small detached helper .bat that waits for this
// process's PID to actually disappear (Windows keeps the running .exe
// file locked, so it can't be replaced while we're still alive), then
// swaps in the new file and relaunches it. On success this function does
// not return.
func Apply(downloadedExePath string) error {
	exePath, err := os.Executable()
	if err != nil {
		return err
	}

	pid := os.Getpid()
	script := fmt.Sprintf(`@echo off
:wait
tasklist /FI "PID eq %d" 2>NUL | find "%d" >NUL
if not errorlevel 1 (
  timeout /t 1 /nobreak >NUL
  goto wait
)
move /Y "%s" "%s" >NUL
start "" "%s"
del "%%~f0"
`, pid, pid, downloadedExePath, exePath, exePath)

	scriptFile, err := os.CreateTemp("", "rb-update-*.bat")
	if err != nil {
		return err
	}
	if _, err := scriptFile.WriteString(script); err != nil {
		scriptFile.Close()
		return err
	}
	scriptFile.Close()

	cmd := exec.Command("cmd", "/C", "start", "/min", "", filepath.Clean(scriptFile.Name()))
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000008} // DETACHED_PROCESS
	if err := cmd.Start(); err != nil {
		return err
	}

	os.Exit(0)
	return nil // unreachable
}
