package app

import (
	"net/http"
	"regexp"
	"strings"

	"resourcebay-framework/internal/auth"
)

var usernameRe = regexp.MustCompile(`^[a-zA-Z0-9_.\-]{3,32}$`)

// handleSetup is the new first-run flow (replaces the PHP original's
// hardcoded default admin account): only reachable while no user exists
// yet (see setupGate), lets the visitor create the first admin account.
func (a *App) handleSetup(w http.ResponseWriter, r *http.Request) {
	sess := a.ensureSession(w, r)
	errMsg := ""

	if r.Method == http.MethodPost {
		if err := r.ParseForm(); err != nil {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}
		if !auth.CSRFVerify(sess, r.FormValue("csrf_token")) {
			errMsg = "Ungültige Anfrage. Bitte Seite neu laden und erneut versuchen."
		} else {
			username := strings.TrimSpace(r.FormValue("username"))
			password := r.FormValue("password")
			confirm := r.FormValue("password_confirm")

			switch {
			case !usernameRe.MatchString(username):
				errMsg = "Benutzername darf nur Buchstaben, Zahlen, _ . - enthalten (3-32 Zeichen)."
			case len(password) < 6:
				errMsg = "Passwort muss mindestens 6 Zeichen lang sein."
			case password != confirm:
				errMsg = "Passwörter stimmen nicht überein."
			default:
				empty, err := a.Users.IsEmpty()
				if err != nil {
					http.Error(w, "Internal Server Error", http.StatusInternalServerError)
					return
				}
				if !empty {
					// Someone else completed setup concurrently — just move on.
					http.Redirect(w, r, "/login.php", http.StatusFound)
					return
				}
				if err := a.Users.Create(username, password, "admin"); err != nil {
					errMsg = "Dieser Benutzername existiert bereits."
				} else {
					http.Redirect(w, r, "/login.php", http.StatusFound)
					return
				}
			}
		}
	}

	settings := a.Cfg.Settings()
	a.render(w, "setup.tmpl.html", struct {
		Branding  any
		Theme     any
		Error     string
		CSRFToken string
	}{
		Branding:  settings.Branding,
		Theme:     settings.Theme,
		Error:     errMsg,
		CSRFToken: sess.CSRFToken,
	})
}
