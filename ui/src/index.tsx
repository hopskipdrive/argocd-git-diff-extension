import * as React from "react";
import { useEffect, useState } from "react";

// --- Constants ---

/**
 * Annotation key placed on an ArgoCD Application to override the source repo URL.
 * Useful when the Application points to a GitOps monorepo but the application
 * code lives in a separate repository.
 *
 * Example annotation on an ArgoCD Application:
 *   argocd-git-diff-extension/source-repo-url: https://github.com/hopskipdrive/rails-api
 */
const ANNOTATION_GIT_REPO = "argocd-git-diff-extension/source-repo-url";

/**
 * Annotation key to override the target revision used for diffing.
 * Optional — falls back to spec.source.targetRevision if absent.
 */
const ANNOTATION_REVISION = "argocd-git-diff-extension/source-revision";

// --- Types ---

interface Application {
  metadata: {
    name: string;
    namespace: string;
    annotations?: Record<string, string>;
  };
  spec: {
    project: string;
    source: {
      repoURL: string;
      targetRevision: string;
      path?: string;
    };
  };
}

interface DiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string;
  blob_url?: string;
}

interface DiffResponse {
  files: DiffFile[];
  html_url: string;
}

// --- Styles ---

const styles = {
  container: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    color: "#24292e",
    height: "100%",
    display: "flex",
    flexDirection: "column" as const,
  },
  headerBar: {
    padding: "15px 20px",
    borderBottom: "1px solid #e1e4e8",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  title: {
    margin: 0,
    fontSize: "18px",
    fontWeight: 600,
    color: "#24292e",
  },
  subtitle: {
    margin: "4px 0 0 0",
    fontSize: "12px",
    color: "#586069",
  },
  repoLabel: {
    margin: "2px 0 0 0",
    fontSize: "11px",
    color: "#586069",
    fontFamily: "SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
  },
  githubBtn: {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 12px",
    fontSize: "12px",
    fontWeight: 500,
    lineHeight: "20px",
    color: "#24292e",
    backgroundColor: "#fafbfc",
    border: "1px solid rgba(27,31,35,0.15)",
    borderRadius: "6px",
    textDecoration: "none",
    cursor: "pointer",
    boxShadow: "0 1px 0 rgba(27,31,35,0.04), inset 0 1px 0 rgba(255,255,255,0.25)",
    transition: "background-color 0.2s cubic-bezier(0.3, 0, 0.5, 1)",
  },
  scrollArea: {
    padding: "20px",
    overflowY: "auto" as const,
    flex: 1,
    backgroundColor: "#f6f8fa",
  },
  fileCard: {
    border: "1px solid #d1d5da",
    borderRadius: "6px",
    marginBottom: "20px",
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  fileHeader: {
    padding: "10px 16px",
    backgroundColor: "#f6f8fa",
    borderBottom: "1px solid #d1d5da",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "12px",
  },
  fileName: {
    fontWeight: 600,
    fontSize: "13px",
    fontFamily: "SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
    color: "#24292e",
  },
  fileStats: {
    fontSize: "12px",
    color: "#586069",
    fontWeight: 600,
  },
  diffContainer: {
    fontFamily: "SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
    fontSize: "12px",
    lineHeight: "20px",
    overflowX: "auto" as const,
    backgroundColor: "#fff",
    padding: "0",
  },
  line: {
    display: "flex",
    width: "100%",
  },
  lineNumber: {
    width: "40px",
    minWidth: "40px",
    textAlign: "right" as const,
    paddingRight: "10px",
    color: "rgba(27,31,35,.3)",
    userSelect: "none" as const,
    borderRight: "1px solid #eee",
    marginRight: "10px",
  },
  content: {
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
    flex: 1,
    paddingRight: "10px",
  },
  added: { backgroundColor: "#e6ffed", color: "#22863a" },
  removed: { backgroundColor: "#ffeef0", color: "#b31d28" },
  chunk: { backgroundColor: "#f1f8ff", color: "#0366d6", fontWeight: "bold" as const },
  normal: { color: "#24292e" },
};

// --- Helpers ---

const getLanguageLabel = (filename: string): string => {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "rb": return "Ruby";
    case "js": return "JavaScript";
    case "ts": return "TypeScript";
    case "tsx": return "React TS";
    case "go": return "Go";
    case "py": return "Python";
    case "yaml": case "yml": return "YAML";
    case "json": return "JSON";
    case "md": return "Markdown";
    case "sh": return "Shell";
    case "dockerfile": return "Docker";
    default: return ext?.toUpperCase() || "Text";
  }
};

/**
 * Resolves the effective git repo URL for the diff request.
 * Prefers the annotation (for monorepo GitOps) over spec.source.repoURL.
 */
export const resolveRepoURL = (app: Application): string => {
  return app.metadata?.annotations?.[ANNOTATION_GIT_REPO] || app.spec?.source?.repoURL || "";
};

/**
 * Resolves the effective target revision.
 * Prefers the annotation over spec.source.targetRevision.
 */
export const resolveRevision = (app: Application): string => {
  return app.metadata?.annotations?.[ANNOTATION_REVISION] || app.spec?.source?.targetRevision || "HEAD";
};

// --- Sub-components ---

