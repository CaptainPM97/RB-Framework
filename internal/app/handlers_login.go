package app

import (
	"net/http"
	"strings"

	"golang.org/x/crypto/bcrypt"

	"resourcebay-framework/internal/auth"
)

func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	sess := a.ensureSession(w, r)
	if sess.LoggedIn() {
		http.Redirect(w, r, "/index.php", http.StatusFound)
		return
	}

	settings := a.Cfg.Settings()
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
			user, found, err := a.Users.Find(username)
			if err != nil {
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}
			if found && bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) == nil {
				a.Sessions.Login(w, r, auth.SessionUser{
					Username:    username,
					Role:        user.Role,
					Permissions: user.Permissions,
				})
				http.Redirect(w, r, "/index.php", http.StatusFound)
				return
			}
			errMsg = "Benutzername oder Passwort ist falsch."
		}
	}

	a.render(w, "login.tmpl.html", struct {
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

func (a *App) handleLogout(w http.ResponseWriter, r *http.Request) {
	a.Sessions.Logout(w, r)
	http.Redirect(w, r, "/login.php", http.StatusFound)
}
