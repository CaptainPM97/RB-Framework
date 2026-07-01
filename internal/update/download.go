package update

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// DownloadAsset downloads a release asset to a temp file, verifying the
// transferred size matches what GitHub reported before handing it back —
// nothing gets applied on an incomplete/corrupted download.
func DownloadAsset(ctx context.Context, asset Asset) (path string, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, asset.URL, nil)
	if err != nil {
		return "", err
	}

	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Download fehlgeschlagen (Status %d)", resp.StatusCode)
	}

	tmp, err := os.CreateTemp("", "rb-update-*-"+filepath.Base(asset.Name))
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()

	n, err := io.Copy(tmp, resp.Body)
	closeErr := tmp.Close()
	if err != nil {
		os.Remove(tmpPath)
		return "", err
	}
	if closeErr != nil {
		os.Remove(tmpPath)
		return "", closeErr
	}
	if asset.Size > 0 && n != asset.Size {
		os.Remove(tmpPath)
		return "", fmt.Errorf("Download unvollständig (%d von %d Bytes)", n, asset.Size)
	}

	return tmpPath, nil
}
