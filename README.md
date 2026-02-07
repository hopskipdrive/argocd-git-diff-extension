# ArgoCD Git Diff Extension

The project introduces the ArgoCD extension to enable a side-by-side Git Diff view on the Resource tab.

![](./docs/images/screenshot.png)

This extension is composed of 2 components:
- `git-diff-backend`: A Go service that acts as a secure proxy, handling GitHub API authentication and caching diffs.
- `ui`: A React extension that renders the diffs returned by the backend with syntax highlighting and file-type detection.

## Prerequisites

- Argo CD version 2.6+
- A valid GitHub Personal Access Token (PAT)

## Quick Start

### Install `git-diff-backend`

The `manifests` folder in this repo contains an example of how the
`git-diff-backend` can be installed using Kustomize.

```sh
git clone [https://github.com/](https://github.com/)<YOUR_ORG>/git-diff-extension.git
cd git-diff-extension

# 1. Edit manifests/kustomization.yaml to set your GITHUB_TOKEN
# 2. Apply the manifests
kustomize build ./manifests | kubectl apply -f -
```

This will deploy the backend service into the `argocd` namespace and expose it on port 80.

### Install UI extension

The UI extension needs to be installed by mounting the React component
in Argo CD API server. This process can be automated by using the
[argocd-extension-installer][1] or by configuring `extensionList` in your Argo CD Helm chart.

The yaml file below is an example of how to define a kustomize patch
to install this UI extension manually:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: argocd-server
spec:
  template:
    spec:
      initContainers:
        - name: extension-git-diff
          image: quay.io/argoprojlabs/argocd-extension-installer:v0.0.1
          env:
          - name: EXTENSION_URL
            value: [https://github.com/](https://github.com/)<YOUR_ORG>/git-diff-extension/releases/download/v1.0.0/extension.tar
          - name: EXTENSION_CHECKSUM_URL
            value: [https://github.com/](https://github.com/)<YOUR_ORG>/git-diff-extension/releases/download/v1.0.0/extension_checksums.txt
          volumeMounts:
            - name: extensions
              mountPath: /tmp/extensions/
          securityContext:
            runAsUser: 1000
            allowPrivilegeEscalation: false
      containers:
        - name: argocd-server
          volumeMounts:
            - name: extensions
              mountPath: /tmp/extensions/
      volumes:
        - name: extensions
          emptyDir: {}
```

*Note: If you are using the official Argo CD Helm Chart, you can achieve the same result using the `server.extensions.extensionList` value.*

### Enabling the Git Diff extension in Argo CD

Argo CD needs to have the proxy extension feature enabled for the
backend to work. In order to do so add the following entry
in the `argocd-cmd-params-cm`:

```yaml
server.enable.proxy.extension: "true"
```

The extension needs permission to be invoked by users. To enable it
for all users (or specifically for admins), add the following entry in `argocd-rbac-cm`:

```csv
policy.csv: |-
  p, role:readonly, extensions, invoke, git-diff-extension, allow
  p, role:admin, extensions, invoke, git-diff-extension, allow
```

**Note**: make sure to assign a proper role to the extension policy if you
want to restrict users.

Finally, Argo CD needs to be configured so it knows how to reach the
backend service. In order to do so, add the following section in the
`argocd-cm`:

```yaml
extension.config: |-
  extensions:
    - name: git-diff-extension
      backend:
        services:
          - url: [http://extension-backend.argocd.svc.cluster.local:80](http://extension-backend.argocd.svc.cluster.local:80)
```

**Attention**: The `url` must point to the Kubernetes Service DNS name where your `git-diff-backend` is running.

## Contributing

TODO

[1]: https://github.com/argoproj-labs/argocd-extension-installer
