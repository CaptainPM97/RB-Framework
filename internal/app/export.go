package app

// platformRow is the view model for one exportable server-binary platform
// in the settings UI. Shared between handlers_export.go (desktop build)
// and export_stub.go (server build) — see their build-tag comments.
type platformRow struct {
	ID        string
	Label     string
	Available bool
}
