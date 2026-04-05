package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"time"
)

// GitHub App manifest flow lives here (not in internal/github) because it's
// an interactive CLI-only workflow: it spawns a local HTTP server, opens a
// browser, and waits for a callback. Only `jib github app setup` uses it,
// so keeping it out of internal/github means ghmod and other library
// consumers don't transitively pull in net/http, os/exec, and runtime.

// manifestResult holds the credentials returned by GitHub after the manifest flow.
type manifestResult struct {
	AppID int64
	Slug  string
	PEM   string
}

// manifestPayload is the JSON body POSTed to GitHub.
type manifestPayload struct {
	Name               string            `json:"name"`
	URL                string            `json:"url"`
	HookAttributes     hookAttributes    `json:"hook_attributes"`
	RedirectURL        string            `json:"redirect_url"`
	Public             bool              `json:"public"`
	DefaultPermissions map[string]string `json:"default_permissions"`
	DefaultEvents      []string          `json:"default_events"`
}

type hookAttributes struct {
	Active bool `json:"active"`
}

// runManifestFlow automates GitHub App creation via the manifest flow.
// It starts a temporary local server, opens the browser, and waits for the callback.
func runManifestFlow(ctx context.Context, providerName string) (*manifestResult, error) {
	// Pick a port
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("starting local server: %w", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port

	// Generate state for CSRF protection
	stateBytes := make([]byte, 16)
	if _, err := rand.Read(stateBytes); err != nil {
		_ = listener.Close()
		return nil, fmt.Errorf("generating state: %w", err)
	}
	state := hex.EncodeToString(stateBytes)

	callbackURL := fmt.Sprintf("http://localhost:%d/callback", port)

	m := manifestPayload{
		Name:           "jib-deploy-" + providerName,
		URL:            "https://github.com/hexnickk/jib",
		HookAttributes: hookAttributes{Active: false},
		RedirectURL:    callbackURL,
		Public:         false,
		DefaultPermissions: map[string]string{
			"contents": "read",
		},
		DefaultEvents: []string{},
	}

	manifestJSON, err := json.Marshal(m)
	if err != nil {
		_ = listener.Close()
		return nil, fmt.Errorf("marshaling manifest: %w", err)
	}

	// Channel to receive the code
	codeCh := make(chan string, 1)
	errCh := make(chan error, 1)

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		serveManifestForm(w, state, string(manifestJSON))
	})
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("state") != state {
			http.Error(w, "Invalid state", http.StatusBadRequest)
			errCh <- fmt.Errorf("state mismatch in callback")
			return
		}
		code := r.URL.Query().Get("code")
		if code == "" {
			http.Error(w, "Missing code", http.StatusBadRequest)
			errCh <- fmt.Errorf("missing code in callback")
			return
		}
		_, _ = fmt.Fprint(w, `<html><body><h2>GitHub App created!</h2><p>You can close this tab and return to the terminal.</p></body></html>`)
		codeCh <- code
	})

	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second} //nolint:gosec // local temp server

	go func() {
		if srvErr := srv.Serve(listener); srvErr != nil && srvErr != http.ErrServerClosed {
			errCh <- srvErr
		}
	}()

	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	// Open browser
	url := fmt.Sprintf("http://localhost:%d/", port)
	if err := openBrowser(url); err != nil {
		fmt.Printf("Could not open browser automatically.\nOpen this URL in your browser:\n  %s\n\n", url)
	} else {
		fmt.Printf("Opening browser to create GitHub App...\n")
	}

	// Wait for callback with timeout
	timeout := 5 * time.Minute
	select {
	case code := <-codeCh:
		return exchangeManifestCode(ctx, code)
	case err := <-errCh:
		return nil, err
	case <-time.After(timeout):
		return nil, fmt.Errorf("timed out waiting for GitHub callback (waited %s)", timeout)
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func serveManifestForm(w http.ResponseWriter, state, manifestJSON string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// The form auto-submits a POST to GitHub with the manifest.
	// This is the official documented approach for the manifest flow.
	// HTML-escape the JSON to prevent attribute breakout.
	_, _ = fmt.Fprintf(w, `<!DOCTYPE html>
<html>
<body>
  <h2>Creating GitHub App...</h2>
  <p>If you are not redirected, click the button below.</p>
  <form id="mf" action="https://github.com/settings/apps/new?state=%s" method="post">
    <input type="hidden" name="manifest" value="%s">
    <button type="submit">Create GitHub App</button>
  </form>
  <script>document.getElementById('mf').submit();</script>
</body>
</html>`, state, html.EscapeString(manifestJSON))
}

func exchangeManifestCode(ctx context.Context, code string) (*manifestResult, error) {
	url := fmt.Sprintf("https://api.github.com/app-manifests/%s/conversions", code)
	req, err := http.NewRequestWithContext(ctx, "POST", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("exchanging manifest code: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != 201 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("manifest code exchange failed: HTTP %d: %s", resp.StatusCode, body)
	}

	var result struct {
		ID   int64  `json:"id"`
		Slug string `json:"slug"`
		PEM  string `json:"pem"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding manifest response: %w", err)
	}

	if result.PEM == "" {
		return nil, fmt.Errorf("GitHub did not return a private key")
	}

	return &manifestResult{
		AppID: result.ID,
		Slug:  result.Slug,
		PEM:   result.PEM,
	}, nil
}

func openBrowser(url string) error {
	var cmd string
	var args []string

	switch runtime.GOOS {
	case "linux":
		cmd = "xdg-open"
		args = []string{url}
	case "darwin":
		cmd = "open"
		args = []string{url}
	case "windows":
		cmd = "rundll32"
		args = []string{"url.dll,FileProtocolHandler", url}
	default:
		return fmt.Errorf("unsupported platform %s", runtime.GOOS)
	}

	return exec.Command(cmd, args...).Start() //nolint:gosec // url is a trusted localhost URL
}
