package main

import (
	"log"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"resourcebay-framework/internal/app"
	"resourcebay-framework/internal/config"
)

// localAppDir returns the OS-appropriate per-user config directory for the
// local/desktop installation (e.g. %AppData%, ~/Library/Application
// Support, ~/.config), kept separate from any server-mode deployment.
func localAppDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "ResourceBayFramework")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	return dir, nil
}

func main() {
	dataDir, err := localAppDir()
	if err != nil {
		log.Fatalf("failed to resolve local app directory: %v", err)
	}

	cfg := config.New(dataDir, "", config.ModeLocal, filepath.Join(dataDir, "settings.json"))
	handler, err := app.NewHandler(cfg)
	if err != nil {
		log.Fatalf("failed to initialize app: %v", err)
	}

	err = wails.Run(&options.App{
		Title:  cfg.Settings().Branding.AppName,
		Width:  1400,
		Height: 900,
		AssetServer: &assetserver.Options{
			Handler: handler,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
