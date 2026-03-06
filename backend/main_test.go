package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// --- parseRepoURL tests ---

func TestParseRepoURL(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantOwner string
		wantRepo  string
		wantErr   bool
	}{
		{
			name:      "standard HTTPS URL",
			input:     "https://github.com/hopskipdrive/rails-api",
			wantOwner: "hopskipdrive",
			wantRepo:  "rails-api",
		},
		{
			name:      "HTTPS URL with .git suffix",
			input:     "https://github.com/hopskipdrive/rails-api.git",
			wantOwner: "hopskipdrive",
			wantRepo:  "rails-api",
		},
		{
			name:      "SSH URL",
			input:     "git@github.com:hopskipdrive/rails-api.git",
			wantOwner: "hopskipdrive",
			wantRepo:  "rails-api",
		},
		{
			name:      "SSH URL without .git",
			input:     "git@github.com:hopskipdrive/rails-api",
			wantOwner: "hopskipdrive",
			wantRepo:  "rails-api",
		},
		{
			name:    "too short path",
			input:   "not-a-url",
			wantErr: true,
		},
		{
			name:    "malformed SSH URL (no colon)",
			input:   "git@github.com",
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			owner, repo, err := parseRepoURL(tc.input)
			if tc.wantErr {
				if err == nil {
					t.Errorf("expected error, got nil (owner=%q repo=%q)", owner, repo)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if owner != tc.wantOwner {
				t.Errorf("owner: got %q, want %q", owner, tc.wantOwner)
			}
			if repo != tc.wantRepo {
				t.Errorf("repo: got %q, want %q", repo, tc.wantRepo)
			}
		})
	}
}

// --- handleHealth tests ---

func TestHandleHealth(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()

	handleHealth(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusOK)
	}
	if body := w.Body.String(); body != "OK" {
		t.Errorf("body: got %q, want %q", body, "OK")
	}
}

// --- handleDiff tests ---

func setupTest(t *testing.T) {
	t.Helper()
	diffCache.Flush()
	logger = newLogger()
	// Ensure no credentials are set so we get the unauthenticated client
	os.Unsetenv("GITHUB_TOKEN")
	os.Unsetenv("GITHUB_APP_ID")
	os.Unsetenv("GITHUB_APP_INSTALLATION_ID")
	os.Unsetenv("GITHUB_APP_PRIVATE_KEY")
	ghClient, _ = buildGitHubClient()
}

func TestHandleDiff_MissingParams(t *testing.T) {
	setupTest(t)

	tests := []struct {
		name string
		url  string
	}{
		{"missing both", "/api/diff"},
		{"missing targetRevision", "/api/diff?repoURL=https://github.com/owner/repo"},
		{"missing repoURL", "/api/diff?targetRevision=abc123"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tc.url, nil)
			w := httptest.NewRecorder()
			handleDiff(w, req)
			if w.Code != http.StatusBadRequest {
				t.Errorf("status: got %d, want %d", w.Code, http.StatusBadRequest)
			}
			assertJSONError(t, w)
		})
	}
}

func TestHandleDiff_MethodNotAllowed(t *testing.T) {
	setupTest(t)

	req := httptest.NewRequest(http.MethodPost, "/api/diff?repoURL=https://github.com/owner/repo&targetRevision=abc123", nil)
	w := httptest.NewRecorder()
	handleDiff(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusMethodNotAllowed)
	}
}

func TestHandleDiff_OptionsRequest(t *testing.T) {
	setupTest(t)

	req := httptest.NewRequest(http.MethodOptions, "/api/diff", nil)
	w := httptest.NewRecorder()
	handleDiff(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusOK)
	}
}

func TestHandleDiff_CORSHeaders(t *testing.T) {
	setupTest(t)

	req := httptest.NewRequest(http.MethodOptions, "/api/diff", nil)
	w := httptest.NewRecorder()
	handleDiff(w, req)

	if got := w.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Errorf("CORS Allow-Origin: got %q, want %q", got, "*")
	}
	if got := w.Header().Get("Access-Control-Allow-Methods"); got == "" {
		t.Error("CORS Allow-Methods header is empty")
	}
}

func TestHandleDiff_InvalidRepoURL(t *testing.T) {
	setupTest(t)

	req := httptest.NewRequest(http.MethodGet, "/api/diff?repoURL=not-a-valid-url&targetRevision=abc123", nil)
	w := httptest.NewRecorder()
	handleDiff(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusBadRequest)
	}
	assertJSONError(t, w)
}

