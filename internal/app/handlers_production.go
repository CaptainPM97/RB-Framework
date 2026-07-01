package app

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"resourcebay-framework/internal/auth"
	"resourcebay-framework/internal/store"
)

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func nowISO() string {
	return time.Now().Format(time.RFC3339)
}

func clamp(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func truncate(s string, n int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) > n {
		return string(r[:n])
	}
	return string(r)
}

var dateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// canEditProdCat mirrors _can_edit_prod_cat().
func (a *App) canEditProdCat(user *auth.SessionUser, kat, typ string, prod store.ProductionData) bool {
	if user == nil {
		return false
	}
	if user.Role == "admin" {
		return true
	}
	perms := auth.ExpandPermissions(user.Permissions, prod)
	for _, p := range perms {
		if p == "produktion.produkte.edit" {
			return true
		}
	}
	typKey := "fertig"
	if typ == "vorfertigt" {
		typKey = "vorfertigt"
	}
	key := "produktion.cat." + typKey + "." + kat + ".edit"
	for _, p := range perms {
		if p == key {
			return true
		}
	}
	return false
}

func (a *App) handleProductionAPI(w http.ResponseWriter, r *http.Request) {
	if origin := r.Header.Get("Origin"); origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Accept")
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
	user := sess.CurrentUser()

	if r.Method == http.MethodGet {
		data, err := a.Production.Load()
		if err != nil {
			a.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal Server Error"})
			return
		}
		a.writeJSON(w, http.StatusOK, data)
		return
	}

	if r.Method != http.MethodPost {
		a.writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method Not Allowed"})
		return
	}

	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body == nil {
		body = map[string]any{}
	}
	action, _ := body["action"].(string)

	data, err := a.Production.Load()
	if err != nil {
		a.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal Server Error"})
		return
	}

	forbidden := func() { a.writeJSON(w, http.StatusForbidden, map[string]string{"error": "Keine Berechtigung"}) }
	badRequest := func(msg string) { a.writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg}) }
	notFound := func(msg string) { a.writeJSON(w, http.StatusNotFound, map[string]string{"error": msg}) }

	str := func(k string) string { s, _ := body[k].(string); return s }
	num := func(k string) float64 { return toFloat(body[k]) }

	switch action {

	case "save_settings":
		if !auth.HasPermission(user, "produktion.produkte.edit", data) {
			forbidden()
			return
		}
		marge := clamp(num("defaultMarge"), 0, 99)
		if body["defaultMarge"] == nil {
			marge = 30
		}
		data.Settings.DefaultMarge = marge
		a.saveProdOrFail(w, data)

	case "save_rohstoff":
		if !auth.HasPermission(user, "produktion.rohstoffe.edit", data) {
			forbidden()
			return
		}
		id := str("id")
		name := truncate(str("name"), 100)
		if name == "" {
			badRequest("Name fehlt")
			return
		}
		einheit := str("einheit")
		if einheit == "" {
			einheit = "Stück"
		}
		entry := store.Rohstoff{Name: name, Einheit: truncate(einheit, 20), Preis: math.Max(0, num("preis"))}
		if id != "" {
			found := false
			for i := range data.Rohstoffe {
				if data.Rohstoffe[i].ID == id {
					entry.ID = id
					data.Rohstoffe[i] = entry
					found = true
					break
				}
			}
			if !found {
				notFound("Rohstoff nicht gefunden")
				return
			}
		} else {
			entry.ID = newID()
			data.Rohstoffe = append(data.Rohstoffe, entry)
		}
		a.saveProdOrFail(w, data)

	case "delete_rohstoff":
		if !auth.HasPermission(user, "produktion.rohstoffe.edit", data) {
			forbidden()
			return
		}
		id := str("id")
		for _, p := range data.Products {
			for _, z := range p.Zutaten {
				if z.RohstoffID == id {
					a.writeJSON(w, http.StatusConflict, map[string]string{"error": "Rohstoff wird in \"" + p.Name + "\" verwendet"})
					return
				}
			}
		}
		data.Rohstoffe = filterRohstoffe(data.Rohstoffe, id)
		a.saveProdOrFail(w, data)

	case "save_product":
		id := str("id")
		name := truncate(str("name"), 100)
		if name == "" {
			badRequest("Name fehlt")
			return
		}
		kat := strings.TrimSpace(str("kategorie"))
		typ := "fertig"
		if str("typ") == "vorfertigt" {
			typ = "vorfertigt"
		}
		if !a.canEditProdCat(user, kat, typ, data) {
			a.writeJSON(w, http.StatusForbidden, map[string]string{"error": "Keine Berechtigung für diese Kategorie"})
			return
		}
		if kat != "" {
			otherTyp := "vorfertigt"
			if typ == "vorfertigt" {
				otherTyp = "fertig"
			}
			for _, p := range data.Products {
				if p.ID == id {
					continue
				}
				pTyp := p.Typ
				if pTyp == "" {
					pTyp = "fertig"
				}
				if pTyp == otherTyp && strings.EqualFold(strings.TrimSpace(p.Kategorie), kat) {
					label := "Produkten"
					if otherTyp == "vorfertigt" {
						label = "Exportprodukten"
					}
					badRequest("Kategorie \"" + kat + "\" existiert bereits bei " + label + ".")
					return
				}
			}
		}

		var zutaten []store.Zutat
		if rawList, ok := body["zutaten"].([]any); ok {
			for _, raw := range rawList {
				zm, ok := raw.(map[string]any)
				if !ok {
					continue
				}
				menge := math.Max(0, toFloat(zm["menge"]))
				if menge <= 0 {
					continue
				}
				if rid, ok := zm["rohstoffId"].(string); ok && rid != "" {
					zutaten = append(zutaten, store.Zutat{RohstoffID: rid, Menge: menge})
				} else if pid, ok := zm["produktId"].(string); ok && pid != "" {
					zutaten = append(zutaten, store.Zutat{ProduktID: pid, Menge: menge})
				}
			}
		}

		var marge *float64
		if mr, ok := body["marge"]; ok && mr != nil && mr != "" {
			v := clamp(toFloat(mr), 0, 99)
			marge = &v
		}
		var exportPreis *float64
		if er, ok := body["exportPreis"]; ok && er != nil && er != "" {
			v := math.Max(0, toFloat(er))
			exportPreis = &v
		}

		einheit := str("einheit")
		if einheit == "" {
			einheit = "Stück"
		}
		outputMenge := math.Max(1, num("outputMenge"))
		if body["outputMenge"] == nil {
			outputMenge = 1
		}
		verwendungspreis := "prod"
		if str("verwendungspreis") == "gesamt" {
			verwendungspreis = "gesamt"
		}

		product := store.Product{
			Name:             name,
			Kategorie:        truncate(str("kategorie"), 60),
			Einheit:          truncate(einheit, 20),
			OutputMenge:      outputMenge,
			Typ:              typ,
			Marge:            marge,
			ExportPreis:      exportPreis,
			Verwendungspreis: verwendungspreis,
			Zutaten:          zutaten,
		}

		if id != "" {
			found := false
			for i := range data.Products {
				if data.Products[i].ID == id {
					product.ID = id
					product.CreatedAt = data.Products[i].CreatedAt
					if product.CreatedAt == "" {
						product.CreatedAt = nowISO()
					}
					product.UpdatedAt = nowISO()
					data.Products[i] = product
					found = true
					break
				}
			}
			if !found {
				notFound("Produkt nicht gefunden")
				return
			}
		} else {
			product.ID = newID()
			product.CreatedAt = nowISO()
			product.UpdatedAt = nowISO()
			data.Products = append(data.Products, product)
		}
		a.saveProdOrFail(w, data)

	case "delete_product":
		id := str("id")
		var target *store.Product
		for i := range data.Products {
			if data.Products[i].ID == id {
				target = &data.Products[i]
				break
			}
		}
		if target != nil {
			typ := target.Typ
			if typ == "" {
				typ = "fertig"
			}
			if !a.canEditProdCat(user, strings.TrimSpace(target.Kategorie), typ, data) {
				a.writeJSON(w, http.StatusForbidden, map[string]string{"error": "Keine Berechtigung für diese Kategorie"})
				return
			}
		}
		for _, p := range data.Products {
			if p.ID == id {
				continue
			}
			for _, z := range p.Zutaten {
				if z.ProduktID == id {
					a.writeJSON(w, http.StatusConflict, map[string]string{"error": "Produkt wird in \"" + p.Name + "\" verwendet"})
					return
				}
			}
		}
		data.Products = filterProducts(data.Products, id)
		a.saveProdOrFail(w, data)

	case "save_einkauf":
		if !auth.HasPermission(user, "produktion.rohstoffe.edit", data) {
			forbidden()
			return
		}
		id := str("id")
		datum := str("datum")
		if !dateRe.MatchString(datum) {
			datum = time.Now().Format("2006-01-02")
		}

		var oldPosten []store.EinkaufPosten
		if id != "" {
			for _, e := range data.Einkaeufe {
				if e.ID == id {
					oldPosten = e.Posten
					break
				}
			}
		}

		var posten []store.EinkaufPosten
		if rawList, ok := body["posten"].([]any); ok {
			for i, raw := range rawList {
				pm, ok := raw.(map[string]any)
				if !ok {
					continue
				}
				menge := math.Max(0, toFloat(pm["menge"]))
				preis := math.Max(0, toFloat(pm["preis"]))
				rid, _ := pm["rohstoffId"].(string)
				pid, _ := pm["produktId"].(string)
				if menge <= 0 || (rid == "" && pid == "") {
					continue
				}
				bezahlt := false
				if bv, ok := pm["bezahlt"]; ok {
					bezahlt, _ = bv.(bool)
				} else if i < len(oldPosten) {
					bezahlt = oldPosten[i].Bezahlt
				}
				entryPos := store.EinkaufPosten{Menge: menge, Preis: preis, Bezahlt: bezahlt}
				if rid != "" {
					entryPos.RohstoffID = rid
				} else {
					entryPos.ProduktID = pid
				}
				posten = append(posten, entryPos)
			}
		}
		if len(posten) == 0 {
			badRequest("Mindestens ein Posten erforderlich")
			return
		}

		entry := store.Einkauf{
			Datum:     datum,
			Lieferant: truncate(str("lieferant"), 100),
			Vban:      truncate(str("vban"), 30),
			Notiz:     truncate(str("notiz"), 500),
			Posten:    posten,
		}
		if id != "" {
			found := false
			for i := range data.Einkaeufe {
				if data.Einkaeufe[i].ID == id {
					entry.ID = id
					entry.CreatedAt = data.Einkaeufe[i].CreatedAt
					if entry.CreatedAt == "" {
						entry.CreatedAt = nowISO()
					}
					entry.UpdatedAt = nowISO()
					data.Einkaeufe[i] = entry
					found = true
					break
				}
			}
			if !found {
				notFound("Einkauf nicht gefunden")
				return
			}
		} else {
			entry.ID = newID()
			entry.CreatedAt = nowISO()
			entry.UpdatedAt = nowISO()
			data.Einkaeufe = append(data.Einkaeufe, entry)
		}
		if err := a.Production.Save(data); err != nil {
			a.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal Server Error"})
			return
		}
		a.writeJSON(w, http.StatusOK, map[string]any{"ok": true, "entry": entry})

	case "delete_einkauf":
		if !auth.HasPermission(user, "produktion.rohstoffe.edit", data) {
			forbidden()
			return
		}
		id := str("id")
		out := data.Einkaeufe[:0]
		for _, e := range data.Einkaeufe {
			if e.ID != id {
				out = append(out, e)
			}
		}
		data.Einkaeufe = out
		a.saveProdOrFail(w, data)

	case "toggle_einkauf_bezahlt":
		if !auth.HasPermission(user, "produktion.rohstoffe.edit", data) {
			forbidden()
			return
		}
		id := str("id")
		idx := int(num("postenIndex"))
		found := false
		for i := range data.Einkaeufe {
			if data.Einkaeufe[i].ID == id && idx >= 0 && idx < len(data.Einkaeufe[i].Posten) {
				data.Einkaeufe[i].Posten[idx].Bezahlt = !data.Einkaeufe[i].Posten[idx].Bezahlt
				data.Einkaeufe[i].UpdatedAt = nowISO()
				found = true
				break
			}
		}
		if !found {
			notFound("Posten nicht gefunden")
			return
		}
		a.saveProdOrFail(w, data)

	case "save_bestellung":
		items := parseBestellItems(body["items"])
		if len(items) == 0 {
			badRequest("Keine Artikel")
			return
		}
		entry := store.Bestellung{
			ID:         newID(),
			SavedAt:    nowISO(),
			Kundenname: truncate(str("kundenname"), 100),
			Rabatt:     clamp(num("rabatt"), 0, 100),
			Items:      items,
		}
		data.Bestellungen = append([]store.Bestellung{entry}, data.Bestellungen...)
		if err := a.Production.Save(data); err != nil {
			a.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal Server Error"})
			return
		}
		a.writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": entry.ID})

	case "update_bestellung":
		id := str("id")
		if id == "" {
			badRequest("ID fehlt")
			return
		}
		items := parseBestellItems(body["items"])
		if len(items) == 0 {
			badRequest("Keine Artikel")
			return
		}
		found := false
		for i := range data.Bestellungen {
			if data.Bestellungen[i].ID == id {
				data.Bestellungen[i].Kundenname = truncate(str("kundenname"), 100)
				data.Bestellungen[i].Rabatt = clamp(num("rabatt"), 0, 100)
				data.Bestellungen[i].Items = items
				data.Bestellungen[i].UpdatedAt = nowISO()
				found = true
				break
			}
		}
		if !found {
			notFound("Nicht gefunden")
			return
		}
		a.saveProdOrFail(w, data)

	case "delete_bestellung":
		id := str("id")
		out := data.Bestellungen[:0]
		for _, b := range data.Bestellungen {
			if b.ID != id {
				out = append(out, b)
			}
		}
		data.Bestellungen = out
		a.saveProdOrFail(w, data)

	default:
		badRequest("Unbekannte Aktion: " + action)
	}
}

