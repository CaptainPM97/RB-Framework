package app

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"resourcebay-framework/internal/auth"
	"resourcebay-framework/internal/store"
)

// backupExisting copies the current data file aside (if it exists) before
// an import overwrites it, so a bad import can be undone by hand.
func backupExisting(path string) error {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	backupPath := path + ".bak-" + time.Now().Format("20060102-150405")
	return os.WriteFile(backupPath, data, 0600)
}

func (a *App) handleImportData(w http.ResponseWriter, r *http.Request) {
	sess := a.ensureSession(w, r)

	if r.Method != http.MethodPost {
		http.Redirect(w, r, "/settings", http.StatusFound)
		return
	}

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		a.redirectWithImportMessage(w, r, "Datei-Upload fehlgeschlagen (zu groß oder ungültig).", "error")
		return
	}
	if !auth.CSRFVerify(sess, r.FormValue("csrf_token")) {
		a.redirectWithImportMessage(w, r, "Ungültige Anfrage. Bitte Seite neu laden.", "error")
		return
	}

	var results []string

	if summary, err := a.importUsers(r); err != nil {
		a.redirectWithImportMessage(w, r, "Benutzer-Import fehlgeschlagen: "+err.Error(), "error")
		return
	} else if summary != "" {
		results = append(results, summary)
	}

	if summary, err := a.importProduction(r); err != nil {
		a.redirectWithImportMessage(w, r, "Produktions-Import fehlgeschlagen: "+err.Error(), "error")
		return
	} else if summary != "" {
		results = append(results, summary)
	}

	if summary, err := a.importContracts(r); err != nil {
		a.redirectWithImportMessage(w, r, "Vertrags-Import fehlgeschlagen: "+err.Error(), "error")
		return
	} else if summary != "" {
		results = append(results, summary)
	}

	if len(results) == 0 {
		a.redirectWithImportMessage(w, r, "Keine Datei ausgewählt.", "error")
		return
	}

	msg := "Importiert: "
	for i, r := range results {
		if i > 0 {
			msg += ", "
		}
		msg += r
	}
	a.redirectWithImportMessage(w, r, msg, "success")
}

func readUploadedFile(r *http.Request, field string) ([]byte, bool, error) {
	file, _, err := r.FormFile(field)
	if err == http.ErrMissingFile {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		return nil, false, err
	}
	if len(data) == 0 {
		return nil, false, nil
	}
	return data, true, nil
}

func (a *App) importUsers(r *http.Request) (string, error) {
	data, present, err := readUploadedFile(r, "users")
	if err != nil || !present {
		return "", err
	}
	var users map[string]store.User
	if err := json.Unmarshal(data, &users); err != nil {
		return "", fmt.Errorf("keine gültige users.json (%v)", err)
	}
	if err := backupExisting(filepath.Join(a.Cfg.DataDir, "users.json")); err != nil {
		return "", err
	}
	if err := a.Users.Import(users); err != nil {
		return "", err
	}
	return fmt.Sprintf("%d Benutzer", len(users)), nil
}

func (a *App) importProduction(r *http.Request) (string, error) {
	data, present, err := readUploadedFile(r, "production")
	if err != nil || !present {
		return "", err
	}
	var pd store.ProductionData
	if err := json.Unmarshal(data, &pd); err != nil {
		return "", fmt.Errorf("keine gültige production.json (%v)", err)
	}
	if err := backupExisting(filepath.Join(a.Cfg.DataDir, "production.json")); err != nil {
		return "", err
	}
	if err := a.Production.Save(pd); err != nil {
		return "", err
	}
	return fmt.Sprintf("%d Rohstoffe, %d Produkte", len(pd.Rohstoffe), len(pd.Products)), nil
}

func (a *App) importContracts(r *http.Request) (string, error) {
	data, present, err := readUploadedFile(r, "contracts")
	if err != nil || !present {
		return "", err
	}
	var cd store.ContractsData
	if err := json.Unmarshal(data, &cd); err != nil {
		return "", fmt.Errorf("keine gültige contracts.json (%v)", err)
	}
	if err := backupExisting(filepath.Join(a.Cfg.DataDir, "contracts.json")); err != nil {
		return "", err
	}
	if err := a.Contracts.Save(cd); err != nil {
		return "", err
	}
	return fmt.Sprintf("%d Verträge, %d Fahrzeuge", len(cd.Contracts), len(cd.Vehicles)), nil
}

// redirectWithImportMessage stashes a one-shot message in a short-lived
// cookie and redirects back to /settings, since the import posts to its
// own endpoint (needs multipart parsing) rather than reusing the settings
// form's single-message inline render.
func (a *App) redirectWithImportMessage(w http.ResponseWriter, r *http.Request, msg, kind string) {
	http.SetCookie(w, &http.Cookie{
		Name:     "import_message",
		Value:    kind + ":" + msg,
		Path:     "/settings",
		HttpOnly: true,
		MaxAge:   10,
	})
	http.Redirect(w, r, "/settings", http.StatusFound)
}
