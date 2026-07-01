package app

import (
	"net/http"

	"resourcebay-framework/internal/config"
)

func (a *App) registerRoutes(mux *http.ServeMux) {
	mux.Handle("/assets/", staticHandler())

	mux.HandleFunc("/setup", a.handleSetup)
	mux.HandleFunc("/login.php", a.handleLogin)
	mux.HandleFunc("/logout.php", a.handleLogout)
	mux.HandleFunc("/impersonate.php", a.requireAdmin(a.handleImpersonate))
	mux.HandleFunc("/admin.php", a.requireAdmin(a.handleAdmin))
	mux.HandleFunc("/settings", a.settingsRoute)
	mux.HandleFunc("/settings/import", a.settingsGate(a.handleImportData))
	a.registerExportRoutes(mux)
	a.registerUpdateRoutes(mux)

	mux.HandleFunc("/index.php", a.requireLogin(a.handleIndex))
	mux.HandleFunc("/api/production.php", a.handleProductionAPI)
	mux.HandleFunc("/api/contracts.php", a.handleContractsAPI)
	mux.HandleFunc("/api/proxy.php", a.handleProxy)
	mux.HandleFunc("/api/batch.php", a.handleBatch)
	// Serve "/" by directly rendering the index handler rather than issuing
	// an HTTP redirect to /index.php: Wails' embedded-handler webview does
	// not reliably follow 3xx redirects on the initial document load, so
	// the root route must resolve to final content in one response. A real
	// browser (server mode) would have handled either approach fine.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		a.requireLogin(a.handleIndex)(w, r)
	})
}

// settingsRoute: admin-only in server mode, always open in local mode.
func (a *App) settingsRoute(w http.ResponseWriter, r *http.Request) {
	a.settingsGate(a.handleSettings)(w, r)
}

// settingsGate applies the same access rule as /settings itself
// (admin-only in server mode, always open in local mode) to any handler
// that lives under the settings area, e.g. /settings/import.
func (a *App) settingsGate(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.Cfg.Mode == config.ModeLocal {
			next(w, r)
			return
		}
		a.requireAdmin(next)(w, r)
	}
}

// localOnly gates the team-server export endpoints to desktop/local mode
// — exporting a server binary from an already-running server makes no
// sense, and server mode has its own (real) admin/session model that
// these downloads bypass by design in local mode.
func (a *App) localOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.Cfg.Mode != config.ModeLocal {
			http.NotFound(w, r)
			return
		}
		next(w, r)
	}
}
