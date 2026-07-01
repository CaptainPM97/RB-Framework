// Package serverdist embeds pre-built resourcebay-server binaries for the
// platforms teams most commonly deploy to, so the desktop app can offer a
// one-click "export server binary" without needing a Go toolchain at
// runtime. Binaries are built by `make server-dist` before the desktop
// app itself is built (see Makefile) — the dist/ subdirectories exist as
// empty placeholders in source control so a plain `go build ./...` still
// compiles before that step has run.
package serverdist

import "embed"

//go:embed dist
var Dist embed.FS

type Platform struct {
	ID       string // stable key used in the export URL
	Label    string // shown in the UI
	Path     string // path within Dist
	Filename string // suggested download filename
}

var Platforms = []Platform{
	{ID: "linux-amd64", Label: "Linux (x86_64) — die meisten VPS/Cloud-Server", Path: "dist/linux-amd64/resourcebay-server", Filename: "resourcebay-server-linux-amd64"},
	{ID: "linux-arm64", Label: "Linux (ARM64) — z.B. Raspberry Pi, AWS Graviton", Path: "dist/linux-arm64/resourcebay-server", Filename: "resourcebay-server-linux-arm64"},
	{ID: "windows-amd64", Label: "Windows (x86_64)", Path: "dist/windows-amd64/resourcebay-server.exe", Filename: "resourcebay-server-windows-amd64.exe"},
}

func Find(id string) (Platform, bool) {
	for _, p := range Platforms {
		if p.ID == id {
			return p, true
		}
	}
	return Platform{}, false
}

// Available reports whether a binary was actually embedded for this
// platform (false if `make server-dist` hasn't been run yet, in which
// case only the placeholder directory exists).
func (p Platform) Available() bool {
	data, err := Dist.ReadFile(p.Path)
	return err == nil && len(data) > 0
}
