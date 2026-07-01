package main

import (
	"flag"
	"log"
	"net/http"
	"path/filepath"

	"resourcebay-framework/internal/app"
	"resourcebay-framework/internal/config"
)

func main() {
	dataDir := flag.String("data-dir", "./data", "directory for users.json/production.json/contracts.json")
	listenAddr := flag.String("listen", ":8080", "address to listen on")
	configPath := flag.String("config", "", "path to settings.json (default: <data-dir>/settings.json)")
	flag.Parse()

	cfgPath := *configPath
	if cfgPath == "" {
		cfgPath = filepath.Join(*dataDir, "settings.json")
	}

	cfg := config.New(*dataDir, *listenAddr, config.ModeServer, cfgPath)
	handler, err := app.NewHandler(cfg)
	if err != nil {
		log.Fatalf("failed to initialize app: %v", err)
	}

	log.Printf("listening on %s (data dir: %s)", *listenAddr, *dataDir)
	if err := http.ListenAndServe(*listenAddr, handler); err != nil {
		log.Fatal(err)
	}
}
