package app

import (
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"resourcebay-framework/internal/auth"
	"resourcebay-framework/internal/store"
)

type permRow struct {
	Key        string
	ShortLabel string
	Checked    bool
}

type permGroup struct {
	Name string
	Rows []permRow
}

type permModule struct {
	Name   string
	Groups []permGroup
}

type adminUserRow struct {
	Username  string
	Initials  string
	IsAdmin   bool
	IsMe      bool
	PermCount int
	Modules   []permModule
}

var shortLabelPrefixRe = regexp.MustCompile(`^(Markt|Lager|Bank|Optionen|Produktion|Verträge|Vertragsvorlagen|Fahrzeuge|Firmen|Export|Produkt):\s*`)

var dynCategoryRe = regexp.MustCompile(`^produktion\.cat\.(fertig|vorfertigt)\.(.+)\.(view|edit)$`)

func buildPermModules(prod store.ProductionData, allPerms map[string]string, checkedPerms []string) []permModule {
	isChecked := func(key string) bool {
		for _, p := range checkedPerms {
			if p == key {
				return true
			}
		}
		return false
	}
	toRows := func(keys []string) []permRow {
		rows := make([]permRow, 0, len(keys))
		for _, k := range keys {
			label := allPerms[k]
			short := shortLabelPrefixRe.ReplaceAllString(label, "")
			rows = append(rows, permRow{Key: k, ShortLabel: short, Checked: isChecked(k)})
		}
		return rows
	}

	var modules []permModule

	// Markt & Bestände
	modules = append(modules, permModule{Name: "Markt & Bestände", Groups: []permGroup{
		{Name: "Marktangebote", Rows: toRows([]string{"markt.view"})},
		{Name: "Lagerbestände", Rows: toRows([]string{"lager.view"})},
		{Name: "Bankbestände", Rows: toRows([]string{"bank.view"})},
	}})

	// Produktion: Allgemein + dynamische Kategorie-Gruppen (alphabetisch)
	catGroups := map[string][]string{}
	for key := range auth.DynamicPermissions(prod) {
		m := dynCategoryRe.FindStringSubmatch(key)
		if m == nil {
			continue
		}
		typLabel := "Produkt"
		if m[1] == "vorfertigt" {
			typLabel = "Export"
		}
		groupName := typLabel + ": " + m[2]
		catGroups[groupName] = append(catGroups[groupName], key)
	}
	groupNames := make([]string, 0, len(catGroups))
	for name := range catGroups {
		groupNames = append(groupNames, name)
	}
	sort.Strings(groupNames)

	prodGroups := []permGroup{
		{Name: "Allgemein", Rows: toRows([]string{"produktion.view", "produktion.rohstoffe.edit", "produktion.produkte.edit"})},
	}
	for _, name := range groupNames {
		keys := catGroups[name]
		sort.Strings(keys)
		prodGroups = append(prodGroups, permGroup{Name: name, Rows: toRows(keys)})
	}
	modules = append(modules, permModule{Name: "Produktion", Groups: prodGroups})

	// Verträge-Modul
	modules = append(modules, permModule{Name: "Verträge-Modul", Groups: []permGroup{
		{Name: "Verträge", Rows: toRows([]string{"vertraege.view", "vertraege.create", "vertraege.edit"})},
		{Name: "Vertragsvorlagen", Rows: toRows([]string{"vertraege.vorlagen.edit"})},
		{Name: "Fahrzeuge", Rows: toRows([]string{"fahrzeuge.view", "fahrzeuge.edit"})},
		{Name: "Firmenkonfiguration", Rows: toRows([]string{"firmen.view", "firmen.edit"})},
	}})

	// Optionen
	modules = append(modules, permModule{Name: "Optionen", Groups: []permGroup{
		{Name: "Optionen-Editor", Rows: toRows([]string{"optionen.view", "optionen.edit"})},
	}})

	// Sonstiges
	modules = append(modules, permModule{Name: "Sonstiges", Groups: []permGroup{
		{Name: "Websites", Rows: toRows([]string{"websites.view"})},
	}})

	return modules
}

func initials(username string) string {
	u := strings.ToUpper(username)
	if len(u) >= 2 {
		return u[:2]
	}
	return u
}

