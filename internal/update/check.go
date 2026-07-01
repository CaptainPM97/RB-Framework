// Package update checks GitHub Releases for a newer version and (on the
// desktop build only, see selfupdate_*.go) can replace the running
// executable in place. No token is used — GitHub's release API is public
// for public repos.
package update

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type Asset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
	Size int64  `json:"size"`
}

type ReleaseInfo struct {
	Version string // without leading "v"
	HTMLURL string
	Assets  []Asset
}

type githubRelease struct {
	TagName string  `json:"tag_name"`
	HTMLURL string  `json:"html_url"`
	Assets  []Asset `json:"assets"`
}

// repoAPIURL turns a repo's normal URL (https://github.com/owner/repo,
// possibly with trailing slash/.git) into its releases/latest API URL.
func repoAPIURL(repoURL string) (string, error) {
	repoURL = strings.TrimSuffix(strings.TrimSuffix(strings.TrimSpace(repoURL), "/"), ".git")
	parts := strings.Split(repoURL, "/")
	if len(parts) < 2 {
		return "", fmt.Errorf("ungültige Repository-URL: %q", repoURL)
	}
	owner, repo := parts[len(parts)-2], parts[len(parts)-1]
	if owner == "" || repo == "" {
		return "", fmt.Errorf("ungültige Repository-URL: %q", repoURL)
	}
	return fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", owner, repo), nil
}

func CheckLatest(ctx context.Context, repoURL string) (*ReleaseInfo, error) {
	apiURL, err := repoAPIURL(repoURL)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub-Anfrage fehlgeschlagen (Status %d)", resp.StatusCode)
	}

	var rel githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, err
	}

	return &ReleaseInfo{
		Version: strings.TrimPrefix(rel.TagName, "v"),
		HTMLURL: rel.HTMLURL,
		Assets:  rel.Assets,
	}, nil
}

func (r *ReleaseInfo) FindAsset(name string) (Asset, bool) {
	for _, a := range r.Assets {
		if a.Name == name {
			return a, true
		}
	}
	return Asset{}, false
}

// IsNewer compares two "X.Y.Z" version strings numerically per segment
// (falls back to a plain string comparison for anything that doesn't
// parse, e.g. a "dev" build — such builds never claim to be newer).
func IsNewer(current, latest string) bool {
	cur := parseVersion(current)
	lat := parseVersion(latest)
	if cur == nil || lat == nil {
		return false
	}
	for i := 0; i < 3; i++ {
		if lat[i] != cur[i] {
			return lat[i] > cur[i]
		}
	}
	return false
}

func parseVersion(v string) []int {
	parts := strings.SplitN(v, ".", 3)
	if len(parts) != 3 {
		return nil
	}
	out := make([]int, 3)
	for i, p := range parts {
		n, err := strconv.Atoi(strings.TrimSpace(p))
		if err != nil {
			return nil
		}
		out[i] = n
	}
	return out
}
