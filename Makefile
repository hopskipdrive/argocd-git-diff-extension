# Configuration
REGISTRY ?= docker.io/your-username
IMAGE_NAME ?= argocd-git-diff-backend
TAG ?= v1.0.0
IMG = $(REGISTRY)/$(IMAGE_NAME):$(TAG)

# Go Build Flags
GOOS ?= linux
GOARCH ?= amd64

.PHONY: all build-ui package-ui checksum build-backend docker-build docker-push clean

all: build-ui package-ui checksum build-backend

# --- Frontend Steps ---
build-ui:
	@echo "Building React UI..."
	cd ui && npm ci && npm run build

package-ui:
	@echo "Packaging UI for Release..."
	# ArgoCD expects a tarball. We tar the content of dist/ so extension.js is at the root or properly nested.
	# For Resource Extensions, usually we just want the extension.js file.
	cd ui/dist && tar -czvf ../../git-diff-extension.tar.gz extension.js

checksum:
	@echo "--------------------------------------------------------"
	@echo "SHA256 Checksum (Copy this to your Helmfile):"
	@shasum -a 256 git-diff-extension.tar.gz
	@echo "--------------------------------------------------------"

# --- Backend Steps ---
build-backend:
	@echo "Compiling Go Backend..."
	# Using CGO_ENABLED=0 for static binary (compatible with distroless/scratch)
	cd backend && CGO_ENABLED=0 GOOS=$(GOOS) GOARCH=$(GOARCH) go build -a -installsuffix cgo -o server main.go

docker-build:
	@echo "Building Backend Docker Image..."
	docker build -t $(IMG) backend/

docker-push:
	@echo "Pushing Backend Docker Image..."
	docker push $(IMG)

clean:
	rm -rf ui/dist backend/server git-diff-extension.tar.gz
