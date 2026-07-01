package app

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"resourcebay-framework/internal/auth"
	"resourcebay-framework/internal/store"
)

var timeRe = regexp.MustCompile(`^\d{2}:\d{2}$`)
var trailingNumRe = regexp.MustCompile(`(\d+)$`)

func sanitizeTarife(raw any) []store.Tarif {
	list, ok := raw.([]any)
	if !ok {
		return []store.Tarif{}
	}
	if len(list) > 4 {
		list = list[:4]
	}
	out := make([]store.Tarif, 0, len(list))
	for _, r := range list {
		m, ok := r.(map[string]any)
		if !ok {
			continue
		}
		name, _ := m["name"].(string)
		out = append(out, store.Tarif{
			Name:   truncate(name, 100),
			Betrag: maxFloat(0, toFloat(m["betrag"])),
		})
	}
	return out
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func toInt(v any) int {
	return int(toFloat(v))
}

func (a *App) handleContractsAPI(w http.ResponseWriter, r *http.Request) {
	sess := a.session(r)
	if !sess.LoggedIn() {
		a.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}
	user := sess.CurrentUser()
	action := r.URL.Query().Get("action")

	if r.Method == http.MethodGet && action == "all" {
		data, err := a.Contracts.Load()
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

	prod, err := a.Production.Load()
	if err != nil {
		a.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal Server Error"})
		return
	}

	writePerms := map[string]string{
		"save_template":      "vertraege.vorlagen.edit",
		"delete_template":    "vertraege.vorlagen.edit",
		"save_firm_config":   "firmen.edit",
		"delete_firm_config": "firmen.edit",
		"delete_contract":    "vertraege.edit",
		"save_vehicle":       "fahrzeuge.edit",
		"delete_vehicle":     "fahrzeuge.edit",
	}
	if perm, needed := writePerms[action]; needed && !auth.HasPermission(user, perm, prod) {
		a.writeJSON(w, http.StatusForbidden, map[string]string{"error": "Keine Berechtigung"})
		return
	}
	if action == "save_contract" {
		id, _ := body["id"].(string)
		isNew := id == ""
		allowed := auth.HasPermission(user, "vertraege.edit", prod)
		if isNew {
			allowed = auth.HasPermission(user, "vertraege.create", prod) || allowed
		}
		if !allowed {
			a.writeJSON(w, http.StatusForbidden, map[string]string{"error": "Keine Berechtigung"})
			return
		}
	}

	data, err := a.Contracts.Load()
	if err != nil {
		a.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal Server Error"})
		return
	}

	badRequest := func(msg string) { a.writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg}) }
	notFound := func(msg string) { a.writeJSON(w, http.StatusNotFound, map[string]string{"error": msg}) }
	str := func(k string) string { s, _ := body[k].(string); return s }

	switch action {

	case "save_template":
		id := str("id")
		name := strings.TrimSpace(str("name"))
		typ := str("type")
		text := str("text")
		if name == "" {
			badRequest("Name fehlt")
			return
		}
		if len([]rune(name)) > 200 {
			badRequest("Name zu lang")
			return
		}
		if len([]rune(text)) > 30000 {
			badRequest("Text zu lang")
			return
		}
		if typ != "vermietung" && typ != "verpachtung" && typ != "kooperation" {
			typ = "vermietung"
		}
		if id != "" {
			found := false
			for i := range data.Templates {
				if data.Templates[i].ID == id {
					data.Templates[i].Name = name
					data.Templates[i].Type = typ
					data.Templates[i].Text = text
					data.Templates[i].UpdatedAt = nowISO()
					found = true
					break
				}
			}
			if !found {
				notFound("Vorlage nicht gefunden")
				return
			}
		} else {
			data.Templates = append(data.Templates, store.Template{
				ID: newID(), Name: name, Type: typ, Text: text,
				CreatedAt: nowISO(), UpdatedAt: nowISO(),
			})
		}
		a.saveContractsOrFail(w, data)

	case "delete_template":
		id := str("id")
		out := data.Templates[:0]
		for _, t := range data.Templates {
			if t.ID != id {
				out = append(out, t)
			}
		}
		data.Templates = out
		a.saveContractsOrFail(w, data)

	case "save_firm_config":
		id := str("id")
		name := truncate(str("name"), 200)
		if name == "" {
			badRequest("Firmenname fehlt")
			return
		}
		entry := store.FirmConfig{
			Name:    name,
			Kaution: maxFloat(0, toFloat(body["kaution"])),
			Menge:   maxInt(1, toInt(body["menge"])),
			Tarife:  sanitizeTarife(body["tarife"]),
		}
		if body["menge"] == nil {
			entry.Menge = 1
		}
		if id != "" {
			found := false
			for i := range data.FirmConfigs {
				if data.FirmConfigs[i].ID == id {
					entry.ID = id
					entry.CreatedAt = data.FirmConfigs[i].CreatedAt
					entry.UpdatedAt = data.FirmConfigs[i].UpdatedAt
					data.FirmConfigs[i] = entry
					found = true
					break
				}
			}
			if !found {
				notFound("Firma nicht gefunden")
				return
			}
		} else {
			entry.ID = newID()
			entry.CreatedAt = nowISO()
			entry.UpdatedAt = nowISO()
			data.FirmConfigs = append(data.FirmConfigs, entry)
		}
		a.saveContractsOrFail(w, data)

	case "delete_firm_config":
		id := str("id")
		out := data.FirmConfigs[:0]
		for _, fc := range data.FirmConfigs {
			if fc.ID != id {
				out = append(out, fc)
			}
		}
		data.FirmConfigs = out
		a.saveContractsOrFail(w, data)

	case "save_contract":
		id := str("id")
		typ := str("type")
		if typ != "vermietung" && typ != "kooperation" && typ != "verpachtung" {
			typ = "vermietung"
		}
		status := str("status")
		switch status {
		case "active", "upcoming", "expired", "terminated":
		default:
			status = "active"
		}

		var selectedFirmen []store.SelectedFirma
		if list, ok := body["selectedFirmen"].([]any); ok {
			for _, r := range list {
				fm, ok := r.(map[string]any)
				if !ok {
					continue
				}
				betrag := maxFloat(0, toFloat(fm["betrag"]))
				baseBetrag := toFloat(fm["baseBetrag"])
				if fm["baseBetrag"] == nil {
					baseBetrag = betrag
				}
				fid, _ := fm["firmaId"].(string)
				fname, _ := fm["firmaName"].(string)
				tname, _ := fm["tarifName"].(string)
				selectedFirmen = append(selectedFirmen, store.SelectedFirma{
					FirmaID: truncate(fid, 64), FirmaName: truncate(fname, 200),
					TarifName: truncate(tname, 100), BaseBetrag: maxFloat(0, baseBetrag),
					CoMieter: minInt(4, maxInt(0, toInt(fm["coMieter"]))), Betrag: betrag,
				})
			}
		}
		var selectedVehicles []store.SelectedVehicle
		if list, ok := body["selectedVehicles"].([]any); ok {
			for _, r := range list {
				vm, ok := r.(map[string]any)
				if !ok {
					continue
				}
				betrag := maxFloat(0, toFloat(vm["betrag"]))
				baseBetrag := toFloat(vm["baseBetrag"])
				if vm["baseBetrag"] == nil {
					baseBetrag = betrag
				}
				vid, _ := vm["vehicleId"].(string)
				vname, _ := vm["vehicleName"].(string)
				kz, _ := vm["kennzeichen"].(string)
				tname, _ := vm["tarifName"].(string)
				isTrailer, _ := vm["isTrailer"].(bool)
				selectedVehicles = append(selectedVehicles, store.SelectedVehicle{
					VehicleID: truncate(vid, 64), VehicleName: truncate(vname, 200),
					Kennzeichen: truncate(kz, 30), TarifName: truncate(tname, 100),
					BaseBetrag: maxFloat(0, baseBetrag), CoMieter: minInt(2, maxInt(0, toInt(vm["coMieter"]))),
					Betrag: betrag, IsTrailer: isTrailer,
				})
			}
		}

		startDate := str("startDate")
		if !dateRe.MatchString(startDate) {
			startDate = ""
		}
		startTime := str("startTime")
		if !timeRe.MatchString(startTime) {
			startTime = "00:00"
		}
		endDate := str("endDate")
		if !dateRe.MatchString(endDate) {
			endDate = ""
		}
		zahlungsstatus := str("zahlungsstatus")
		switch zahlungsstatus {
		case "offen", "bezahlt", "ueberfaellig":
		default:
			zahlungsstatus = "offen"
		}
		kautionStatus := str("kautionStatus")
		if kautionStatus != "erhalten" && kautionStatus != "zurueck" {
			kautionStatus = ""
		}
		kooperationsrabatt, _ := body["kooperationsrabatt"].(bool)

		mieterName := truncate(str("mieterName"), 200)
		if mieterName == "" {
			badRequest("Mietername fehlt")
			return
		}
		if startDate == "" {
			badRequest("Startdatum fehlt")
			return
		}

		if id != "" {
			found := false
			for i := range data.Contracts {
				if data.Contracts[i].ID == id {
					c := &data.Contracts[i]
					if c.EndDate != "" && c.EndDate != endDate && endDate != "" {
						c.RenewalHistory = append(c.RenewalHistory, store.RenewalEntry{
							PreviousEndDate: c.EndDate, NewEndDate: endDate, UpdatedAt: nowISO(),
						})
					}
					c.Type = typ
					c.Status = status
					c.TemplateID = str("templateId")
					c.MieterName = mieterName
					c.MieterVban = truncate(str("mieterVban"), 20)
					c.StartDate = startDate
					c.StartTime = startTime
					c.EndDate = endDate
					c.EinnahmeKontoVban = truncate(str("einnahmeKontoVban"), 20)
					c.Garage = truncate(str("garage"), 200)
					c.Kaution = maxFloat(0, toFloat(body["kaution"]))
					c.SelectedFirmen = selectedFirmen
					c.SelectedVehicles = selectedVehicles
					c.Kooperationsrabatt = kooperationsrabatt
					c.Gesamtbetrag = maxFloat(0, toFloat(body["gesamtbetrag"]))
					c.Notes = truncate(str("notes"), 3000)
					c.Zahlungsstatus = zahlungsstatus
					c.KautionStatus = kautionStatus
					c.UpdatedAt = nowISO()
					found = true
					break
				}
			}
			if !found {
				notFound("Vertrag nicht gefunden")
				return
			}
		} else {
			maxNum := 0
			for _, ex := range data.Contracts {
				if m := trailingNumRe.FindStringSubmatch(ex.Vertragsnummer); m != nil {
					if n, err := strconv.Atoi(m[1]); err == nil && n > maxNum {
						maxNum = n
					}
				}
			}
			settings := a.Cfg.Settings()
			vertragsnummer := settings.ContractPrefix() + "#" + padLeft(maxNum+1, 3)

			data.Contracts = append(data.Contracts, store.Contract{
				ID: newID(), Vertragsnummer: vertragsnummer, Type: typ, Status: status,
				TemplateID: str("templateId"), MieterName: mieterName, MieterVban: truncate(str("mieterVban"), 20),
				StartDate: startDate, StartTime: startTime, EndDate: endDate,
				EinnahmeKontoVban: truncate(str("einnahmeKontoVban"), 20), Garage: truncate(str("garage"), 200),
				Kaution: maxFloat(0, toFloat(body["kaution"])), SelectedFirmen: selectedFirmen, SelectedVehicles: selectedVehicles,
				Kooperationsrabatt: kooperationsrabatt, Gesamtbetrag: maxFloat(0, toFloat(body["gesamtbetrag"])),
				Notes: truncate(str("notes"), 3000), Zahlungsstatus: zahlungsstatus, KautionStatus: kautionStatus,
				RenewalHistory: []store.RenewalEntry{}, CreatedAt: nowISO(), UpdatedAt: nowISO(),
			})
		}
		a.saveContractsOrFail(w, data)

	case "delete_contract":
		id := str("id")
		out := data.Contracts[:0]
		for _, c := range data.Contracts {
			if c.ID != id {
				out = append(out, c)
			}
		}
		data.Contracts = out
		a.saveContractsOrFail(w, data)

	case "save_vehicle":
		id := str("id")
		name := strings.TrimSpace(str("name"))
		if name == "" {
			badRequest("Fahrzeugname fehlt")
			return
		}
		if len([]rune(name)) > 100 {
			badRequest("Name zu lang")
			return
		}
		isTrailer, _ := body["isTrailer"].(bool)
		menge := maxInt(1, toInt(body["menge"]))
		if body["menge"] == nil {
			menge = 1
		}

		var rawKz []string
		switch v := body["kennzeichen"].(type) {
		case string:
			rawKz = []string{v}
		case []any:
			for _, k := range v {
				if s, ok := k.(string); ok {
					rawKz = append(rawKz, s)
				}
			}
		}
		if len(rawKz) > menge {
			rawKz = rawKz[:menge]
		}
		kennzeichen := make([]string, 0, menge)
		for _, kz := range rawKz {
			kennzeichen = append(kennzeichen, truncate(kz, 30))
		}
		for len(kennzeichen) < menge {
			kennzeichen = append(kennzeichen, "")
		}

		vehicle := store.Vehicle{
			Name: name, Kennzeichen: kennzeichen, Kategorie: truncate(str("kategorie"), 60),
			IsTrailer: isTrailer, Kaution: maxFloat(0, toFloat(body["kaution"])),
			Tarife: sanitizeTarife(body["tarife"]), Menge: menge,
		}
		if id != "" {
			found := false
			for i := range data.Vehicles {
				if data.Vehicles[i].ID == id {
					createdAt := data.Vehicles[i].CreatedAt
					vehicle.ID = id
					vehicle.CreatedAt = createdAt
					vehicle.UpdatedAt = nowISO()
					data.Vehicles[i] = vehicle
					found = true
					break
				}
			}
			if !found {
				notFound("Fahrzeug nicht gefunden")
				return
			}
		} else {
			vehicle.ID = newID()
			vehicle.CreatedAt = nowISO()
			vehicle.UpdatedAt = nowISO()
			data.Vehicles = append(data.Vehicles, vehicle)
		}
		a.saveContractsOrFail(w, data)

	case "delete_vehicle":
		id := str("id")
		out := data.Vehicles[:0]
		for _, v := range data.Vehicles {
			if v.ID != id {
				out = append(out, v)
			}
		}
		data.Vehicles = out
		a.saveContractsOrFail(w, data)

	case "save_setting":
		key := str("key")
		value := truncate(str("value"), 200)
		switch key {
		case "buildingHash":
			data.BuildingHash = value
		case "buildingId":
			data.BuildingID = value
		default:
			badRequest("Unbekannter Schlüssel")
			return
		}
		a.saveContractsOrFail(w, data)

	default:
		badRequest("Unbekannte Aktion")
	}
}

func (a *App) saveContractsOrFail(w http.ResponseWriter, data store.ContractsData) {
	if err := a.Contracts.Save(data); err != nil {
		a.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Internal Server Error"})
		return
	}
	a.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func padLeft(n, width int) string {
	s := strconv.Itoa(n)
	for len(s) < width {
		s = "0" + s
	}
	return s
}
