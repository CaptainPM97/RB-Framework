package app

import (
	"net/http"
	"strings"
	"time"

	"resourcebay-framework/internal/auth"
	"resourcebay-framework/internal/buildinfo"
	"resourcebay-framework/internal/config"
	"resourcebay-framework/internal/vapi"
)

func (a *App) handleSettings(w http.ResponseWriter, r *http.Request) {
	sess := a.ensureSession(w, r)
	message, messageType := "", "info"

	if r.Method == http.MethodPost {
		if err := r.ParseForm(); err != nil {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}
		if !auth.CSRFVerify(sess, r.FormValue("csrf_token")) {
			message, messageType = "Ungültige Anfrage. Bitte Seite neu laden.", "error"
		} else {
			settings := a.Cfg.Settings()
			switch r.FormValue("section") {
			case "branding":
				settings.Branding.AppName = strings.TrimSpace(r.FormValue("appName"))
				settings.Branding.Subtitle = strings.TrimSpace(r.FormValue("subtitle"))
				settings.Branding.LogoInitials = strings.ToUpper(strings.TrimSpace(r.FormValue("logoInitials")))
				settings.Branding.ContractPrefix = strings.TrimSpace(r.FormValue("contractPrefix"))
				settings.Branding.Website1Label = strings.TrimSpace(r.FormValue("website1Label"))
				settings.Branding.Website1URL = strings.TrimSpace(r.FormValue("website1Url"))
				settings.Branding.Website2Label = strings.TrimSpace(r.FormValue("website2Label"))
				settings.Branding.Website2URL = strings.TrimSpace(r.FormValue("website2Url"))
				if settings.Branding.AppName == "" || settings.Branding.LogoInitials == "" {
					message, messageType = "App-Name und Logo-Kürzel sind erforderlich.", "error"
					break
				}
				if err := a.Cfg.Save(settings); err != nil {
					message, messageType = "Speichern fehlgeschlagen.", "error"
					break
				}
				message, messageType = "Branding gespeichert.", "success"

			case "theme":
				settings.Theme.Primary = r.FormValue("primary")
				settings.Theme.BgGradientStart = r.FormValue("bgGradientStart")
				settings.Theme.BgGradientEnd = r.FormValue("bgGradientEnd")
				if err := a.Cfg.Save(settings); err != nil {
					message, messageType = "Speichern fehlgeschlagen.", "error"
					break
				}
				message, messageType = "Darstellung gespeichert.", "success"

			case "vapi":
				settings.VAPI.Key = strings.TrimSpace(r.FormValue("vapiKey"))
				settings.VAPI.Secret = strings.TrimSpace(r.FormValue("vapiSecret"))
				if err := a.Cfg.Save(settings); err != nil {
					message, messageType = "Speichern fehlgeschlagen.", "error"
					break
				}
				message, messageType = "API-Zugang gespeichert.", "success"

			case "team":
				settings.Team.ServerURL = strings.TrimSpace(r.FormValue("teamServerUrl"))
				if err := a.Cfg.Save(settings); err != nil {
					message, messageType = "Speichern fehlgeschlagen.", "error"
					break
				}
				message, messageType = "Team-Server-Adresse gespeichert.", "success"
			}
		}
	}

	// The import form posts to its own endpoint (needs multipart parsing)
	// and redirects back here with a one-shot cookie for the result message.
	if message == "" {
		if c, err := r.Cookie("import_message"); err == nil {
			if kind, text, ok := strings.Cut(c.Value, ":"); ok {
				messageType, message = kind, text
			}
			http.SetCookie(w, &http.Cookie{Name: "import_message", Value: "", Path: "/settings", MaxAge: -1})
		}
	}

	settings := a.Cfg.Settings()
	platforms := a.teamExportPlatforms()

	a.render(w, "settings.tmpl.html", struct {
		Branding       config.Branding
		Theme          config.Theme
		Settings       config.Settings
		Message        string
		MessageType    string
		CSRFToken      string
		ShowBackLink   bool
		ShowLogout     bool
		ShowTeamExport bool
		Platforms      []platformRow
		Version        string
		VAPIBaseURL    string
		Year           int
	}{
		Branding:       settings.Branding,
		Theme:          settings.Theme,
		Settings:       settings,
		Message:        message,
		MessageType:    messageType,
		CSRFToken:      sess.CSRFToken,
		ShowBackLink:   sess.LoggedIn(),
		ShowLogout:     sess.LoggedIn(),
		ShowTeamExport: a.Cfg.Mode == config.ModeLocal,
		Platforms:      platforms,
		Version:        buildinfo.Version,
		VAPIBaseURL:    vapi.BaseURL,
		Year:           time.Now().Year(),
	})
}
