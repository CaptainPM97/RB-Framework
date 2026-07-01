package store

type Template struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Text      string `json:"text"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type SelectedFirma struct {
	FirmaID    string  `json:"firmaId"`
	FirmaName  string  `json:"firmaName"`
	TarifName  string  `json:"tarifName"`
	BaseBetrag float64 `json:"baseBetrag"`
	CoMieter   int     `json:"coMieter"`
	Betrag     float64 `json:"betrag"`
}

type SelectedVehicle struct {
	VehicleID   string  `json:"vehicleId"`
	VehicleName string  `json:"vehicleName"`
	Kennzeichen string  `json:"kennzeichen"`
	TarifName   string  `json:"tarifName"`
	BaseBetrag  float64 `json:"baseBetrag"`
	CoMieter    int     `json:"coMieter"`
	Betrag      float64 `json:"betrag"`
	IsTrailer   bool    `json:"isTrailer"`
}

type RenewalEntry struct {
	PreviousEndDate string `json:"previousEndDate"`
	NewEndDate      string `json:"newEndDate"`
	UpdatedAt       string `json:"updatedAt"`
}

type Contract struct {
	ID                 string            `json:"id"`
	Vertragsnummer     string            `json:"vertragsnummer"`
	Type               string            `json:"type"` // vermietung|verpachtung|kooperation
	Status             string            `json:"status"`
	TemplateID         string            `json:"templateId,omitempty"`
	MieterName         string            `json:"mieterName"`
	MieterVban         string            `json:"mieterVban"`
	StartDate          string            `json:"startDate"`
	StartTime          string            `json:"startTime"`
	EndDate            string            `json:"endDate"`
	Garage             string            `json:"garage"`
	SelectedFirmen     []SelectedFirma   `json:"selectedFirmen"`
	SelectedVehicles   []SelectedVehicle `json:"selectedVehicles"`
	EinnahmeKontoVban  string            `json:"einnahmeKontoVban"`
	Kaution            float64           `json:"kaution"`
	Kooperationsrabatt bool              `json:"kooperationsrabatt"`
	Gesamtbetrag       float64           `json:"gesamtbetrag"`
	Notes              string            `json:"notes"`
	Zahlungsstatus     string            `json:"zahlungsstatus"`
	KautionStatus      string            `json:"kautionStatus,omitempty"`
	RenewalHistory     []RenewalEntry    `json:"renewalHistory"`
	CreatedAt          string            `json:"createdAt"`
	UpdatedAt          string            `json:"updatedAt"`
}

type Tarif struct {
	Name   string  `json:"name"`
	Betrag float64 `json:"betrag"`
}

type Vehicle struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Kennzeichen []string `json:"kennzeichen"`
	Kategorie   string   `json:"kategorie"`
	IsTrailer   bool     `json:"isTrailer"`
	Kaution     float64  `json:"kaution"`
	Menge       int      `json:"menge"`
	Tarife      []Tarif  `json:"tarife"`
	CreatedAt   string   `json:"createdAt"`
	UpdatedAt   string   `json:"updatedAt"`
}

type FirmConfig struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Kaution   float64 `json:"kaution"`
	Menge     int     `json:"menge"`
	Tarife    []Tarif `json:"tarife"`
	CreatedAt string  `json:"createdAt"`
	UpdatedAt string  `json:"updatedAt"`
}

type ContractsData struct {
	Templates    []Template   `json:"templates"`
	Contracts    []Contract   `json:"contracts"`
	Vehicles     []Vehicle    `json:"vehicles"`
	FirmConfigs  []FirmConfig `json:"firmConfigs"`
	BuildingHash string       `json:"buildingHash"`
	BuildingID   string       `json:"buildingId,omitempty"`
}

// ContractsStore persists data/contracts.json as a whole-document
// read-modify-write, mirroring the PHP original at this data scale.
type ContractsStore struct {
	guard *fileGuard
}

func NewContractsStore(path string) *ContractsStore {
	return &ContractsStore{guard: newFileGuard(path)}
}

func (s *ContractsStore) Load() (ContractsData, error) {
	data := ContractsData{
		Templates:   []Template{},
		Contracts:   []Contract{},
		Vehicles:    []Vehicle{},
		FirmConfigs: []FirmConfig{},
	}
	if err := s.guard.read(&data); err != nil {
		return data, err
	}
	return data, nil
}

func (s *ContractsStore) Save(data ContractsData) error {
	return s.guard.write(data)
}
