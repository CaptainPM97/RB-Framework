package app

import (
	"encoding/json"
	"net/http"
	"time"

	"resourcebay-framework/internal/auth"
	"resourcebay-framework/internal/config"
)

type otherUser struct {
	Username string
	Role     string
}

func (a *App) handleIndex(w http.ResponseWriter, r *http.Request) {
	sess := a.session(r)
	me := sess.CurrentUser()
	realMe := sess.RealUser()

	prod, err := a.Production.Load()
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	isAdmin := realMe != nil && realMe.Role == "admin"
	effectiveIsAdmin := me != nil && me.Role == "admin"

	canWebsites := auth.HasPermission(me, "websites.view", prod)
	canMarkt := auth.HasPermission(me, "markt.view", prod)
	canLager := auth.HasPermission(me, "lager.view", prod)
	canBank := auth.HasPermission(me, "bank.view", prod)
	canOptionen := auth.HasPermission(me, "optionen.view", prod)
	canOptEdit := auth.HasPermission(me, "optionen.edit", prod)
	canProd := auth.HasProdAccess(me)
	canProdEdit := auth.HasPermission(me, "produktion.produkte.edit", prod)
	canRsEdit := auth.HasPermission(me, "produktion.rohstoffe.edit", prod)
	canVertr := auth.HasPermission(me, "vertraege.view", prod)
	canVertrCreate := auth.HasPermission(me, "vertraege.create", prod)
	canVertrEdit := auth.HasPermission(me, "vertraege.edit", prod)
	canVorlagenEdit := auth.HasPermission(me, "vertraege.vorlagen.edit", prod)
	canFahrzeuge := auth.HasPermission(me, "fahrzeuge.view", prod)
	canFahrzEdit := auth.HasPermission(me, "fahrzeuge.edit", prod)
	canFirmen := auth.HasPermission(me, "firmen.view", prod)
	canFirmEdit := auth.HasPermission(me, "firmen.edit", prod)

	var rawPerms []string
	if effectiveIsAdmin {
		rawPerms = []string{"*"}
	} else if me != nil {
		rawPerms = auth.ExpandPermissions(me.Permissions, prod)
	} else {
		rawPerms = []string{}
	}
	rawPermsJSON, _ := json.Marshal(rawPerms)

	var others []otherUser
	if isAdmin && a.Cfg.Mode == config.ModeServer {
		users, err := a.Users.Load()
		if err == nil {
			for uname, u := range users {
				if realMe != nil && uname == realMe.Username {
					continue
				}
				others = append(others, otherUser{Username: uname, Role: u.Role})
			}
		}
	}

	settings := a.Cfg.Settings()

	a.render(w, "index.tmpl.html", struct {
		Branding         config.Branding
		Theme            config.Theme
		Me               *auth.SessionUser
		RealMe           *auth.SessionUser
		IsAdmin          bool
		EffectiveIsAdmin bool
		IsImpersonating  bool
		CanWebsites      bool
		CanMarkt         bool
		CanLager         bool
		CanBank          bool
		CanOptionen      bool
		CanOptEdit       bool
		CanProd          bool
		CanProdEdit      bool
		CanRsEdit        bool
		CanVertr         bool
		CanVertrCreate   bool
		CanVertrEdit     bool
		CanVorlagenEdit  bool
		CanFahrzeuge     bool
		CanFahrzEdit     bool
		CanFirmen        bool
		CanFirmEdit      bool
		RawPermsJSON     string
		CSRFToken        string
		OtherUsers       []otherUser
		Year             int
	}{
		Branding:         settings.Branding,
		Theme:            settings.Theme,
		Me:               me,
		RealMe:           realMe,
		IsAdmin:          isAdmin,
		EffectiveIsAdmin: effectiveIsAdmin,
		IsImpersonating:  sess.IsImpersonating(),
		CanWebsites:      canWebsites,
		CanMarkt:         canMarkt,
		CanLager:         canLager,
		CanBank:          canBank,
		CanOptionen:      canOptionen,
		CanOptEdit:       canOptEdit,
		CanProd:          canProd,
		CanProdEdit:      canProdEdit,
		CanRsEdit:        canRsEdit,
		CanVertr:         canVertr,
		CanVertrCreate:   canVertrCreate,
		CanVertrEdit:     canVertrEdit,
		CanVorlagenEdit:  canVorlagenEdit,
		CanFahrzeuge:     canFahrzeuge,
		CanFahrzEdit:     canFahrzEdit,
		CanFirmen:        canFirmen,
		CanFirmEdit:      canFirmEdit,
		RawPermsJSON:     string(rawPermsJSON),
		CSRFToken:        sess.CSRFToken,
		OtherUsers:       others,
		Year:             time.Now().Year(),
	})
}
