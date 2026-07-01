.PHONY: server server-dist desktop-mac desktop-windows desktop-all run-server run-desktop-mac

WAILS := $(shell command -v wails 2> /dev/null || echo "$(shell go env GOPATH)/bin/wails")
VERSION := $(shell cat VERSION 2> /dev/null || echo dev)
LDFLAGS_VERSION := -X resourcebay-framework/internal/buildinfo.Version=$(VERSION)

server:
	go build -ldflags="$(LDFLAGS_VERSION)" -o bin/resourcebay-server ./cmd/server

# Pre-builds the resourcebay-server binaries embedded into the desktop
# app's "export as team server" feature (internal/serverdist). Must run
# before desktop-mac/desktop-windows for that feature to actually contain
# binaries.
server-dist:
	GOOS=linux   GOARCH=amd64 go build -ldflags="-s -w $(LDFLAGS_VERSION)" -o internal/serverdist/dist/linux-amd64/resourcebay-server     ./cmd/server
	GOOS=linux   GOARCH=arm64 go build -ldflags="-s -w $(LDFLAGS_VERSION)" -o internal/serverdist/dist/linux-arm64/resourcebay-server     ./cmd/server
	GOOS=windows GOARCH=amd64 go build -ldflags="-s -w $(LDFLAGS_VERSION)" -o internal/serverdist/dist/windows-amd64/resourcebay-server.exe ./cmd/server

# Native macOS .app bundle (universal: arm64 + amd64) wrapped into a single
# double-clickable .dmg installer (drag-to-Applications, the standard macOS
# install convention). CGO_LDFLAGS works around a missing
# UniformTypeIdentifiers link on newer macOS SDKs that Wails v2 doesn't
# declare explicitly yet.
desktop-mac: server-dist
	cd cmd/desktop && CGO_LDFLAGS="-framework UniformTypeIdentifiers" $(WAILS) build -platform darwin/universal -tags desktop -ldflags "$(LDFLAGS_VERSION)" -s -skipbindings -clean
	rm -f "cmd/desktop/build/bin/ResourceBay Framework-Installer.dmg"
	rm -rf /tmp/resourcebay-dmg-stage && mkdir -p /tmp/resourcebay-dmg-stage
	cp -R "cmd/desktop/build/bin/ResourceBay Framework.app" /tmp/resourcebay-dmg-stage/
	ln -s /Applications /tmp/resourcebay-dmg-stage/Programme
	hdiutil create -volname "ResourceBay Framework installieren" -srcfolder /tmp/resourcebay-dmg-stage -ov -format UDZO "cmd/desktop/build/bin/ResourceBay Framework-Installer.dmg"
	rm -rf /tmp/resourcebay-dmg-stage
	@echo "-> cmd/desktop/build/bin/ResourceBay Framework-Installer.dmg"

# Native Windows .exe. Cross-compiles cleanly from macOS/Linux since
# Wails' Windows backend needs no CGO (pure Go + WebView2 syscalls).
#
# NOTE: an NSIS setup-wizard installer (`wails build -nsis`) is NOT
# produced here — makensis is fundamentally broken on this build machine
# (crashes with std::bad_alloc on even a trivial empty .nsi script, still
# after rebuilding from source; unrelated to this project). The plain
# .exe below already IS a single file to run with no separate
# installation step, just without a Start-Menu entry/uninstaller. To get
# the full NSIS installer, run `cd cmd/desktop && wails build -platform
# windows/amd64 -tags desktop -nsis` on an actual Windows machine, or in
# CI on a windows-latest runner — both are unaffected by this bug.
desktop-windows: server-dist
	cd cmd/desktop && $(WAILS) build -platform windows/amd64 -tags desktop -ldflags "$(LDFLAGS_VERSION)" -s -skipbindings
	@echo "-> cmd/desktop/build/bin/resourcebay-desktop.exe"

desktop-all: desktop-mac desktop-windows

run-server: server
	./bin/resourcebay-server -data-dir ./data -listen :8080

run-desktop-mac: desktop-mac
	open "cmd/desktop/build/bin/ResourceBay Framework.app"
