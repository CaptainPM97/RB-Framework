package app

import (
	"io"
	"net/http"
	"regexp"
	"strings"

	"resourcebay-framework/internal/auth"
	"resourcebay-framework/internal/vapi"
)

var proxyPathRe = regexp.MustCompile(`^[A-Za-z0-9_\-./]+$`)

var (
	proxyLagerRe = regexp.MustCompile(`^factory/(inventory|machine)/`)
	proxyOptRe   = regexp.MustCompile(`^factory/options(/|$)`)
	proxyBankRe  = regexp.MustCompile(`^(building/bankaccounts|factory/(bankaccounts|transactions))/`)
)

// proxyRequiredPermission mirrors api/proxy.php's URL-pattern permission gate.
func proxyRequiredPermission(path, method string) string {
	p := strings.TrimLeft(path, "/")
	switch {
	case proxyLagerRe.MatchString(p):
		return "lager.view"
	case proxyOptRe.MatchString(p):
		if method == http.MethodPost {
			return "optionen.edit"
		}
		return "optionen.view"
	case proxyBankRe.MatchString(p):
		return "bank.view"
	}
	return ""
}

func (a *App) handleProxy(w http.ResponseWriter, r *http.Request) {
	if origin := r.Header.Get("Origin"); origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Accept")
		w.Header().Set("Access-Control-Max-Age", "86400")
	}
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	sess := a.session(r)
	if !sess.LoggedIn() {
		a.writeJSON(w, http.StatusUnauthorized, map[string]any{
			"statusCode": 401, "error": "Unauthorized", "message": "Nicht eingeloggt.",
		})
		return
	}

	path := r.URL.Query().Get("path")
	if path == "" || strings.Contains(path, "..") || !proxyPathRe.MatchString(path) {
		a.writeJSON(w, http.StatusBadRequest, map[string]any{
			"statusCode": 400, "error": "Bad Request", "message": "Ungültiger API-Pfad.",
		})
		return
	}

	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		a.writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"statusCode": 405, "error": "Method Not Allowed"})
		return
	}

	normalizedPath := strings.TrimLeft(path, "/")

	prod, err := a.Production.Load()
	if err != nil {
		a.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal Server Error"})
		return
	}
	if perm := proxyRequiredPermission(normalizedPath, r.Method); perm != "" && !auth.HasPermission(sess.CurrentUser(), perm, prod) {
		a.writeJSON(w, http.StatusForbidden, map[string]any{
			"statusCode": 403, "error": "Forbidden",
			"message": "Kein Zugriff: Berechtigung \"" + perm + "\" fehlt.",
		})
		return
	}

	var body []byte
	injectSecret := false
	if r.Method == http.MethodPost {
		body, _ = io.ReadAll(r.Body)
		if normalizedPath == "factory/options" {
			injectSecret = true
		}
	}

	status, respBody, err := a.VAPI.Do(r.Context(), r.Method, normalizedPath, body, injectSecret)
	if err == vapi.ErrRateLimited {
		a.writeJSON(w, http.StatusTooManyRequests, map[string]any{
			"statusCode": 429, "error": "Too Many Requests", "message": err.Error(),
		})
		return
	}
	if err == vapi.ErrNoKeys {
		a.writeJSON(w, http.StatusBadGateway, map[string]any{
			"statusCode": 502, "error": "Bad Gateway", "message": "Kein StateV-API-Key konfiguriert.",
		})
		return
	}
	if err != nil {
		a.writeJSON(w, http.StatusBadGateway, map[string]any{
			"statusCode": 502, "error": "Bad Gateway", "message": err.Error(),
		})
		return
	}
	if status == 0 {
		status = http.StatusBadGateway
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(respBody)
}