const FileDiffViewer = ({ file }: { file: DiffFile }) => {
  if (!file.patch) {
    return (
      <div style={styles.fileCard}>
        <div style={styles.fileHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={styles.fileName}>{file.filename}</span>
            <span style={{ fontSize: "11px", color: "#666", border: "1px solid #ddd", borderRadius: "3px", padding: "0 4px" }}>
              {file.status}
            </span>
          </div>
        </div>
        <div style={{ padding: "20px", fontStyle: "italic", color: "#666", textAlign: "center" }}>
          Binary file or no patch recorded.
        </div>
      </div>
    );
  }

  const lines = file.patch.split("\n");

  return (
    <div style={styles.fileCard}>
      <div style={styles.fileHeader}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <i className="fa fa-file-text-o" style={{ color: "#666" }} />
          <span style={styles.fileName}>{file.filename}</span>
          <span style={{
            backgroundColor: "#eff3f6",
            border: "1px solid #e1e4e8",
            borderRadius: "2rem",
            padding: "0 8px",
            fontSize: "10px",
            color: "#586069",
            fontWeight: 500,
          }}>
            {getLanguageLabel(file.filename)}
          </span>
        </div>
        <div style={styles.fileStats}>
          <span style={{ color: "#28a745", marginRight: 10 }}>+{file.additions}</span>
          <span style={{ color: "#cb2431" }}>-{file.deletions}</span>
        </div>
      </div>

      <div style={styles.diffContainer}>
        {lines.map((line, idx) => {
          let lineStyle = {};
          let type = "normal";

          if (line.startsWith("@@")) {
            type = "chunk";
            lineStyle = styles.chunk;
          } else if (line.startsWith("+") && !line.startsWith("+++")) {
            type = "added";
            lineStyle = styles.added;
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            type = "removed";
            lineStyle = styles.removed;
          }

          if (idx === lines.length - 1 && line === "") return null;

          return (
            <div key={idx} style={{ ...styles.line, ...lineStyle }}>
              <div style={styles.lineNumber}>
                {type === "added" && "+"}
                {type === "removed" && "-"}
              </div>
              <div style={styles.content}>{line}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// --- Main Extension Component ---

export const GitDiffExtension = (props: { application: Application }) => {
  const { application } = props;
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [githubLink, setGithubLink] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [effectiveRepo, setEffectiveRepo] = useState<string>("");

  useEffect(() => {
    if (!application) return;

    const fetchDiff = async () => {
      setLoading(true);
      setError(null);
      setFiles([]);
      setGithubLink("");

      // Resolve repo and revision — annotation takes precedence for monorepo GitOps.
      const gitRepoURL = resolveRepoURL(application);
      const targetRevision = resolveRevision(application);
      setEffectiveRepo(gitRepoURL);

      try {
        const params = new URLSearchParams({
          appName: application.metadata.name,
          appNamespace: application.metadata.namespace,
          // repoURL is the spec value (may be gitops monorepo)
          repoURL: application.spec.source.repoURL,
          // gitRepoURL is the effective app repo (from annotation or spec)
          gitRepoURL: gitRepoURL,
          targetRevision: targetRevision,
          path: application.spec.source.path || ".",
        });

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "argocd-application-name": `${application.metadata.namespace}:${application.metadata.name}`,
          "argocd-application-namespace": application.metadata.namespace,
          "argocd-project-name": application.spec.project || "default",
        };

        const response = await fetch(
          `/extensions/git-diff-extension/api/diff?${params.toString()}`,
          { method: "GET", headers, credentials: "include" }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Backend error (${response.status}): ${errorText}`);
        }

        const data: DiffResponse = await response.json();
        setFiles(data.files || []);
        setGithubLink(data.html_url || "");
      } catch (err: any) {
        console.error("Git Diff Extension error:", err);
        setError(err.message || "Failed to load git diff");
      } finally {
        setLoading(false);
      }
    };

    fetchDiff();
  }, [application]);

  const revision = resolveRevision(application);

  return (
    <div style={styles.container}>
      <div style={styles.headerBar}>
        <div>
          <h3 style={styles.title}>Git Diff Analysis</h3>
          <p style={styles.subtitle}>
            <strong>{revision}</strong> vs parent commit
          </p>
          {effectiveRepo && (
            <p style={styles.repoLabel}>{effectiveRepo}</p>
          )}
        </div>
        {githubLink && (
          <a href={githubLink} target="_blank" rel="noreferrer" style={styles.githubBtn}>
            View on GitHub <i className="fa fa-external-link" style={{ marginLeft: "6px" }} />
          </a>
        )}
      </div>

      <div style={styles.scrollArea}>
        {loading && (
          <div style={{ textAlign: "center", padding: "60px", color: "#586069" }}>
            <i className="fa fa-circle-o-notch fa-spin fa-2x" style={{ marginBottom: "15px", display: "block" }} />
            <span>Loading comparison data...</span>
          </div>
        )}

        {!loading && error && (
          <div style={{ padding: "15px", backgroundColor: "#ffeef0", color: "#b31d28", borderRadius: "6px", border: "1px solid #f9dbe0" }}>
            <i className="fa fa-exclamation-triangle" style={{ marginRight: "8px" }} />
            <strong>Error:</strong> {error}
          </div>
        )}

        {!loading && !error && files.length === 0 && (
          <div style={{ padding: "40px", textAlign: "center", color: "#586069", border: "1px dashed #d1d5da", borderRadius: "6px", backgroundColor: "#fff" }}>
            <i className="fa fa-check-circle-o" style={{ fontSize: "24px", color: "#28a745", marginBottom: "10px", display: "block" }} />
            No changes detected for this revision.
          </div>
        )}

        {!loading && !error && files.map((file, idx) => (
          <FileDiffViewer key={`${file.filename}-${idx}`} file={file} />
        ))}
      </div>
    </div>
  );
};

export const component = GitDiffExtension;

((window: any) => {
  window?.extensionsAPI?.registerResourceExtension(
    component,
    "*",
    "Deployment",
    "Git Diff",
    { icon: "fa fa-git" }
  );
})(window);
