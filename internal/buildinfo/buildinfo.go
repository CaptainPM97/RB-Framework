// Package buildinfo exposes the version baked into a build, so operators
// can tell what they're running (shown in Settings) and diagnose which
// build a bug report came from.
package buildinfo

// Version is set at build time via
// -ldflags "-X resourcebay-framework/internal/buildinfo.Version=1.2.3" (see
// Makefile). Defaults to "dev" for a plain `go build` without that flag.
var Version = "dev"
