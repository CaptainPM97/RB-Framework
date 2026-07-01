package app

import (
	"net/http"

	"resourcebay-framework/internal/auth"
)

func (a *App) handleImpersonate(w http.ResponseWriter, r *http.Request) {
	sess := a.session(r)

	if err := r.ParseForm(); err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	if !auth.CSRFVerify(sess, r.FormValue("csrf_token")) {
		http.Error(w, "Ungültige Anfrage.", http.StatusForbidden)
		return
	}

	action := r.FormValue("action")
	switch action {
	case "start":
		username := r.FormValue("username")
		real := sess.RealUser()
		if real != nil && username == real.Username {
			sess.StopImpersonation()
		} else {
			target, found, err := a.Users.Find(username)
			if err == nil && found {
				sess.StartImpersonation(username, auth.SessionUser{
					Username:    username,
					Role:        target.Role,
					Permissions: target.Permissions,
				})
			}
		}
	case "stop":
		sess.StopImpersonation()
	}

	http.Redirect(w, r, "/index.php", http.StatusFound)
}
