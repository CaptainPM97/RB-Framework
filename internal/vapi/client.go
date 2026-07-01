// Package vapi implements the outbound HTTP client for the StateV vAPI,
// mirroring api/proxy.php and api/batch.php's curl configuration.
// Credentials are read fresh from config on every call (not cached at
// construction), since the operator can change them via the settings
// screen at any time.
//
// The framework supports multiple operator-entered API keys (e.g. one
// per StateV company account). Every request fans out to all configured
// keys in parallel, each capped at 10 requests/minute on its own — a key
// belonging to a different account simply won't have access to a given
// resource and fails harmlessly, so the same fan-out logic works for both
// "give me everything across all my accounts" (list endpoints, merged by
// concatenating JSON arrays) and "find whichever key owns this specific
// resource" (single-object endpoints, first success wins).
package vapi

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"resourcebay-framework/internal/config"
)

// BaseURL is the fixed StateV vAPI address, taken from the original
// StateV Verwaltung app's includes/config.php (STATEV_API_BASE). It is
// not operator-configurable — only the Bearer key/secret are, since
// those (unlike the endpoint address) are actual per-operator credentials.
const BaseURL = "https://api.statev.de/req"

// maxRequestsPerMinute caps each individual key, not the app as a whole —
// with N keys configured the app's effective throughput scales with N.
const maxRequestsPerMinute = 10

var ErrNoKeys = errors.New("kein StateV-API-Key konfiguriert")
var ErrRateLimited = errors.New("alle konfigurierten Keys haben ihr Limit von 10 Anfragen/Minute erreicht")

type Client struct {
	cfg        *config.Config
	httpClient *http.Client
	limiter    *rateLimiter
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
		limiter: newRateLimiter(),
	}
}

// rateLimiter tracks a sliding 60s window of request timestamps per key,
// capping each key independently at maxRequestsPerMinute.
type rateLimiter struct {
	mu     sync.Mutex
	events map[string][]time.Time
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{events: map[string][]time.Time{}}
}

// allow reports whether a request for this key is within budget, and if
// so records it immediately (check-and-record is atomic under the lock).
func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-time.Minute)
	kept := rl.events[key][:0]
	for _, t := range rl.events[key] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= maxRequestsPerMinute {
		rl.events[key] = kept
		return false
	}
	rl.events[key] = append(kept, now)
	return true
}

func (c *Client) url(path string) string {
	return strings.TrimRight(BaseURL, "/") + "/" + strings.TrimLeft(path, "/")
}

type keyOutcome struct {
	status  int
	body    []byte
	err     error
	limited bool
}

// doOne performs a single request using one specific key's credentials.
func (c *Client) doOne(ctx context.Context, method, path string, body []byte, key string) (int, []byte, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.url(path), reader)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
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

func injectAPISecret(body []byte, secret string) []byte {
	var decoded map[string]any
	if json.Unmarshal(body, &decoded) != nil || decoded == nil {
		decoded = map[string]any{}
	}
	decoded["apiSecret"] = secret
	out, err := json.Marshal(decoded)
	if err != nil {
		return body
	}
	return out
}

// Do fans a single logical request out to every configured key in
// parallel (each independently rate-limited) and merges the results: if
// every successful response is a JSON array, they're concatenated
// (e.g. factory/list across several company accounts); otherwise the
// first successful response wins (e.g. a single firma's data, which only
// the key owning that firma can actually return).
//
// injectSecret, when true, adds each key's own apiSecret into the POST
// body before sending — used for factory/options writes.
func (c *Client) Do(ctx context.Context, method, path string, body []byte, injectSecret bool) (status int, mergedBody []byte, err error) {
	keys := c.cfg.Settings().VAPI.Keys
	if len(keys) == 0 {
		return 0, nil, ErrNoKeys
	}

	outcomes := make([]keyOutcome, len(keys))
	var wg sync.WaitGroup
	for i, k := range keys {
		if k.Key == "" {
			outcomes[i] = keyOutcome{err: errors.New("leerer Key")}
			continue
		}
		if !c.limiter.allow(k.Key) {
			outcomes[i] = keyOutcome{limited: true}
			continue
		}
		wg.Add(1)
		go func(i int, k config.VAPIKey) {
			defer wg.Done()
			reqBody := body
			if injectSecret && reqBody != nil {
				reqBody = injectAPISecret(reqBody, k.Secret)
			}
			st, respBody, e := c.doOne(ctx, method, path, reqBody, k.Key)
			outcomes[i] = keyOutcome{status: st, body: respBody, err: e}
		}(i, k)
	}
	wg.Wait()

	return mergeOutcomes(outcomes)
}

func mergeOutcomes(outcomes []keyOutcome) (int, []byte, error) {
	var successes [][]byte
	var successStatus int
	allLimited := len(outcomes) > 0
	var lastErr error
	var lastStatus int

	for _, o := range outcomes {
		if !o.limited {
			allLimited = false
		}
		if o.limited || o.err != nil {
			if o.err != nil {
				lastErr = o.err
			}
			continue
		}
		if o.status < 200 || o.status >= 300 {
			lastStatus = o.status
			continue
		}
		successes = append(successes, o.body)
		successStatus = o.status
	}

	if len(successes) == 0 {
		if allLimited {
			return 429, nil, ErrRateLimited
		}
		if lastErr != nil {
			return 0, nil, lastErr
		}
		if lastStatus != 0 {
			return lastStatus, nil, nil
		}
		return 0, nil, ErrNoKeys
	}

	if len(successes) == 1 {
		return successStatus, successes[0], nil
	}

	merged, ok := concatIfAllArrays(successes)
	if ok {
		return successStatus, merged, nil
	}
	return successStatus, successes[0], nil
}

// concatIfAllArrays returns the concatenation of every body as one JSON
// array, but only if every single body actually parses as a JSON array —
// otherwise merging would be semantically wrong (e.g. two different
// single-object responses), so the caller falls back to "first success".
func concatIfAllArrays(bodies [][]byte) ([]byte, bool) {
	var all []json.RawMessage
	for _, b := range bodies {
		var arr []json.RawMessage
		if json.Unmarshal(b, &arr) != nil {
			return nil, false
		}
		all = append(all, arr...)
	}
	out, err := json.Marshal(all)
	if err != nil {
		return nil, false
	}
	return out, true
}

type BatchResult struct {
	Path   string
	Status int
	Body   []byte
	Err    error
}

// Batch performs GET requests for every path concurrently, each itself
// fanned out across all configured keys and merged via Do. Results are
// returned in the same order as the input paths.
func (c *Client) Batch(ctx context.Context, paths []string) []BatchResult {
	results := make([]BatchResult, len(paths))
	var wg sync.WaitGroup
	for i, p := range paths {
		wg.Add(1)
		go func(i int, p string) {
			defer wg.Done()
			status, body, err := c.Do(ctx, http.MethodGet, p, nil, false)
			results[i] = BatchResult{Path: p, Status: status, Body: body, Err: err}
		}(i, p)
	}
	wg.Wait()
	return results
}
