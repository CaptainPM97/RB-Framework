package webassets

import (
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
)

// versions holds a short content hash per embedded asset path (e.g.
// "js/app.js"), computed once at startup. It replaces PHP's filemtime()
// cache-busting — the embedded content only changes on rebuild, so a
// content hash is both simpler and safe to cache forever.
var versions = map[string]string{}

func init() {
	sub, err := fs.Sub(Assets, "assets")
	if err != nil {
		panic(err)
	}
	_ = fs.WalkDir(sub, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		data, err := fs.ReadFile(sub, path)
		if err != nil {
			return nil
		}
		sum := sha256.Sum256(data)
		versions[path] = hex.EncodeToString(sum[:])[:8]
		return nil
	})
}

// AssetURL returns a cache-busted URL for an embedded asset path, e.g.
// AssetURL("js/app.js") -> "/assets/js/app.js?v=<hash8>".
func AssetURL(path string) string {
	v := versions[path]
	if v == "" {
		return "/assets/" + path
	}
	return "/assets/" + path + "?v=" + v
}
