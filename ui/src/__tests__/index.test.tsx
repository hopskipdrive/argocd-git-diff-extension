import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import { GitDiffExtension, resolveRepoURL, resolveRevision } from "../index";

// --- Test fixtures ---

const makeApp = (overrides?: Partial<any>) => ({
  metadata: {
    name: "rails-api",
    namespace: "production",
    annotations: {},
    ...overrides?.metadata,
  },
  spec: {
    project: "production",
    source: {
      repoURL: "https://github.com/hopskipdrive/infra-monorepo",
      targetRevision: "abc123def456",
      path: "gitops/application/rails-api",
    },
    ...overrides?.spec,
  },
});

// --- resolveRepoURL tests ---

describe("resolveRepoURL", () => {
  it("returns spec.source.repoURL when no annotation is present", () => {
    const app = makeApp();
    expect(resolveRepoURL(app)).toBe("https://github.com/hopskipdrive/infra-monorepo");
  });

  it("returns annotation value when argocd-git-diff-extension/source-repo-url is set", () => {
    const app = makeApp({
      metadata: {
        name: "rails-api",
        namespace: "production",
        annotations: {
          "argocd-git-diff-extension/source-repo-url": "https://github.com/hopskipdrive/rails-api",
        },
      },
    });
    expect(resolveRepoURL(app)).toBe("https://github.com/hopskipdrive/rails-api");
  });

  it("prefers annotation over spec.source.repoURL", () => {
    const app = makeApp({
      metadata: {
        name: "rails-api",
        namespace: "production",
        annotations: {
          "argocd-git-diff-extension/source-repo-url": "https://github.com/hopskipdrive/rails-api",
        },
      },
    });
    // spec.source.repoURL is still the monorepo — annotation should win
    expect(resolveRepoURL(app)).toBe("https://github.com/hopskipdrive/rails-api");
    expect(resolveRepoURL(app)).not.toBe("https://github.com/hopskipdrive/infra-monorepo");
  });

  it("handles missing annotations object gracefully", () => {
    const app = makeApp({ metadata: { name: "test", namespace: "default" } });
    // No annotations key at all — should fall back to spec
    expect(resolveRepoURL(app)).toBe("https://github.com/hopskipdrive/infra-monorepo");
  });

  it("handles empty string annotation by falling back to spec", () => {
    const app = makeApp({
      metadata: {
        name: "rails-api",
        namespace: "production",
        annotations: { "argocd-git-diff-extension/source-repo-url": "" },
      },
    });
    // Empty string is falsy, should fall back
    expect(resolveRepoURL(app)).toBe("https://github.com/hopskipdrive/infra-monorepo");
  });
});

// --- resolveRevision tests ---

describe("resolveRevision", () => {
  it("returns spec.source.targetRevision when no annotation is present", () => {
    const app = makeApp();
    expect(resolveRevision(app)).toBe("abc123def456");
  });

  it("returns annotation value when argocd-git-diff-extension/source-revision is set", () => {
    const app = makeApp({
      metadata: {
        name: "rails-api",
        namespace: "production",
        annotations: {
          "argocd-git-diff-extension/source-revision": "v2.3.1",
        },
      },
    });
    expect(resolveRevision(app)).toBe("v2.3.1");
  });

  it("falls back to HEAD when targetRevision is missing", () => {
    const app = makeApp({
      spec: {
        project: "default",
        source: {
          repoURL: "https://github.com/hopskipdrive/rails-api",
          targetRevision: "",
          path: ".",
        },
      },
    });
    expect(resolveRevision(app)).toBe("HEAD");
  });
});

// --- GitDiffExtension component tests ---

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

afterEach(() => {
  jest.clearAllMocks();
});

