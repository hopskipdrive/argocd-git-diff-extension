package main

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/go-github/v57/github"
	"github.com/patrickmn/go-cache"
	"golang.org/x/oauth2"
)

// AnnotationGitRepo is the ArgoCD Application annotation key that overrides
// the git repo URL used for diffing. Useful when the ArgoCD Application points
// to a GitOps monorepo but the actual app code lives in a separate repo.
const AnnotationGitRepo = "argocd-git-diff-extension/source-repo-url"

// AnnotationRevision optionally overrides the target revision used for diffing.
const AnnotationRevision = "argocd-git-diff-extension/source-revision"

var (
	diffCache = cache.New(5*time.Minute, 10*time.Minute)
	ghClient  *github.Client
	logger    *slog.Logger
)

// DiffFile represents a single changed file in a comparison.
type DiffFile struct {
	Filename  string `json:"filename"`
	Status    string `json:"status"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
	Patch     string `json:"patch"`
	BlobURL   string `json:"blob_url"`
}

// DiffResponse is the JSON payload returned by /api/diff.
type DiffResponse struct {
	Files []DiffFile `json:"files"`
	Link  string     `json:"html_url"`
}

// installationTokenCache caches GitHub App installation tokens to avoid
// generating a new one on every request.
type installationTokenCache struct {
	mu      sync.Mutex
	token   string
	expires time.Time
}

var tokenCache installationTokenCache

func main() {
	logger = newLogger()

	client, err := buildGitHubClient()
	if err != nil {
		logger.Error("Failed to initialize GitHub client", "error", err)
		os.Exit(1)
	}
	ghClient = client

	mux := http.NewServeMux()
	mux.HandleFunc("/api/diff", handleDiff)
	mux.HandleFunc("/health", handleHealth)

	port := os.Getenv("PORT")
	if port == "" {
		port = "80"
	}

	logger.Info("Git diff extension backend starting", "port", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		logger.Error("Server failed", "error", err)
		os.Exit(1)
	}
}

// newLogger creates a slog.Logger configured from the LOG_LEVEL env var.
// Accepted values: debug, info, warn, error (default: info).
func newLogger() *slog.Logger {
	level := slog.LevelInfo
	switch strings.ToLower(os.Getenv("LOG_LEVEL")) {
	case "debug":
		level = slog.LevelDebug
	case "warn", "warning":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
}

// buildGitHubClient constructs a *github.Client using either GitHub App
// credentials (preferred) or a personal access token (fallback for local dev).
func buildGitHubClient() (*github.Client, error) {
	appIDStr := os.Getenv("GITHUB_APP_ID")
	installIDStr := os.Getenv("GITHUB_APP_INSTALLATION_ID")
	privateKey := os.Getenv("GITHUB_APP_PRIVATE_KEY")

	if appIDStr != "" && installIDStr != "" && privateKey != "" {
		logger.Info("Using GitHub App authentication")
		appID, err := strconv.ParseInt(appIDStr, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid GITHUB_APP_ID: %w", err)
		}
		installID, err := strconv.ParseInt(installIDStr, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid GITHUB_APP_INSTALLATION_ID: %w", err)
		}
		transport := &githubAppTransport{
			appID:          appID,
			installationID: installID,
			privateKeyPEM:  []byte(privateKey),
		}
		return github.NewClient(&http.Client{Transport: transport}), nil
	}

	token := os.Getenv("GITHUB_TOKEN")
	if token != "" {
		logger.Info("Using GitHub personal access token authentication")
		ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: token})
		return github.NewClient(oauth2.NewClient(context.Background(), ts)), nil
	}

	logger.Warn("No GitHub credentials configured; API rate limits will be very low")
	return github.NewClient(nil), nil
}

// githubAppTransport implements http.RoundTripper using GitHub App installation tokens.
// It caches the installation token and refreshes it before expiry.
type githubAppTransport struct {
	appID          int64
	installationID int64
	privateKeyPEM  []byte

	mu      sync.Mutex
	token   string
	expires time.Time
}

func (t *githubAppTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	token, err := t.getToken()
	if err != nil {
		return nil, fmt.Errorf("github app token: %w", err)
	}
	// Clone request so we don't mutate the original
	r2 := req.Clone(req.Context())
	r2.Header.Set("Authorization", "token "+token)
	return http.DefaultTransport.RoundTrip(r2)
}

// getToken returns a cached installation token, refreshing if needed.
func (t *githubAppTransport) getToken() (string, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	// Refresh 5 minutes before expiry to avoid edge cases
	if t.token != "" && time.Now().Before(t.expires.Add(-5*time.Minute)) {
		return t.token, nil
	}

	logger.Debug("Refreshing GitHub App installation token")
	token, expires, err := fetchInstallationToken(t.appID, t.installationID, t.privateKeyPEM)
	if err != nil {
		return "", err
	}
	t.token = token
	t.expires = expires
	return token, nil
}

// fetchInstallationToken mints a GitHub App JWT and exchanges it for an
// installation access token. Implemented using stdlib only (no extra deps).
func fetchInstallationToken(appID, installationID int64, privateKeyPEM []byte) (token string, expires time.Time, err error) {
	jwt, err := createGitHubAppJWT(appID, privateKeyPEM)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("create JWT: %w", err)
	}

	url := fmt.Sprintf("https://api.github.com/app/installations/%d/access_tokens", installationID)
	req, err := http.NewRequest(http.MethodPost, url, nil)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+jwt)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("request installation token: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return "", time.Time{}, fmt.Errorf("unexpected status %d fetching installation token", resp.StatusCode)
	}

	var result struct {
		Token     string `json:"token"`
		ExpiresAt string `json:"expires_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", time.Time{}, fmt.Errorf("decode token response: %w", err)
	}
	if result.Token == "" {
		return "", time.Time{}, fmt.Errorf("empty token in response")
	}

	exp, err := time.Parse(time.RFC3339, result.ExpiresAt)
	if err != nil {
		// Default to 1 hour from now if parse fails
		exp = time.Now().Add(1 * time.Hour)
	}
	return result.Token, exp, nil
}