func (a *App) handleAdmin(w http.ResponseWriter, r *http.Request) {
	sess := a.session(r)
	me := sess.RealUser()

	message, messageType := "", "info"

	if r.Method == http.MethodPost {
		if err := r.ParseForm(); err != nil {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}
		if !auth.CSRFVerify(sess, r.FormValue("csrf_token")) {
			message, messageType = "Ungültige Anfrage. Bitte Seite neu laden.", "error"
		} else {
			message, messageType = a.handleAdminAction(r, me)
		}
	}

	users, err := a.Users.Load()
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	prod, err := a.Production.Load()
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	allPerms := auth.AllPermissions(prod)

	usernames := make([]string, 0, len(users))
	for u := range users {
		usernames = append(usernames, u)
	}
	sort.Strings(usernames)

	rows := make([]adminUserRow, 0, len(usernames))
	for _, username := range usernames {
		u := users[username]
		isAdmin := u.Role == "admin"
		rows = append(rows, adminUserRow{
			Username:  username,
			Initials:  initials(username),
			IsAdmin:   isAdmin,
			IsMe:      me != nil && username == me.Username,
			PermCount: len(u.Permissions),
			Modules:   buildPermModules(prod, allPerms, u.Permissions),
		})
	}

	settings := a.Cfg.Settings()
	a.render(w, "admin.tmpl.html", struct {
		Branding    any
		Theme       any
		Me          *auth.SessionUser
		Message     string
		MessageType string
		CSRFToken   string
		Users       []adminUserRow
		Year        int
	}{
		Branding:    settings.Branding,
		Theme:       settings.Theme,
		Me:          me,
		Message:     message,
		MessageType: messageType,
		CSRFToken:   sess.CSRFToken,
		Users:       rows,
		Year:        time.Now().Year(),
	})
}

func (a *App) handleAdminAction(r *http.Request, me *auth.SessionUser) (string, string) {
	action := r.FormValue("action")

	switch action {
	case "create_user":
		username := strings.TrimSpace(r.FormValue("username"))
		password := r.FormValue("password")
		role := "user"
		if r.FormValue("role") == "admin" {
			role = "admin"
		}
		switch {
		case username == "" || password == "":
			return "Benutzername und Passwort sind erforderlich.", "error"
		case !usernameRe.MatchString(username):
			return "Benutzername darf nur Buchstaben, Zahlen, _ . - enthalten (3-32 Zeichen).", "error"
		case len(password) < 6:
			return "Passwort muss mindestens 6 Zeichen lang sein.", "error"
		}
		if err := a.Users.Create(username, password, role); err != nil {
			return "Dieser Benutzername existiert bereits.", "error"
		}
		return "Benutzer \"" + username + "\" wurde angelegt.", "success"

	case "update_role":
		username := r.FormValue("username")
		role := "user"
		if r.FormValue("role") == "admin" {
			role = "admin"
		}
		users, err := a.Users.Load()
		if err != nil {
			return "Interner Fehler.", "error"
		}
		if role != "admin" && users[username].Role == "admin" && a.Users.CountAdmins(users) <= 1 {
			return "Der letzte Admin-Account kann nicht degradiert werden.", "error"
		}
		if err := a.Users.UpdateRole(username, role); err != nil {
			return "Benutzer nicht gefunden.", "error"
		}
		return "Rolle von \"" + username + "\" wurde aktualisiert.", "success"

	case "reset_password":
		username := r.FormValue("username")
		password := r.FormValue("password")
		if len(password) < 6 {
			return "Neues Passwort muss mindestens 6 Zeichen lang sein.", "error"
		}
		if err := a.Users.UpdatePassword(username, password); err != nil {
			return "Benutzer nicht gefunden.", "error"
		}
		return "Passwort von \"" + username + "\" wurde geändert.", "success"

	case "set_permissions":
		username := r.FormValue("username")
		_, found, err := a.Users.Find(username)
		if err != nil || !found {
			return "Benutzer nicht gefunden.", "error"
		}
		prod, err := a.Production.Load()
		if err != nil {
			return "Interner Fehler.", "error"
		}
		allPerms := auth.AllPermissions(prod)
		submitted := r.Form["perms[]"]
		perms := make([]string, 0, len(submitted))
		for _, p := range submitted {
			if _, ok := allPerms[p]; ok {
				perms = append(perms, p)
			}
		}
		if err := a.Users.UpdatePermissions(username, perms); err != nil {
			return "Benutzer nicht gefunden.", "error"
		}
		return "Berechtigungen von \"" + username + "\" gespeichert.", "success"

	case "delete_user":
		username := r.FormValue("username")
		users, err := a.Users.Load()
		if err != nil {
			return "Interner Fehler.", "error"
		}
		switch {
		case me != nil && username == me.Username:
			return "Du kannst deinen eigenen Account hier nicht löschen.", "error"
		case users[username].Role == "admin" && a.Users.CountAdmins(users) <= 1:
			return "Der letzte Admin-Account kann nicht gelöscht werden.", "error"
		}
		if err := a.Users.Delete(username); err != nil {
			return "", ""
		}
		return "Benutzer \"" + username + "\" wurde gelöscht.", "success"
	}

	return "", ""
}