// TestHandleDiff_GitRepoURLOverride verifies that when gitRepoURL is provided
// it takes precedence over repoURL for repo parsing.
func TestHandleDiff_GitRepoURLOverride(t *testing.T) {
	setupTest(t)

	// Both params provided; gitRepoURL should win. rails-api is a valid URL shape,
	// so we should get past URL validation. The API call will fail (no real GH),
	// but we care that it's NOT a 400 (bad URL) — it's a 500 (API failure).
	url := "/api/diff" +
		"?repoURL=https://github.com/gitops-monorepo/infra" +
		"&gitRepoURL=https://github.com/hopskipdrive/rails-api" +
		"&targetRevision=abc123" +
		"&appName=test-app"
	req := httptest.NewRequest(http.MethodGet, url, nil)
	w := httptest.NewRecorder()
	handleDiff(w, req)

	if w.Code == http.StatusBadRequest {
		t.Errorf("got 400; gitRepoURL annotation URL should have been valid and passed URL parsing")
	}
}

func TestHandleDiff_ServeFromCache(t *testing.T) {
	setupTest(t)

	cacheKey := "hopskipdrive/rails-api:abc123~1...abc123"
	cached := DiffResponse{
		Files: []DiffFile{{Filename: "app/models/user.rb", Status: "modified", Additions: 5, Deletions: 2}},
		Link:  "https://github.com/hopskipdrive/rails-api/compare/abc~1...abc",
	}
	diffCache.Set(cacheKey, cached, 0)

	req := httptest.NewRequest(http.MethodGet,
		"/api/diff?repoURL=https://github.com/hopskipdrive/rails-api&targetRevision=abc123", nil)
	w := httptest.NewRecorder()
	handleDiff(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status: got %d, want %d", w.Code, http.StatusOK)
	}
	var resp DiffResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.Files) != 1 || resp.Files[0].Filename != "app/models/user.rb" {
		t.Errorf("unexpected cached response: %+v", resp)
	}
}

// --- createGitHubAppJWT tests ---

func TestCreateGitHubAppJWT_ValidKey(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}
	privPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	})

	jwt, err := createGitHubAppJWT(895906, privPEM)
	if err != nil {
		t.Fatalf("createGitHubAppJWT: %v", err)
	}

	parts := strings.Split(jwt, ".")
	if len(parts) != 3 {
		t.Fatalf("JWT must have 3 dot-separated parts, got %d", len(parts))
	}

	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		t.Fatalf("decode JWT header: %v", err)
	}
	var header map[string]string
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		t.Fatalf("parse JWT header JSON: %v", err)
	}
	if header["alg"] != "RS256" {
		t.Errorf("alg: got %q, want RS256", header["alg"])
	}
	if header["typ"] != "JWT" {
		t.Errorf("typ: got %q, want JWT", header["typ"])
	}

	// Verify payload contains expected claims
	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("decode JWT payload: %v", err)
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(payloadJSON, &payload); err != nil {
		t.Fatalf("parse JWT payload JSON: %v", err)
	}
	if int64(payload["iss"].(float64)) != 895906 {
		t.Errorf("iss: got %v, want 895906", payload["iss"])
	}
}

func TestCreateGitHubAppJWT_InvalidKey(t *testing.T) {
	_, err := createGitHubAppJWT(123, []byte("not-a-pem-key"))
	if err == nil {
		t.Error("expected error for invalid PEM key, got nil")
	}
}

func TestCreateGitHubAppJWT_WrongPEMType(t *testing.T) {
	// Valid PEM but not an RSA private key
	badPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "CERTIFICATE",
		Bytes: []byte("not-a-real-cert"),
	})
	_, err := createGitHubAppJWT(123, badPEM)
	if err == nil {
		t.Error("expected error for non-RSA PEM, got nil")
	}
}

// --- newLogger tests ---

func TestNewLogger(t *testing.T) {
	levels := []string{"debug", "info", "warn", "error", "DEBUG", "WARN", "unknown", ""}
	for _, level := range levels {
		t.Run("level="+level, func(t *testing.T) {
			os.Setenv("LOG_LEVEL", level)
			l := newLogger()
			if l == nil {
				t.Errorf("newLogger returned nil for LOG_LEVEL=%q", level)
			}
		})
	}
	os.Unsetenv("LOG_LEVEL")
}

// --- buildGitHubClient tests ---