func (a *App) saveProdOrFail(w http.ResponseWriter, data store.ProductionData) {
	if err := a.Production.Save(data); err != nil {
		a.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal Server Error"})
		return
	}
	a.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func filterRohstoffe(list []store.Rohstoff, excludeID string) []store.Rohstoff {
	out := list[:0]
	for _, r := range list {
		if r.ID != excludeID {
			out = append(out, r)
		}
	}
	return out
}

func filterProducts(list []store.Product, excludeID string) []store.Product {
	out := list[:0]
	for _, p := range list {
		if p.ID != excludeID {
			out = append(out, p)
		}
	}
	return out
}

func parseBestellItems(raw any) []store.BestellItem {
	list, ok := raw.([]any)
	if !ok {
		return nil
	}
	var items []store.BestellItem
	for _, r := range list {
		m, ok := r.(map[string]any)
		if !ok {
			continue
		}
		pid, _ := m["productId"].(string)
		if pid == "" {
			continue
		}
		qty := math.Max(1, toFloat(m["qty"]))
		items = append(items, store.BestellItem{ProductID: pid, Qty: qty})
	}
	return items
}

// toFloat mirrors PHP's lenient (float) cast: numbers pass through,
// numeric strings are parsed, everything else becomes 0.
func toFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(t), 64)
		if err != nil {
			return 0
		}
		return f
	}
	return 0
}
