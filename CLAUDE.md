# CLAUDE.md — argocd-git-diff-extension

This file provides guidance to Claude Code when working with this repository.

## What This Repo Does

An ArgoCD UI extension that shows a Git diff between the currently deployed revision and its parent commit. It surfaces change context directly in the ArgoCD application view without leaving the UI.

The extension supports GitOps monorepos by reading an annotation on the ArgoCD Application to override the source repo URL used for diffing.

## Directory Layout

```
argocd-git-diff-extension/
├── backend/                  # Go HTTP service — proxies GitHub API calls
│   ├── main.go               # Server entrypoint, handlers, GitHub App auth
│   ├── main_test.go          # Unit + integration tests
│   ├── Dockerfile            # Multi-stage distroless build
│   ├── go.mod / go.sum       # Go module dependencies
│   └── package.json          # Metadata only (not a Node project)
├── ui/                       # React/TypeScript ArgoCD UI extension
│   ├── src/
│   │   ├── index.tsx         # Main extension component + annotation logic
│   │   └── __tests__/
│   │       └── index.test.tsx
│   ├── __mocks__/
│   │   └── styleMock.js      # Jest style mock
│   ├── babel.config.js       # Babel config for Jest
│   ├── webpack.config.js     # Production bundle config
│   ├── package.json          # NPM dependencies + Jest config
│   ├── tsconfig.json         # TypeScript config
│   ├── extension.yaml        # ArgoCD extension metadata
│   └── dist/                 # Built artifacts (gitignored except extension.tar.gz)
├── chart/
│   └── extension-backend/    # Helm chart for the backend service
│       ├── Chart.yaml
│       ├── values.yaml       # All configurable values with comments
│       └── templates/
│           ├── deployment.yaml
│           ├── externalsecret.yaml
│           └── serviceaccount.yaml
├── helmfile.yaml             # Local/minikube deployment via helmfile
├── manifests/
│   └── install.yaml          # ArgoCDExtension CRD manifest
├── Makefile                  # Build targets
└── README.md
```

## Key Commands

### Backend

```bash
# Run tests
cd backend && go test ./... -v

# Build binary
cd backend && CGO_ENABLED=0 go build -o server main.go

# Build Docker image (from repo root)
make docker-build REGISTRY=local IMAGE_NAME=argocd-diff-backend TAG=latest
```

### UI

```bash
# Install dependencies
cd ui && npm ci

# Run tests
cd ui && npm test

# Build production bundle
cd ui && npm run build
```

### Helm chart (lint/template)

```bash
helm lint chart/extension-backend
helm template git-diff-extension chart/extension-backend -f chart/extension-backend/values.yaml
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GITHUB_APP_ID` | Yes (prod) | GitHub App ID (e.g. `895906`) |
| `GITHUB_APP_INSTALLATION_ID` | Yes (prod) | GitHub App Installation ID |
| `GITHUB_APP_PRIVATE_KEY` | Yes (prod) | RSA private key PEM string |
| `GITHUB_TOKEN` | No (dev only) | PAT fallback; not for production |
| `LOG_LEVEL` | No | `debug`, `info` (default), `warn`, `error` |
| `PORT` | No | HTTP listen port (default: `80`) |

## Annotation Reference

Place these annotations on ArgoCD Application resources to configure the extension:

| Annotation | Description |
|---|---|
| `argocd-git-diff-extension/source-repo-url` | Override the repo URL for diffing. Use this when the Application points to a GitOps monorepo but diffs should target the app's source repo. |
| `argocd-git-diff-extension/source-revision` | Override the revision used for diffing (optional). Falls back to `spec.source.targetRevision`. |

### Example

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: rails-api
  namespace: argocd
  annotations:
    argocd-git-diff-extension/source-repo-url: https://github.com/hopskipdrive/rails-api
    argocd-git-diff-extension/source-revision: v2.3.1
spec:
  source:
    repoURL: https://github.com/hopskipdrive/infra-monorepo  # gitops monorepo
    targetRevision: main
    path: gitops/application/rails-api
```

## Helm Chart Values Summary

| Value | Default | Description |
|---|---|---|
| `logLevel` | `info` | Backend log level |
| `externalSecret.enabled` | `false` | Create ExternalSecret for GitHub App credentials |
| `externalSecret.clusterSecretStore` | `cluster-secret-store-internal-secretstore` | ClusterSecretStore name |
| `existingSecret.enabled` | `false` | Mount a pre-existing secret for credentials |
| `existingSecret.name` | — | Name of the existing Kubernetes secret |
| `serviceAccount.create` | `true` | Create a dedicated ServiceAccount |
| `serviceAccount.annotations` | `{}` | Annotations (e.g., IRSA role ARN) |

## GitHub App Authentication

The backend uses GitHub App installation tokens (RS256 JWT → installation token exchange) implemented with Go stdlib — no external JWT library required. Tokens are cached for their 1-hour lifetime and refreshed 5 minutes before expiry.

The GitHub App credentials must be stored in AWS Secrets Manager and synced via External Secrets Operator using the `externalSecret` Helm values, matching the pattern used in `infra-monorepo/argocd/helmfile.yaml`.

## Architecture Notes

- The backend is a single Go binary (distroless image) with in-memory caching (5 min TTL).
- The UI extension registers on the `Deployment` resource tab; ArgoCD proxies requests through `/extensions/git-diff-extension/api/diff`.
- The `Service` is named `extension-backend` (without release prefix) to match the URL hardcoded in `helmfile.yaml` and `manifests/install.yaml`.
- All secrets are injected via environment variables — never baked into the image.