describe("GitDiffExtension", () => {
  it("renders loading state initially", () => {
    // fetch never resolves during this test
    mockFetch.mockImplementation(() => new Promise(() => {}));

    render(<GitDiffExtension application={makeApp()} />);

    expect(screen.getByText(/Loading comparison data/i)).toBeInTheDocument();
  });

  it("renders diff files on successful fetch", async () => {
    const diffData = {
      files: [
        {
          filename: "app/models/user.rb",
          status: "modified",
          additions: 5,
          deletions: 2,
          patch: "@@ -1,3 +1,4 @@\n class User\n+  attr_reader :name\n end",
          blob_url: "https://github.com/hopskipdrive/rails-api/blob/abc/app/models/user.rb",
        },
      ],
      html_url: "https://github.com/hopskipdrive/rails-api/compare/abc~1...abc",
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => diffData,
    });

    render(<GitDiffExtension application={makeApp()} />);

    await waitFor(() => {
      expect(screen.getByText("app/models/user.rb")).toBeInTheDocument();
    });

    expect(screen.getByText(/View on GitHub/i)).toBeInTheDocument();
  });

  it("renders empty state when no files are changed", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ files: [], html_url: "" }),
    });

    render(<GitDiffExtension application={makeApp()} />);

    await waitFor(() => {
      expect(screen.getByText(/No changes detected/i)).toBeInTheDocument();
    });
  });

  it("renders error state when fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => '{"error":"Internal Server Error"}',
    });

    render(<GitDiffExtension application={makeApp()} />);

    await waitFor(() => {
      expect(screen.getByText(/Backend error \(500\)/i)).toBeInTheDocument();
    });
  });

  it("renders error state when network throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));

    render(<GitDiffExtension application={makeApp()} />);

    await waitFor(() => {
      expect(screen.getByText(/Network failure/i)).toBeInTheDocument();
    });
  });

  it("shows the effective repo URL from annotation in the header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ files: [], html_url: "" }),
    });

    const app = makeApp({
      metadata: {
        name: "rails-api",
        namespace: "production",
        annotations: {
          "argocd-git-diff-extension/source-repo-url": "https://github.com/hopskipdrive/rails-api",
        },
      },
    });

    render(<GitDiffExtension application={app} />);

    await waitFor(() => {
      expect(screen.getByText("https://github.com/hopskipdrive/rails-api")).toBeInTheDocument();
    });
  });

  it("passes gitRepoURL from annotation to the backend fetch call", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ files: [], html_url: "" }),
    });

    const app = makeApp({
      metadata: {
        name: "rails-api",
        namespace: "production",
        annotations: {
          "argocd-git-diff-extension/source-repo-url": "https://github.com/hopskipdrive/rails-api",
        },
      },
    });

    render(<GitDiffExtension application={app} />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const fetchURL: string = mockFetch.mock.calls[0][0];
    expect(fetchURL).toContain("gitRepoURL=https%3A%2F%2Fgithub.com%2Fhopskipdrive%2Frails-api");
    // Also includes original repoURL (the monorepo)
    expect(fetchURL).toContain("repoURL=https%3A%2F%2Fgithub.com%2Fhopskipdrive%2Finfra-monorepo");
  });

  it("sends correct ArgoCD proxy headers", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ files: [], html_url: "" }),
    });

    render(<GitDiffExtension application={makeApp()} />);

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const fetchOptions = mockFetch.mock.calls[0][1];
    expect(fetchOptions.headers["argocd-application-name"]).toBe("production:rails-api");
    expect(fetchOptions.headers["argocd-application-namespace"]).toBe("production");
    expect(fetchOptions.headers["argocd-project-name"]).toBe("production");
  });

  it("renders the revision in the header subtitle", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ files: [], html_url: "" }),
    });

    render(<GitDiffExtension application={makeApp()} />);

    await waitFor(() => {
      expect(screen.getByText("abc123def456")).toBeInTheDocument();
    });
  });

  it("renders multiple diff files", async () => {
    const diffData = {
      files: [
        { filename: "app/models/user.rb", status: "modified", additions: 1, deletions: 0, patch: "+added", blob_url: "" },
        { filename: "app/controllers/users_controller.rb", status: "added", additions: 20, deletions: 0, patch: "+new file", blob_url: "" },
      ],
      html_url: "https://github.com/hopskipdrive/rails-api/compare/abc~1...abc",
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => diffData,
    });

    render(<GitDiffExtension application={makeApp()} />);

    await waitFor(() => {
      expect(screen.getByText("app/models/user.rb")).toBeInTheDocument();
      expect(screen.getByText("app/controllers/users_controller.rb")).toBeInTheDocument();
    });
  });
});
