# ArgoCD Git Diff Extension

An ArgoCD UI extension that displays a Git diff between the currently deployed revision and its parent commit, surfaced directly in the ArgoCD application resource view.

![](./docs/images/screenshot.png)

## Components

- **backend** — A Go service that proxies GitHub API requests, handles GitHub App authentication, and caches diffs (5-minute TTL).
- **ui** — A React/TypeScript extension rendered inside ArgoCD that displays colored diffs per changed file.

## Features

- GitHub App authentication (preferred) or Personal Access Token (local dev fallback)
- Monorepo GitOps support via ArgoCD Application annotations
- Configurable log levels (`debug`, `info`, `warn`, `error`)
- In-memory diff caching
- External Secrets Operator integration for credential management
- Existing secret support (Vault, Sealed Secrets, manual)

## Prerequisites

- Argo CD 2.6+
- Kubernetes 1.25+
- (Production) External Secrets Operator installed in the cluster
- (Production) A GitHub App with read access to your repositories

## Monorepo GitOps Support

When ArgoCD Applications point to a GitOps monorepo (e.g., `infra-monorepo`), add annotations to tell the extension which application source repo to diff:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: rails-api
  namespace: argocd
  annotations:
    # Override the repo used for the git diff (your app's source repo, not the gitops repo)
    argocd-git-diff-extension/source-repo-url: https://github.com/your-org/rails-api
    # Optionally override the revision (defaults to spec.source.targetRevision)
    argocd-git-diff-extension/source-revision: v2.3.1
spec:
  source:
    repoURL: https://github.com/your-org/infra-monorepo
    targetRevision: main
    path: gitops/application/rails-api
```

## Production Installation

### 1. Configure GitHub App credentials

Store your GitHub App credentials in AWS Secrets Manager as a JSON object:

```json
{
  "GITHUB_APP_ID": "895906",
  "GITHUB_APP_INSTALLATION_ID": "50603003",
  "GITHUB_APP_PRIVATE_KEY": "-----BEGIN RSA PRIVATE KEY-----\n..."
}
```

### 2. Deploy the backend

```bash
# Using helmfile (recommended)
helmfile apply

# Or using Helm directly with External Secrets
helm upgrade --install git-diff-extension ./chart/argocd-git-diff-extension \
  --namespace argocd \
  --set logLevel=info \
  --set externalSecret.enabled=true \
  --set externalSecret.clusterSecretStore=cluster-secret-store-internal-secretstore \
  --set image.repository=your-registry/argocd-git-diff-backend \
  --set image.tag=v1.0.0
```

To use a pre-existing secret (Vault Agent, Sealed Secrets, etc.):

```bash
helm upgrade --install git-diff-extension ./chart/argocd-git-diff-extension \
  --namespace argocd \
  --set existingSecret.enabled=true \
  --set existingSecret.name=my-github-credentials
```

### 3. Install the UI extension

Configure ArgoCD to load the UI extension from the backend service. In your ArgoCD Helm values:

```yaml
server:
  extensions:
    enabled: false
  volumes:
    - name: extensions
      emptyDir: {}
  volumeMounts:
    - name: extensions
      mountPath: /app/extensions/
  initContainers:
    - name: extension-installer
      image: quay.io/argoprojlabs/argocd-extension-installer:v0.0.9
      env:
        - name: EXTENSION_URL
          value: "http://extension-backend.argocd.svc.cluster.local/static/extension.tar.gz"
      volumeMounts:
        - name: extensions
          mountPath: /tmp/extensions/
      securityContext:
        runAsUser: 1000
        allowPrivilegeEscalation: false
```

### 4. Configure ArgoCD proxy and RBAC

Enable the proxy extension feature in `argocd-cmd-params-cm`:

```yaml
server.enable.proxy.extension: "true"
```

Configure the backend URL in `argocd-cm`:

```yaml
extension.config: |-
  extensions:
    - name: git-diff-extension
      backend:
        services:
          - url: http://extension-backend.argocd.svc.cluster.local:80
```

Grant extension access in `argocd-rbac-cm`:

```csv
policy.csv: |-
  p, role:readonly, extensions, invoke, git-diff-extension, allow
  p, role:admin, extensions, invoke, git-diff-extension, allow
```

## Local Testing with Minikube

### Prerequisites

- [Minikube](https://minikube.io/docs/start/)
- [Helmfile](https://helmfile.readthedocs.io/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- Docker

### Step 1: Start Minikube

```bash
minikube start --cpus 4 --memory 8192
eval $(minikube docker-env)   # point Docker CLI at Minikube's daemon
```

### Step 2: Build the backend image into Minikube

```bash
docker build -t local/argocd-diff-backend:latest backend/
```

The Helm chart defaults `imagePullPolicy: IfNotPresent` and `image.repository: local/argocd-diff-backend`, so no registry push is needed.

### Step 3: Deploy ArgoCD + the extension

```bash
# Export a GitHub token for local testing (GitHub App not required locally)
export GITHUB_TOKEN=ghp_your_personal_access_token

helmfile apply
```

This deploys ArgoCD and the `git-diff-extension` backend service into the `argocd` namespace.

### Step 4: Access ArgoCD UI

```bash
# Port-forward the ArgoCD server
kubectl port-forward svc/argo-cd-argocd-server -n argocd 8080:443

# Retrieve the initial admin password
kubectl get secret argocd-initial-admin-secret -n argocd \
  -o jsonpath='{.data.password}' | base64 -d && echo
```

Open https://localhost:8080 and log in with username `admin`.

### Step 5: Create a test Application

```yaml
# test-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: test-app
  namespace: argocd
  annotations:
    argocd-git-diff-extension/source-repo-url: https://github.com/argoproj/argo-cd
spec:
  project: default
  source:
    repoURL: https://github.com/argoproj/argo-cd
    targetRevision: v2.10.0
    path: manifests/install
  destination:
    server: https://kubernetes.default.svc
    namespace: default
```

```bash
kubectl apply -f test-app.yaml
```

In the ArgoCD UI, open the application, click any `Deployment` resource, and select the **Git Diff** tab.

### Step 6: Verify backend logs

```bash
kubectl logs -n argocd -l app=git-diff-extension-extension-backend -f
```

### Cleanup

```bash
minikube delete
```

## Development

### Backend

```bash
# Run all tests
cd backend && go test ./... -v -count=1

# Build binary locally
cd backend && CGO_ENABLED=0 go build -o server main.go

# Test the API directly (requires credentials)
export GITHUB_TOKEN=ghp_yourtoken
./backend/server &
curl "http://localhost:80/api/diff?repoURL=https://github.com/argoproj/argo-cd&targetRevision=v2.10.0"
```

### UI

```bash
cd ui
npm ci
npm test              # run Jest tests once
npm run test:watch    # watch mode
npm run build         # build production bundle into dist/
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GITHUB_APP_ID` | Yes (prod) | GitHub App ID |
| `GITHUB_APP_INSTALLATION_ID` | Yes (prod) | GitHub App Installation ID |
| `GITHUB_APP_PRIVATE_KEY` | Yes (prod) | RSA private key PEM (newlines as `\n`) |
| `GITHUB_TOKEN` | No (dev) | PAT for local development only |
| `LOG_LEVEL` | No | `debug`, `info` (default), `warn`, `error` |
| `PORT` | No | HTTP listen port (default: `80`) |

## Contributing

See [CLAUDE.md](./CLAUDE.md) for repository layout and development guidance.

[1]: https://github.com/argoproj-labs/argocd-extension-installer
