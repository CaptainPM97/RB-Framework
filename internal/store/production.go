package store

type ProductionSettings struct {
	DefaultMarge float64 `json:"defaultMarge"`
}

type Rohstoff struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Einheit string  `json:"einheit"`
	Preis   float64 `json:"preis"`
}

// Zutat references either a Rohstoff or another Product (recursive
// ingredient support), exactly one of RohstoffID/ProduktID is set.
type Zutat struct {
	RohstoffID string  `json:"rohstoffId,omitempty"`
	ProduktID  string  `json:"produktId,omitempty"`
	Menge      float64 `json:"menge"`
}

type Product struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Kategorie        string   `json:"kategorie"`
	Einheit          string   `json:"einheit"`
	OutputMenge      float64  `json:"outputMenge"`
	Typ              string   `json:"typ"` // "fertig" | "vorfertigt"
	Marge            *float64 `json:"marge"`
	ExportPreis      *float64 `json:"exportPreis"`
	Verwendungspreis string   `json:"verwendungspreis"`
	Zutaten          []Zutat  `json:"zutaten"`
	CreatedAt        string   `json:"createdAt"`
	UpdatedAt        string   `json:"updatedAt"`
}

type BestellItem struct {
	ProductID string  `json:"productId"`
	Qty       float64 `json:"qty"`
}

type Bestellung struct {
	ID         string        `json:"id"`
	Kundenname string        `json:"kundenname"`
	Rabatt     float64       `json:"rabatt"`
	Items      []BestellItem `json:"items"`
	SavedAt    string        `json:"savedAt"`
	UpdatedAt  string        `json:"updatedAt"`
}

type EinkaufPosten struct {
	RohstoffID string  `json:"rohstoffId,omitempty"`
	ProduktID  string  `json:"produktId,omitempty"`
	Menge      float64 `json:"menge"`
	Preis      float64 `json:"preis"`
	Bezahlt    bool    `json:"bezahlt"`
}

type Einkauf struct {
	ID        string          `json:"id"`
	Datum     string          `json:"datum"`
	Lieferant string          `json:"lieferant"`
	Vban      string          `json:"vban"`
	Notiz     string          `json:"notiz"`
	Posten    []EinkaufPosten `json:"posten"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
}

type ProductionData struct {
	Settings     ProductionSettings `json:"settings"`
	Rohstoffe    []Rohstoff         `json:"rohstoffe"`
	Products     []Product          `json:"products"`
	Bestellungen []Bestellung       `json:"bestellungen"`
	Einkaeufe    []Einkauf          `json:"einkaeufe"`
}

// ProductionStore persists data/production.json as a whole-document
// read-modify-write, mirroring the PHP original at this data scale.
type ProductionStore struct {
	guard *fileGuard
}

func NewProductionStore(path string) *ProductionStore {
	return &ProductionStore{guard: newFileGuard(path)}
}

func (s *ProductionStore) Load() (ProductionData, error) {
	data := ProductionData{
		Settings:     ProductionSettings{DefaultMarge: 30},
		Rohstoffe:    []Rohstoff{},
		Products:     []Product{},
		Bestellungen: []Bestellung{},
		Einkaeufe:    []Einkauf{},
	}
	if err := s.guard.read(&data); err != nil {
		return data, err
	}
	return data, nil
}

func (s *ProductionStore) Save(data ProductionData) error {
	return s.guard.write(data)
}
