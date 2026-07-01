package auth

import (
	"fmt"
	"regexp"
	"strings"

	"resourcebay-framework/internal/store"
)

// RBPermissions mirrors RB_PERMISSIONS from includes/auth.php — the
// static, always-known permission keys.
var RBPermissions = map[string]string{
	"websites.view": "IC & Dev Websites ansehen",

	"markt.view": "Marktangebote ansehen",

	"lager.view": "Lagerbestände ansehen",

	"bank.view": "Bankbestände ansehen",

	"optionen.view": "Optionen ansehen",
	"optionen.edit": "Optionen bearbeiten",

	"produktion.view":           "Produktion ansehen (alle Kategorien)",
	"produktion.rohstoffe.edit": "Rohstoffe anlegen/bearbeiten",
	"produktion.produkte.edit":  "Produkte anlegen/bearbeiten (alle Kategorien)",

	"vertraege.view":          "Verträge ansehen",
	"vertraege.create":        "Neue Verträge erstellen",
	"vertraege.edit":          "Verträge bearbeiten/löschen/verlängern",
	"vertraege.vorlagen.edit": "Vertragsvorlagen anlegen/bearbeiten",

	"fahrzeuge.view": "Fahrzeuge ansehen",
	"fahrzeuge.edit": "Fahrzeuge anlegen/bearbeiten",

	"firmen.view": "Firmen ansehen",
	"firmen.edit": "Firmen anlegen/bearbeiten",
}

// legacyPermissions mirrors RB_LEGACY_PERMISSIONS: bare pre-.view/.edit
// permission keys that get auto-migrated so existing users.json data
// keeps working without manual re-assignment.
var legacyPermissions = map[string]string{
	"lager":    "lager.view",
	"bank":     "bank.view",
	"optionen": "optionen.view",
}

var legacyCategoryRe = regexp.MustCompile(`^produktion\.cat\.([^.]+)\.(view|edit)$`)

func categoryType(typ string) string {
	if typ == "vorfertigt" {
		return "vorfertigt"
	}
	return "fertig"
}

// DynamicPermissions mirrors get_dynamic_permissions(): derives
// produktion.cat.{typ}.{kategorie}.{view|edit} keys from the categories
// actually present in the production data.
func DynamicPermissions(prod store.ProductionData) map[string]string {
	type combo struct{ typ, kategorie string }
	seen := map[combo]bool{}
	perms := map[string]string{}
	for _, p := range prod.Products {
		kat := strings.TrimSpace(p.Kategorie)
		if kat == "" {
			continue
		}
		typ := categoryType(p.Typ)
		c := combo{typ, kat}
		if seen[c] {
			continue
		}
		seen[c] = true

		typLabel := "Produkt"
		if typ == "vorfertigt" {
			typLabel = "Export"
		}
		key := fmt.Sprintf("produktion.cat.%s.%s", typ, kat)
		perms[key+".view"] = typLabel + ": " + kat + " ansehen"
		perms[key+".edit"] = typLabel + ": " + kat + " bearbeiten"
	}
	return perms
}

// AllPermissions mirrors all_permissions().
func AllPermissions(prod store.ProductionData) map[string]string {
	all := make(map[string]string, len(RBPermissions))
	for k, v := range RBPermissions {
		all[k] = v
	}
	for k, v := range DynamicPermissions(prod) {
		all[k] = v
	}
	return all
}

func contains(list []string, v string) bool {
	for _, e := range list {
		if e == v {
			return true
		}
	}
	return false
}

// ExpandPermissions mirrors expand_permissions(): migrates legacy bare
// keys and pre-type-split category keys so old assignments keep working.
func ExpandPermissions(perms []string, prod store.ProductionData) []string {
	expanded := append([]string{}, perms...)

	for old, new := range legacyPermissions {
		if contains(perms, old) && !contains(expanded, new) {
			expanded = append(expanded, new)
		}
	}

	catTyp := map[string]string{}
	for _, p := range prod.Products {
		kat := strings.TrimSpace(p.Kategorie)
		if kat == "" {
			continue
		}
		catTyp[kat] = categoryType(p.Typ)
	}
	for _, p := range perms {
		m := legacyCategoryRe.FindStringSubmatch(p)
		if m == nil {
			continue
		}
		typ, ok := catTyp[m[1]]
		if !ok {
			continue
		}
		newKey := fmt.Sprintf("produktion.cat.%s.%s.%s", typ, m[1], m[2])
		if !contains(expanded, newKey) {
			expanded = append(expanded, newKey)
		}
	}

	return expanded
}

// HasPermission mirrors has_permission(): admin bypasses all checks,
// otherwise the (expanded) permission list is checked exactly.
func HasPermission(user *SessionUser, permission string, prod store.ProductionData) bool {
	if user == nil {
		return false
	}
	if user.Role == "admin" {
		return true
	}
	return contains(ExpandPermissions(user.Permissions, prod), permission)
}

// HasProdAccess mirrors has_prod_access(): true if the user holds ANY
// permission starting with "produktion." — checked against the raw
// (non-expanded) permission list, exactly like the PHP original.
func HasProdAccess(user *SessionUser) bool {
	if user == nil {
		return false
	}
	if user.Role == "admin" {
		return true
	}
	for _, p := range user.Permissions {
		if strings.HasPrefix(p, "produktion.") {
			return true
		}
	}
	return false
}