// createGitHubAppJWT creates a signed RS256 JWT for GitHub App authentication.
// Uses only stdlib — no external JWT library required.
func createGitHubAppJWT(appID int64, privateKeyPEM []byte) (string, error) {
	block, _ := pem.Decode(privateKeyPEM)
	if block == nil {
		return "", fmt.Errorf("failed to decode PEM block from private key")
	}
	key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return "", fmt.Errorf("parse private key: %w", err)
	}

	now := time.Now()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	payloadJSON, err := json.Marshal(map[string]int64{
		"iss": appID,
		"iat": now.Add(-60 * time.Second).Unix(), // allow for clock drift
		"exp": now.Add(9 * time.Minute).Unix(),
	})
	if err != nil {
		return "", fmt.Errorf("marshal JWT payload: %w", err)
	}
	payload := base64.RawURLEncoding.EncodeToString(payloadJSON)

	sigInput := header + "." + payload
	h := sha256.New()
	h.Write([]byte(sigInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, h.Sum(nil))
	if err != nil {
		return "", fmt.Errorf("sign JWT: %w", err)
	}

	return sigInput + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

// handleHealth returns a simple 200 OK for liveness/readiness probes.
func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

// handleDiff is the main handler. It accepts query parameters, fetches the
// GitHub comparison, caches the result, and returns a DiffResponse as JSON.
func handleDiff(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "*")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodGet {
		writeJSONError(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	q := r.URL.Query()
	// gitRepoURL is set by the UI when the application has the override annotation.
	// It takes precedence over repoURL (which comes from spec.source.repoURL).
	repoURL := q.Get("gitRepoURL")
	if repoURL == "" {
		repoURL = q.Get("repoURL")
	}
	targetRev := q.Get("targetRevision")
	appName := q.Get("appName")

	if repoURL == "" || targetRev == "" {
		writeJSONError(w, "Missing repoURL or targetRevision", http.StatusBadRequest)
		return
	}

	logger.Info("Diff requested", "app", appName, "repo", repoURL, "revision", targetRev)

	owner, repo, err := parseRepoURL(repoURL)
	if err != nil {
		logger.Warn("Invalid repo URL", "url", repoURL, "error", err)
		writeJSONError(w, fmt.Sprintf("Invalid repo URL: %s", err.Error()), http.StatusBadRequest)
		return
	}

	head := targetRev
	if head == "HEAD" || head == "" {
		head = "main"
	}
	base := head + "~1"

	cacheKey := fmt.Sprintf("%s/%s:%s...%s", owner, repo, base, head)
	if cached, found := diffCache.Get(cacheKey); found {
		logger.Debug("Serving diff from cache", "key", cacheKey)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(cached)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	comparison, _, err := ghClient.Repositories.CompareCommits(ctx, owner, repo, base, head, nil)
	if err != nil {
		logger.Error("GitHub API error", "owner", owner, "repo", repo, "error", err)
		writeJSONError(w, "Failed to fetch diff from GitHub", http.StatusInternalServerError)
		return
	}

	var files []DiffFile
	for _, f := range comparison.Files {
		files = append(files, DiffFile{
			Filename:  f.GetFilename(),
			Status:    f.GetStatus(),
			Additions: f.GetAdditions(),
			Deletions: f.GetDeletions(),
			Patch:     f.GetPatch(),
			BlobURL:   f.GetBlobURL(),
		})
	}

	response := DiffResponse{
		Files: files,
		Link:  comparison.GetHTMLURL(),
	}

	diffCache.Set(cacheKey, response, cache.DefaultExpiration)
	logger.Debug("Diff fetched and cached", "key", cacheKey, "files", len(files))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// parseRepoURL extracts the GitHub owner and repo name from a URL.
// Handles https://github.com/owner/repo and git@github.com:owner/repo formats.
func parseRepoURL(rawURL string) (owner, repo string, err error) {
	rawURL = strings.TrimSuffix(rawURL, ".git")

	// Handle SSH format: git@github.com:owner/repo
	if strings.HasPrefix(rawURL, "git@") {
		parts := strings.SplitN(rawURL, ":", 2)
		if len(parts) != 2 {
			return "", "", fmt.Errorf("invalid SSH repo URL format")
		}
		rawURL = "https://github.com/" + parts[1]
	}

	parts := strings.Split(strings.TrimRight(rawURL, "/"), "/")
	if len(parts) < 2 {
		return "", "", fmt.Errorf("URL must contain at least owner/repo path segments")
	}
	owner = parts[len(parts)-2]
	repo = parts[len(parts)-1]
	if owner == "" || repo == "" {
		return "", "", fmt.Errorf("could not parse owner/repo from URL")
	}
	return owner, repo, nil
}

// writeJSONError writes an HTTP error response with a JSON body.
func writeJSONError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