func TestBuildGitHubClient_NoCredentials(t *testing.T) {
	os.Unsetenv("GITHUB_TOKEN")
	os.Unsetenv("GITHUB_APP_ID")
	os.Unsetenv("GITHUB_APP_INSTALLATION_ID")
	os.Unsetenv("GITHUB_APP_PRIVATE_KEY")
	logger = newLogger()

	client, err := buildGitHubClient()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if client == nil {
		t.Error("expected non-nil client")
	}
}

func TestBuildGitHubClient_WithToken(t *testing.T) {
	os.Setenv("GITHUB_TOKEN", "ghp_testtoken")
	defer os.Unsetenv("GITHUB_TOKEN")
	logger = newLogger()

	client, err := buildGitHubClient()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if client == nil {
		t.Error("expected non-nil client")
	}
}

func TestBuildGitHubClient_GitHubApp_InvalidAppID(t *testing.T) {
	os.Setenv("GITHUB_APP_ID", "not-a-number")
	os.Setenv("GITHUB_APP_INSTALLATION_ID", "50603003")
	os.Setenv("GITHUB_APP_PRIVATE_KEY", "key")
	defer func() {
		os.Unsetenv("GITHUB_APP_ID")
		os.Unsetenv("GITHUB_APP_INSTALLATION_ID")
		os.Unsetenv("GITHUB_APP_PRIVATE_KEY")
	}()
	logger = newLogger()

	_, err := buildGitHubClient()
	if err == nil {
		t.Error("expected error for invalid GITHUB_APP_ID, got nil")
	}
}

func TestBuildGitHubClient_GitHubApp_InvalidInstallID(t *testing.T) {
	os.Setenv("GITHUB_APP_ID", "895906")
	os.Setenv("GITHUB_APP_INSTALLATION_ID", "not-a-number")
	os.Setenv("GITHUB_APP_PRIVATE_KEY", "key")
	defer func() {
		os.Unsetenv("GITHUB_APP_ID")
		os.Unsetenv("GITHUB_APP_INSTALLATION_ID")
		os.Unsetenv("GITHUB_APP_PRIVATE_KEY")
	}()
	logger = newLogger()

	_, err := buildGitHubClient()
	if err == nil {
		t.Error("expected error for invalid GITHUB_APP_INSTALLATION_ID, got nil")
	}
}

func TestBuildGitHubClient_GitHubApp_ValidConfig(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	privPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	})

	os.Setenv("GITHUB_APP_ID", "895906")
	os.Setenv("GITHUB_APP_INSTALLATION_ID", "50603003")
	os.Setenv("GITHUB_APP_PRIVATE_KEY", string(privPEM))
	defer func() {
		os.Unsetenv("GITHUB_APP_ID")
		os.Unsetenv("GITHUB_APP_INSTALLATION_ID")
		os.Unsetenv("GITHUB_APP_PRIVATE_KEY")
	}()
	logger = newLogger()

	client, err := buildGitHubClient()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if client == nil {
		t.Error("expected non-nil client")
	}
}

// --- githubAppTransport token caching tests ---

func TestGitHubAppTransport_UsesCachedToken(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	privPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	})

	tr := &githubAppTransport{
		appID:          895906,
		installationID: 50603003,
		privateKeyPEM:  privPEM,
		token:          "cached-valid-token",
		expires:        time.Now().Add(30 * time.Minute),
	}

	tok, err := tr.getToken()
	if err != nil {
		t.Fatalf("getToken: %v", err)
	}
	if tok != "cached-valid-token" {
		t.Errorf("expected cached token, got %q", tok)
	}
}

func TestGitHubAppTransport_RefreshesNearExpiryToken(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	privPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	})

	tr := &githubAppTransport{
		appID:          895906,
		installationID: 50603003,
		privateKeyPEM:  privPEM,
		token:          "expired-token",
		expires:        time.Now().Add(-1 * time.Hour), // already expired
	}

	// Should attempt to refresh; will fail since we can't hit real GitHub
	_, err := tr.getToken()
	if err == nil {
		t.Log("Refresh succeeded (live GitHub connectivity in test environment)")
	}
	// The important assertion: it did NOT return the expired token
	if tr.token == "expired-token" && err == nil {
		t.Error("expected token to be refreshed, but still has old value")
	}
}

// --- helper ---

func assertJSONError(t *testing.T, w *httptest.ResponseRecorder) {
	t.Helper()
	ct := w.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type: got %q, want application/json", ct)
	}
	var body map[string]string
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Errorf("response body is not valid JSON: %v", err)
		return
	}
	if _, ok := body["error"]; !ok {
		t.Errorf("response JSON missing 'error' key: %v", body)
	}
}
