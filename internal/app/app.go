// Package app wires config, storage, auth and handlers into a single
// http.Handler shared by both build targets (cmd/server and cmd/desktop).
package app

import (
	"encoding/json"
	"html/template"
	"log"
	"net/http"

	"resourcebay-framework/internal/auth"
	"resourcebay-framework/internal/config"
	"resourcebay-framework/internal/store"
	"resourcebay-framework/internal/vapi"
	"resourcebay-framework/internal/webassets"
)

type App struct {
	Cfg        *config.Config
	Sessions   *auth.SessionStore
	Users      *store.UserStore
	Production *store.ProductionStore
	Contracts  *store.ContractsStore
	VAPI       *vapi.Client
	Templates  *template.Template

	// localSession is the single synthetic always-admin session shared by
	// every request in ModeLocal — there is no login in that mode.
	localSession *auth.SessionData
}

func NewHandler(cfg *config.Config) (http.Handler, error) {
	if err := cfg.Load(); err != nil {
		return nil, err
	}

	a := &App{
		Cfg:        cfg,
		Sessions:   auth.NewSessionStore(),
		Users:      store.NewUserStore(cfg.DataDir + "/users.json"),
		Production: store.NewProductionStore(cfg.DataDir + "/production.json"),
		Contracts:  store.NewContractsStore(cfg.DataDir + "/contracts.json"),
		VAPI:       vapi.New(cfg),
	}

	if cfg.Mode == config.ModeLocal {
		a.localSession = auth.NewLocalSession()
	}

	tmpl, err := template.New("").Funcs(template.FuncMap{
		"asset": webassets.AssetURL,
	}).ParseFS(webassets.Templates, "templates/*.tmpl.html")
	if err != nil {
		return nil, err
	}
	a.Templates = tmpl

	mux := http.NewServeMux()
	a.registerRoutes(mux)

	return withLogging(a.setupGate(mux)), nil
}

func withLogging(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		h.ServeHTTP(w, r)
	})
}

func (a *App) render(w http.ResponseWriter, name string, data any) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := a.Templates.ExecuteTemplate(w, name, data); err != nil {
		log.Printf("template error (%s): %v", name, err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
	}
}

func (a *App) writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
