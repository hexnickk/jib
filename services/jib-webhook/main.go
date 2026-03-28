// Command jib-webhook is a standalone webhook trigger service.
// It receives GitHub/GitLab push webhooks, validates signatures,
// and publishes deploy commands to NATS.
package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/hexnickk/jib/internal/bus"
	"github.com/hexnickk/jib/internal/config"
)

func main() {
	logger := log.New(os.Stderr, "[webhook] ", log.LstdFlags)

	configPath := envOr("JIB_CONFIG", "/opt/jib/config.yml")
	secretsDir := envOr("JIB_SECRETS", "/opt/jib/secrets")
	natsURL := envOr("NATS_URL", bus.DefaultURL)
	natsUser := os.Getenv("NATS_USER")
	natsPass := os.Getenv("NATS_PASS")
	listenAddr := envOr("LISTEN_ADDR", "0.0.0.0:9090")

	// Load config.
	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		logger.Fatalf("loading config: %v", err)
	}

	// Connect to NATS.
	b, err := bus.Connect(bus.Options{
		URL:      natsURL,
		User:     natsUser,
		Password: natsPass,
	}, logger)
	if err != nil {
		logger.Fatalf("connecting to NATS: %v", err)
	}
	defer b.Close()

	handler := &webhookHandler{
		cfg:        cfg,
		bus:        b,
		secretsDir: secretsDir,
		logger:     logger,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/_jib/webhook/", handler.handle)
	mux.HandleFunc("/_jib/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"status":"ok","service":"webhook"}`)
	})

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	server := &http.Server{
		Addr:         listenAddr,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		BaseContext:  func(_ net.Listener) context.Context { return ctx },
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer shutdownCancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	logger.Printf("listening on %s", listenAddr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Fatalf("server error: %v", err)
	}
	logger.Println("stopped")
}

type webhookHandler struct {
	cfg        *config.Config
	bus        *bus.Bus
	secretsDir string
	logger     *log.Logger
}

func (h *webhookHandler) handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	appName := strings.TrimRight(strings.TrimPrefix(r.URL.Path, "/_jib/webhook/"), "/")
	if appName == "" {
		http.Error(w, "missing app name", http.StatusBadRequest)
		return
	}

	appCfg, ok := h.cfg.Apps[appName]
	if !ok {
		http.Error(w, fmt.Sprintf("app %q not found", appName), http.StatusNotFound)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "error reading body", http.StatusBadRequest)
		return
	}

	if appCfg.Webhook == nil {
		http.Error(w, "webhook not configured for this app", http.StatusForbidden)
		return
	}

	// Validate signature.
	secret, err := h.loadSecret(appName)
	if err != nil {
		h.logger.Printf("%s: error loading secret: %v", appName, err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if secret == "" {
		http.Error(w, "webhook secret not configured", http.StatusForbidden)
		return
	}
	if !validateSignature(r, body, secret) {
		http.Error(w, "invalid signature", http.StatusForbidden)
		return
	}

	// Parse branch from payload.
	branch := appCfg.Branch
	if branch == "" {
		branch = "main"
	}

	var pushBranch string
	if r.Header.Get("X-Gitlab-Event") != "" {
		var event struct {
			Ref string `json:"ref"`
		}
		if err := json.Unmarshal(body, &event); err != nil {
			http.Error(w, "invalid payload", http.StatusBadRequest)
			return
		}
		pushBranch = strings.TrimPrefix(event.Ref, "refs/heads/")
	} else {
		var event struct {
			Ref string `json:"ref"`
		}
		if err := json.Unmarshal(body, &event); err != nil {
			http.Error(w, "invalid payload", http.StatusBadRequest)
			return
		}
		pushBranch = strings.TrimPrefix(event.Ref, "refs/heads/")
	}

	if pushBranch != branch {
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprintf(w, "ignored: branch %s != %s\n", pushBranch, branch)
		return
	}

	// Publish deploy command to NATS.
	cmd := bus.DeployCommand{
		Message: bus.NewMessage("webhook"),
		App:     appName,
		Trigger: "webhook",
		User:    "webhook",
	}

	h.logger.Printf("%s: push to %s, publishing deploy command", appName, pushBranch)

	reply, err := h.bus.Request(cmd.Subject(), cmd, 5*time.Second)
	if err != nil {
		h.logger.Printf("%s: NATS request error: %v", appName, err)
		http.Error(w, "deploy trigger failed", http.StatusServiceUnavailable)
		return
	}

	var ack bus.CommandAck
	if err := json.Unmarshal(reply.Data, &ack); err != nil {
		h.logger.Printf("%s: invalid ACK: %v", appName, err)
		http.Error(w, "deploy trigger failed", http.StatusInternalServerError)
		return
	}

	if !ack.Accepted {
		h.logger.Printf("%s: deploy rejected: %s", appName, ack.Error)
		w.WriteHeader(http.StatusConflict)
		_, _ = fmt.Fprintf(w, "rejected: %s\n", ack.Error)
		return
	}

	w.WriteHeader(http.StatusAccepted)
	_, _ = fmt.Fprintf(w, "deploy triggered for %s\n", appName) //nolint:gosec // plain text webhook response, not HTML
}

func (h *webhookHandler) loadSecret(app string) (string, error) {
	path := filepath.Join(h.secretsDir, "_jib", app+"-github-webhook.json")
	data, err := os.ReadFile(path) //nolint:gosec // path from trusted config
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	var ws struct {
		Secret string `json:"secret"`
	}
	if err := json.Unmarshal(data, &ws); err != nil {
		return "", err
	}
	return ws.Secret, nil
}

func validateSignature(r *http.Request, body []byte, secret string) bool {
	sig := r.Header.Get("X-Hub-Signature-256")
	if sig == "" {
		gitlabToken := r.Header.Get("X-Gitlab-Token")
		if gitlabToken != "" {
			return subtle.ConstantTimeCompare([]byte(gitlabToken), []byte(secret)) == 1
		}
		return false
	}
	sig = strings.TrimPrefix(sig, "sha256=")
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(sig), []byte(expected))
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
