// Package vapi implements the outbound HTTP client for the StateV vAPI,
// mirroring api/proxy.php and api/batch.php's curl configuration.
// Credentials are read fresh from config on every call (not cached at
// construction), since the operator can change them via the settings
// screen at any time.
package vapi

import (
	"bytes"
	"context"
	"crypto/tls"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"resourcebay-framework/internal/config"
)

type Client struct {
	cfg        *config.Config
	httpClient *http.Client
}

func New(cfg *config.Config) *Client {
	return &Client{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
			Transport: &http.Transport{
				DialContext: (&net.Dialer{Timeout: 8 * time.Second}).DialContext,
				// The original app disabled TLS verification for the
				// upstream vAPI (CURLOPT_SSL_VERIFYPEER=false); kept for
				// behavioral parity.
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		},
	}
}

type Result struct {
	Path   string
	Status int
	Body   []byte
	Err    error
}

func (c *Client) url(path string) string {
	settings := c.cfg.Settings()
	return strings.TrimRight(settings.VAPI.Base, "/") + "/" + strings.TrimLeft(path, "/")
}

// Do performs a single proxied request, mirroring api/proxy.php's curl call.
func (c *Client) Do(ctx context.Context, method, path string, body []byte) (status int, respBody []byte, err error) {
	settings := c.cfg.Settings()

	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.url(path), reader)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+settings.VAPI.Key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, nil, err
	}
	return resp.StatusCode, data, nil
}

// Batch performs GET requests for every path concurrently, mirroring
// api/batch.php's curl_multi usage. Results are returned in the same
// order as the input paths.
func (c *Client) Batch(ctx context.Context, paths []string) []Result {
	results := make([]Result, len(paths))
	done := make(chan struct{}, len(paths))

	for i, p := range paths {
		go func(i int, p string) {
			defer func() { done <- struct{}{} }()
			status, body, err := c.Do(ctx, http.MethodGet, p, nil)
			results[i] = Result{Path: p, Status: status, Body: body, Err: err}
		}(i, p)
	}
	for range paths {
		<-done
	}
	return results
}
