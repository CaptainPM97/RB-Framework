//go:build desktop

// This file (and its import of internal/serverdist, which embeds the
// pre-built resourcebay-server binaries) is only compiled into the desktop
// build via the "desktop" build tag — see Makefile. Without this tag
// isolation, cmd/server would transitively import internal/serverdist
// too, embedding server binaries inside the server binary itself, which
// then get embedded again the next time `make server-dist` runs off that
// output — an exponential self-inflation bug that produced 350MB+
// binaries before this split existed. cmd/server must never import
// internal/serverdist.
package app

import (
	"archive/zip"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"resourcebay-framework/internal/config"
	"resourcebay-framework/internal/serverdist"
)

func (a *App) registerExportRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/export/server", a.localOnly(a.handleExportServer))
	mux.HandleFunc("/api/export/data", a.localOnly(a.handleExportData))
}

func (a *App) teamExportPlatforms() []platformRow {
	if a.Cfg.Mode != config.ModeLocal {
		return nil
	}
	var out []platformRow
	for _, p := range serverdist.Platforms {
		out = append(out, platformRow{ID: p.ID, Label: p.Label, Available: p.Available()})
	}
	return out
}

// handleExportServer streams an embedded pre-built resourcebay-server binary
// for the requested platform — the "guided export" alternative to an
// automated remote deploy: the operator downloads the file themselves and
// copies it to their own server.
func (a *App) handleExportServer(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("platform")
	platform, ok := serverdist.Find(id)
	if !ok {
		http.Error(w, "Unbekannte Plattform", http.StatusBadRequest)
		return
	}
	data, err := serverdist.Dist.ReadFile(platform.Path)
	if err != nil || len(data) == 0 {
		http.Error(w, "Diese Server-Binary wurde in diesem Build nicht mitgeliefert.", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+platform.Filename+`"`)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	_, _ = w.Write(data)
}

// exportableFiles maps the checkbox names used by the settings form to
// the actual data files.
var exportableFiles = []struct {
	Param string
	File  string
}{
	{"users", "users.json"},
	{"production", "production.json"},
	{"contracts", "contracts.json"},
	{"settings", "settings.json"},
}

// handleExportData zips the selected data files (users, production,
// contracts, settings) so an operator can carry their local state over to
// a freshly exported server instance. With no query string at all
// (e.g. a bare link), everything is included; otherwise only the
// checkboxes actually present are honored, so unchecking one leaves it
// out even though the others stay selected.
func (a *App) handleExportData(w http.ResponseWriter, r *http.Request) {
	selectAll := len(r.URL.Query()) == 0

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="resourcebay-daten-export.zip"`)

	zw := zip.NewWriter(w)
	defer zw.Close()

	for _, f := range exportableFiles {
		if !selectAll && r.URL.Query().Get(f.Param) == "" {
			continue
		}
		path := filepath.Join(a.Cfg.DataDir, f.File)
		src, err := os.Open(path)
		if err != nil {
			continue // not every file exists yet on a fresh install — skip silently
		}
		dst, err := zw.Create(f.File)
		if err == nil {
			_, _ = io.Copy(dst, src)
		}
		src.Close()
	}
}
