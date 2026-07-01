package app

import (
	"net/http"

	"resourcebay-framework/internal/auth"
	"resourcebay-framework/internal/config"
)

// session returns the active session for this request without creating
// one. In local mode it's always the single synthetic admin session.
func (a *App) session(r *http.Request) *auth.SessionData {
	if a.Cfg.Mode == config.ModeLocal {
		return a.localSession
	}
	return a.Sessions.Get(r)
}

// ensureSession returns the active session, creating an anonymous one
// (for CSRF tokens on login/setup pages) if none exists yet.
func (a *App) ensureSession(w http.ResponseWriter, r *http.Request) *auth.SessionData {
	if a.Cfg.Mode == config.ModeLocal {
		return a.localSession
	}
	_, data := a.Sessions.Ensure(w, r)
	return data
}

// requireLogin mirrors require_login(): redirects to /login.php unless a
// user is logged in. Always satisfied in local mode.
func (a *App) requireLogin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if a.Cfg.Mode == config.ModeLocal {
			next(w, r)
			return
		}
		sess := a.session(r)
		if !sess.LoggedIn() {
			http.Redirect(w, r, "/login.php", http.StatusFound)
			return
		}
		next(w, r)
	}
}

// requireAdmin mirrors require_admin(): checks the REAL user's role,
// ignoring any active impersonation. Always satisfied in local mode.
func (a *App) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return a.requireLogin(func(w http.ResponseWriter, r *http.Request) {
		if a.Cfg.Mode == config.ModeLocal {
			next(w, r)
			return
		}
		sess := a.session(r)
		real := sess.RealUser()
		if real == nil || real.Role != "admin" {
			http.Error(w, "Kein Zugriff auf diese Seite.", http.StatusForbidden)
			return
		}
		next(w, r)
	})
}

// requirePermission mirrors require_permission(): login required plus a
// specific RBAC permission, evaluated against the effective (possibly
// impersonated) user.
func (a *App) requirePermission(permission string, next http.HandlerFunc) http.HandlerFunc {
	return a.requireLogin(func(w http.ResponseWriter, r *http.Request) {
		sess := a.session(r)
		prod, err := a.Production.Load()
		if err != nil {
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}
		if !auth.HasPermission(sess.CurrentUser(), permission, prod) {
			a.writeJSON(w, http.StatusForbidden, map[string]any{
				"statusCode": 403, "error": "Forbidden",
				"message": "Kein Zugriff: Berechtigung \"" + permission + "\" fehlt.",
			})
			return
		}
		next(w, r)
	})
}

// setupGate mirrors the new first-run flow: in server mode, as long as no
// user exists yet, every request except static assets is routed to /setup.
func (a *App) setupGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.Cfg.Mode != config.ModeServer {
			next.ServeHTTP(w, r)
			return
		}
		if len(r.URL.Path) >= 8 && r.URL.Path[:8] == "/assets/" {
			next.ServeHTTP(w, r)
			return
		}
		empty, err := a.Users.IsEmpty()
		if err != nil {
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}
		if empty {
			if r.URL.Path != "/setup" {
				http.Redirect(w, r, "/setup", http.StatusFound)
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/setup" {
			http.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}
