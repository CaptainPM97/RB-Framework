package app

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"resourcebay-framework/internal/auth"
)

var (
	batchLagerRe = regexp.MustCompile(`^factory/(inventory|machine)/`)
	batchOptRe   = regexp.MustCompile(`^factory/options(/|$)`)
	batchBankRe  = regexp.MustCompile(`^factory/(bankaccounts|transactions)/`)
	batchBldgRe  = regexp.MustCompile(`^building/(bankaccounts|transactions)/`)
)

// batchRequiredPermission mirrors api/batch.php's batchRequiredPermission():
// note it checks the bare legacy permission names ("lager"/"optionen"/"bank"),
// not the modern ".view" keys — an inconsistency present in the original PHP
// (proxy.php uses the modern keys) that is intentionally kept identical here.
func batchRequiredPermission(path string) string {
	p := strings.TrimLeft(path, "/")
	switch {
	case batchLagerRe.MatchString(p):
		return "lager"
	case batchOptRe.MatchString(p):
		return "optionen"
	case batchBankRe.MatchString(p), batchBldgRe.MatchString(p):
		return "bank"
	}
	return ""
}

func batchValidatePath(path string) bool {
	return path != "" && !strings.Contains(path, "..") && proxyPathRe.MatchString(path)
}

type batchResultJSON struct {
	Path   string `json:"path"`
	Status int    `json:"status"`
	Body   any    `json:"body"`
}

func (a *App) handleBatch(w http.ResponseWriter, r *http.Request) {
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
		a.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}
	if r.Method != http.MethodPost {
		a.writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method Not Allowed"})
		return
	}

	var input struct {
		Paths []string `json:"paths"`
	}
	_ = json.NewDecoder(r.Body).Decode(&input)
	if len(input.Paths) == 0 || len(input.Paths) > 100 {
		a.writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "Bad Request", "message": "paths muss ein Array mit 1–100 Einträgen sein.",
		})
		return
	}

	prod, err := a.Production.Load()
	if err != nil {
		a.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal Server Error"})
		return
	}

	results := make([]batchResultJSON, len(input.Paths))
	var toFetch []int
	var toFetchPaths []string

	for i, path := range input.Paths {
		if !batchValidatePath(path) {
			results[i] = batchResultJSON{Path: path, Status: 400, Body: map[string]string{"error": "Invalid path"}}
			continue
		}
		if perm := batchRequiredPermission(path); perm != "" && !auth.HasPermission(sess.CurrentUser(), perm, prod) {
			results[i] = batchResultJSON{Path: path, Status: 403, Body: map[string]string{"error": "Forbidden"}}
			continue
		}
		toFetch = append(toFetch, i)
		toFetchPaths = append(toFetchPaths, strings.TrimLeft(path, "/"))
	}

	if len(toFetchPaths) > 0 {
		fetched := a.VAPI.Batch(r.Context(), toFetchPaths)
		for j, res := range fetched {
			i := toFetch[j]
			if res.Err != nil || res.Status < 200 || res.Status >= 300 {
				status := res.Status
				if status == 0 {
					status = 502
				}
				msg := "API nicht erreichbar"
				if res.Err != nil {
					msg = res.Err.Error()
				}
				results[i] = batchResultJSON{Path: res.Path, Status: status, Body: map[string]string{"error": "Bad Gateway", "message": msg}}
				continue
			}
			var parsed any
			_ = json.Unmarshal(res.Body, &parsed)
			results[i] = batchResultJSON{Path: res.Path, Status: res.Status, Body: parsed}
		}
	}

	a.writeJSON(w, http.StatusOK, results)
}
