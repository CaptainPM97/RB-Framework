//go:build !desktop

// Server builds (no "desktop" build tag) never import internal/serverdist,
// so the server binary can't embed a copy of itself — see the comment in
// handlers_export.go for why that matters.
package app

import "net/http"

func (a *App) registerExportRoutes(mux *http.ServeMux) {}

func (a *App) teamExportPlatforms() []platformRow { return nil }

func (a *App) registerUpdateRoutes(mux *http.ServeMux) {}
