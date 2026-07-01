// Package webassets embeds the static frontend (assets/js, assets/css)
// and the server-rendered HTML templates directly into the binary, so
// both build targets ship as a single self-contained executable.
package webassets

import "embed"

//go:embed assets
var Assets embed.FS

//go:embed templates
var Templates embed.FS
