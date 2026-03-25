package daemon

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/hexnickk/jib/internal/deploy"
)

// webhookSecret holds the stored secret for webhook signature validation.
type webhookSecret struct {
	Secret string `json:"secret"`
}

// githubPushEvent represents the relevant fields from a GitHub push webhook payload.
type githubPushEvent struct {
	Ref        string `json:"ref"`   // e.g. "refs/heads/main"
	After      string `json:"after"` // SHA of the new HEAD
	Repository struct {
		FullName string `json:"full_name"` // e.g. "org/repo"
	} `json:"repository"`
}

// gitlabPushEvent represents the relevant fields from a GitLab push webhook payload.
type gitlabPushEvent struct {
	Ref    string `json:"ref"` // e.g. "refs/heads/main"
	After  string `json:"after"`
	Object string `json:"object_kind"` // "push"
}

// runWebhookServer starts the HTTP webhook listener.
func (d *Daemon) runWebhookServer(ctx context.Context) {
	cfg := d.getConfig()

	// Only start if webhook is configured.
	if cfg.Webhook == nil || !cfg.Webhook.Enabled {
		d.logger.Println("webhook: disabled (not configured)")
		return
	}

	port := cfg.Webhook.Port
	if port == 0 {
		port = 9090
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/_jib/webhook/", d.handleWebhook)
	mux.HandleFunc("/_jib/health", d.handleHealthEndpoint)

	// Bind to localhost by default. Users who need direct external access
	// (not behind a reverse proxy or Cloudflare tunnel) should configure
	// webhook.bind_address to "0.0.0.0" in their config.
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		BaseContext:  func(_ net.Listener) context.Context { return ctx },
	}

	d.logger.Printf("webhook: listening on %s", addr)

	// Run server in a goroutine; shut down when ctx is cancelled.
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		d.logger.Printf("webhook: server error: %v", err)
	}
	d.logger.Println("webhook: stopped")
}

// handleWebhook handles POST /_jib/webhook/<app>.
func (d *Daemon) handleWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract app name from path: /_jib/webhook/<app>
	path := strings.TrimPrefix(r.URL.Path, "/_jib/webhook/")
	appName := strings.TrimRight(path, "/")
	if appName == "" {
		http.Error(w, "missing app name", http.StatusBadRequest)
		return
	}

	cfg := d.getConfig()
	appCfg, ok := cfg.Apps[appName]
	if !ok {
		http.Error(w, fmt.Sprintf("app %q not found", appName), http.StatusNotFound)
		return
	}

	// Read body.
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1MB max
	if err != nil {
		http.Error(w, "error reading body", http.StatusBadRequest)
		return
	}

	// Require webhook configuration for the app.
	if appCfg.Webhook == nil {
		d.logger.Printf("webhook: %s: no webhook configured for app", appName)
		http.Error(w, "webhook not configured for this app", http.StatusForbidden)
		return
	}

	// Validate signature — reject if secret is missing or invalid.
	secret, err := d.loadWebhookSecret(appName)
	if err != nil {
		d.logger.Printf("webhook: %s: error loading secret: %v", appName, err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if secret == "" {
		d.logger.Printf("webhook: %s: no webhook secret found, rejecting request", appName)
		http.Error(w, "webhook secret not configured", http.StatusForbidden)
		return
	}
	if !d.validateSignature(r, body, secret) {
		d.logger.Printf("webhook: %s: invalid signature", appName)
		http.Error(w, "invalid signature", http.StatusForbidden)
		return
	}

	// Detect provider and parse payload.
	branch := appCfg.Branch
	if branch == "" {
		branch = "main"
	}

	var pushBranch string

	// Detect GitLab by header.
	if r.Header.Get("X-Gitlab-Event") != "" {
		var event gitlabPushEvent
		if err := json.Unmarshal(body, &event); err != nil {
			d.logger.Printf("webhook: %s: error parsing gitlab payload: %v", appName, err)
			http.Error(w, "invalid payload", http.StatusBadRequest)
			return
		}
		pushBranch = strings.TrimPrefix(event.Ref, "refs/heads/")
	} else {
		// Default to GitHub format.
		var event githubPushEvent
		if err := json.Unmarshal(body, &event); err != nil {
			d.logger.Printf("webhook: %s: error parsing github payload: %v", appName, err)
			http.Error(w, "invalid payload", http.StatusBadRequest)
			return
		}
		pushBranch = strings.TrimPrefix(event.Ref, "refs/heads/")
	}

	// Check if the pushed branch matches the app's configured branch.
	if pushBranch != branch {
		d.logger.Printf("webhook: %s: push to %s, configured branch is %s — ignoring", appName, pushBranch, branch)
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "ignored: branch %s != %s\n", pushBranch, branch)
		return
	}

	d.logger.Printf("webhook: %s: push to %s, triggering deploy", appName, pushBranch)

	// Trigger deploy in background. Use the request's base context (which is
	// the daemon context set via BaseContext) so deploys are cancelled on shutdown.
	go func() {
		engine := d.newEngine()
		result, err := engine.Deploy(r.Context(), deploy.DeployOptions{
			App:     appName,
			Trigger: "webhook",
			User:    "webhook",
		})
		if err != nil {
			d.logger.Printf("webhook: %s: deploy error: %v", appName, err)
			return
		}
		if result.Success {
			d.logger.Printf("webhook: %s: deployed %s", appName, short(result.DeployedSHA))
		} else {
			d.logger.Printf("webhook: %s: deploy failed: %s", appName, result.Error)
		}
	}()

	w.WriteHeader(http.StatusAccepted)
	fmt.Fprintf(w, "deploy triggered for %s\n", appName)
}

// handleHealthEndpoint is a simple health check for the daemon itself.
func (d *Daemon) handleHealthEndpoint(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"status":"ok","pid":%d}`, os.Getpid())
}

// loadWebhookSecret reads the webhook secret for an app from the secrets dir.
func (d *Daemon) loadWebhookSecret(app string) (string, error) {
	path := filepath.Join(d.Root, "secrets", "_jib", app+"-github-webhook.json")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}

	var ws webhookSecret
	if err := json.Unmarshal(data, &ws); err != nil {
		return "", err
	}
	return ws.Secret, nil
}

// validateSignature validates GitHub webhook HMAC-SHA256 signature.
func (d *Daemon) validateSignature(r *http.Request, body []byte, secret string) bool {
	// GitHub uses X-Hub-Signature-256: sha256=<hex>
	sig := r.Header.Get("X-Hub-Signature-256")
	if sig == "" {
		// Fall back to X-Hub-Signature (SHA1) — but we only support SHA256.
		// Also check GitLab's X-Gitlab-Token header.
		gitlabToken := r.Header.Get("X-Gitlab-Token")
		if gitlabToken != "" {
			return subtle.ConstantTimeCompare([]byte(gitlabToken), []byte(secret)) == 1
		}
		return false
	}

	sig = strings.TrimPrefix(sig, "sha256=")
	expected := computeHMACSHA256(body, []byte(secret))
	return hmac.Equal([]byte(sig), []byte(expected))
}

// computeHMACSHA256 computes HMAC-SHA256 and returns the hex-encoded result.
func computeHMACSHA256(message, key []byte) string {
	mac := hmac.New(sha256.New, key)
	mac.Write(message)
	return hex.EncodeToString(mac.Sum(nil))
}
