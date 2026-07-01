//go:build desktop

// Self-update (replacing the running executable) only makes sense for the
// desktop build — a team server is managed by its own admin, who updates
// it deliberately (see README). Kept behind the "desktop" tag for the
// same reason as handlers_export.go.
package app

import (
	"net/http"
	"runtime"

	"resourcebay-framework/internal/buildinfo"
	"resourcebay-framework/internal/update"
)

func (a *App) registerUpdateRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/settings/update/check", a.settingsGate(a.handleUpdateCheck))
	mux.HandleFunc("/settings/update/apply", a.settingsGate(a.handleUpdateApply))
}

func (a *App) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	repoURL := a.Cfg.Settings().Feedback.RepoURL
	if repoURL == "" {
		a.writeJSON(w, http.StatusOK, map[string]any{"available": false, "error": "Kein Repository konfiguriert."})
		return
	}

	rel, err := update.CheckLatest(r.Context(), repoURL)
	if err != nil {
		a.writeJSON(w, http.StatusOK, map[string]any{"available": false, "error": err.Error()})
		return
	}

	current := buildinfo.Version
	available := update.IsNewer(current, rel.Version)
	_, hasAsset := rel.FindAsset(update.AssetName)

	a.writeJSON(w, http.StatusOK, map[string]any{
		"available":      available && hasAsset,
		"currentVersion": current,
		"latestVersion":  rel.Version,
		"releaseUrl":     rel.HTMLURL,
	})
}

func (a *App) handleUpdateApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	repoURL := a.Cfg.Settings().Feedback.RepoURL
	rel, err := update.CheckLatest(r.Context(), repoURL)
	if err != nil {
		a.writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Update-Prüfung fehlgeschlagen: " + err.Error()})
		return
	}

	asset, ok := rel.FindAsset(update.AssetName)
	if !ok {
		a.writeJSON(w, http.StatusNotFound, map[string]string{
			"error": "Für " + runtime.GOOS + " liegt in diesem Release keine passende Datei (" + update.AssetName + ")."},
		)
		return
	}

	path, err := update.DownloadAsset(r.Context(), asset)
	if err != nil {
		a.writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Download fehlgeschlagen: " + err.Error()})
		return
	}

	// On success, Apply() exits this process — no response is ever sent,
	// which is expected (the frontend shows a message before calling this
	// and doesn't wait for a reply). Only a failure path returns.
	if err := update.Apply(path); err != nil {
		a.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Installation fehlgeschlagen: " + err.Error()})
		return
	}
}
