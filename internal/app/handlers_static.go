package app

import (
	"io/fs"
	"net/http"

	"resourcebay-framework/internal/webassets"
)

// staticHandler serves the embedded assets/ tree. Unlike the PHP
// original's includes/.htaccess deny-list, includes/ and data/ are safe
// by construction here — they're simply never registered as routes.
func staticHandler() http.Handler {
	sub, err := fs.Sub(webassets.Assets, "assets")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(sub))
	return http.StripPrefix("/assets/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		fileServer.ServeHTTP(w, r)
	}))
}
