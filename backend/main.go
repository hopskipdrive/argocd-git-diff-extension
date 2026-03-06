package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/go-github/v57/github"
	"github.com/patrickmn/go-cache"
	"golang.org/x/oauth2"
)

var diffCache = cache.New(5*time.Minute, 10*time.Minute)
var ghClient *github.Client

type DiffFile struct {
	Filename  string `json:"filename"`
	Status    string `json:"status"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
	Patch     string `json:"patch"`
	BlobURL   string `json:"blob_url"`
}

type DiffResponse struct {
	Files []DiffFile `json:"files"`
	Link  string     `json:"html_url"`
}

func main() {
	token := os.Getenv("GITHUB_TOKEN")
	if token == "" {
		log.Println("WARNING: GITHUB_TOKEN is not set. API rate limits will be very low.")
		ghClient = github.NewClient(nil)
	} else {
		ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: token})
		tc := oauth2.NewClient(context.Background(), ts)
		ghClient = github.NewClient(tc)
	}

	http.HandleFunc("/api/diff", handleDiff)
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "80"
	}

	log.Printf("Go Extension Backend listening on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func handleDiff(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "*")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	query := r.URL.Query()
	repoURL := query.Get("repoURL")
	targetRev := query.Get("targetRevision")
	appName := query.Get("appName")

	if repoURL == "" || targetRev == "" {
		http.Error(w, `{"error": "Missing repoURL or targetRevision"}`, http.StatusBadRequest)
		return
	}

	log.Printf("[%s] Requesting diff for %s @ %s", appName, repoURL, targetRev)

	repoURL = "https://github.com/argoproj/argo-cd"
	owner, repo, err := parseRepoURL(repoURL)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "%s"}`, err.Error()), http.StatusBadRequest)
		return
	}

	head := targetRev
	if head == "HEAD" {
		head = "main"
	}

	base := fmt.Sprintf("%s~1", head)
	base = "257ebc5f3ed47405e01a40ecc887978bdd299547"
	head = "24615c8ce8fe229ae1d9eb79ca68f7e290869112"
	cacheKey := fmt.Sprintf("%s/%s:%s...%s", owner, repo, base, head)
	if cachedData, found := diffCache.Get(cacheKey); found {
		log.Println("Serving from cache")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(cachedData)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	comparison, _, err := ghClient.Repositories.CompareCommits(ctx, owner, repo, base, head, nil)
	if err != nil {
		log.Printf("GitHub API Error: %v", err)
		http.Error(w, `{"error": "Failed to fetch diff from GitHub"}`, http.StatusInternalServerError)
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
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func parseRepoURL(urlStr string) (string, string, error) {
	urlStr = strings.TrimSuffix(urlStr, ".git")
	parts := strings.Split(urlStr, "/")
	if len(parts) < 2 {
		return "", "", fmt.Errorf("invalid repo URL format")
	}
	return parts[len(parts)-2], parts[len(parts)-1], nil
}
