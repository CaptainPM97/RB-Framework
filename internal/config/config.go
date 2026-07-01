// Package config holds per-instance settings: branding, theme and the
// StateV vAPI credentials. Nothing here ships with real values — every
// field starts empty or as a generic cosmetic placeholder and is filled
// in by the operator via the settings screen.
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type Mode string

const (
	ModeServer Mode = "server"
	ModeLocal  Mode = "local"
)

type Branding struct {
	AppName        string `json:"appName"`
	Subtitle       string `json:"subtitle"`
	LogoInitials   string `json:"logoInitials"`
	ContractPrefix string `json:"contractPrefix"`
	Website1Label  string `json:"website1Label"`
	Website1URL    string `json:"website1Url"`
	Website2Label  string `json:"website2Label"`
	Website2URL    string `json:"website2Url"`
}

type Theme struct {
	Primary         string `json:"primary"`
	BgGradientStart string `json:"bgGradientStart"`
	BgGradientEnd   string `json:"bgGradientEnd"`
	TextMain        string `json:"textMain"`
	TextMuted       string `json:"textMuted"`
	TextDark        string `json:"textDark"`
}

// VAPI holds only the operator's own credentials. The API base URL is not
// configurable — it's a fixed address (see internal/vapi.BaseURL), not
// per-operator data.
type VAPI struct {
	Key    string `json:"key"`
	Secret string `json:"secret"`
}

// Team holds the address of a shared team server (see internal/serverdist)
// that this local/desktop instance points people at — purely a UI
// convenience (opens the URL in the system browser), no data or
// credentials are ever proxied or stored beyond the plain address.
type Team struct {
	ServerURL string `json:"serverUrl"`
}

// Feedback holds where the in-app "report a bug / suggest an improvement"
// form should send people — opened as a pre-filled GitHub "new issue" URL
// in the browser (no API token stored or embedded anywhere). Defaults to
// this framework's own repo but stays editable so a fork can point it at
// their own.
type Feedback struct {
	RepoURL string `json:"repoUrl"`
}

// Settings is the part of the configuration the operator edits via the
// settings screen and that gets persisted to disk.
type Settings struct {
	Branding Branding `json:"branding"`
	Theme    Theme    `json:"theme"`
	VAPI     VAPI     `json:"vapi"`
	Team     Team     `json:"team"`
	Feedback Feedback `json:"feedback"`
}

// DefaultSettings returns generic, cosmetic placeholders only — never
// real credentials or branding belonging to a specific operator.
func DefaultSettings() Settings {
	return Settings{
		Branding: Branding{
			AppName:      "ResourceBay Framework",
			Subtitle:     "Internes Backoffice",
			LogoInitials: "RB",
		},
		Theme: Theme{
			Primary:         "#f97316",
			BgGradientStart: "#1e1e2f",
			BgGradientEnd:   "#0f0f15",
			TextMain:        "#f1f5f9",
			TextMuted:       "#94a3b8",
			TextDark:        "#64748b",
		},
		Feedback: Feedback{
			RepoURL: "https://github.com/CaptainPM97/RB-Framework",
		},
	}
}

// ContractPrefix returns the configured prefix, falling back to the logo
// initials when unset.
func (s Settings) ContractPrefix() string {
	if s.Branding.ContractPrefix != "" {
		return s.Branding.ContractPrefix
	}
	if s.Branding.LogoInitials != "" {
		return s.Branding.LogoInitials
	}
	return "RB"
}

// Config bundles runtime (flag-provided) settings with the persisted,
// operator-editable Settings.
type Config struct {
	DataDir    string
	ListenAddr string
	Mode       Mode
	configPath string

	mu       sync.RWMutex
	settings Settings
}

func New(dataDir, listenAddr string, mode Mode, configPath string) *Config {
	return &Config{
		DataDir:    dataDir,
		ListenAddr: listenAddr,
		Mode:       mode,
		configPath: configPath,
		settings:   DefaultSettings(),
	}
}

// Load reads settings.json if present; a missing file is not an error
// (fresh install), the generic defaults stay in effect.
func (c *Config) Load() error {
	data, err := os.ReadFile(c.configPath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var s Settings
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	c.mu.Lock()
	c.settings = s
	c.mu.Unlock()
	return nil
}

func (c *Config) Settings() Settings {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.settings
}

func (c *Config) Save(s Settings) error {
	dir := filepath.Dir(c.configPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".settings-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}
	if err := os.Chmod(tmpPath, 0600); err != nil {
		os.Remove(tmpPath)
		return err
	}
	if err := os.Rename(tmpPath, c.configPath); err != nil {
		return err
	}
	c.mu.Lock()
	c.settings = s
	c.mu.Unlock()
	return nil
}

// HasVAPIKey reports whether the operator has entered a vAPI key yet.
func (c *Config) HasVAPIKey() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.settings.VAPI.Key != ""
}
