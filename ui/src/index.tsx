import * as React from "react";
import { useEffect, useState } from "react";

interface Application {
  metadata: {
    name: string;
    namespace: string;
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

const styles = {
  container: {
    backgroundColor: "#fff",
    border: "1px solid #d1d5da",
    borderRadius: "3px",
    fontFamily: "SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
    fontSize: "12px",
    lineHeight: "20px",
    color: "#24292e",
    overflowX: "auto" as const,
  },
  header: {
    padding: "10px 15px",
    backgroundColor: "#f6f8fa",
    borderBottom: "1px solid #d1d5da",
    fontWeight: 600,
    color: "#24292e",
  },
  line: {
    display: "flex",
    width: "100%",
  },
  lineNumber: {
    width: "50px",
    minWidth: "50px",
    paddingRight: "10px",
    textAlign: "right" as const,
    color: "rgba(27,31,35,.3)",
    userSelect: "none" as const,
    borderRight: "1px solid #eee",
    marginRight: "10px",
  },
  content: {
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
    flex: 1,
  },
  diffAdded: {
    backgroundColor: "#e6ffed", // Light Green
    color: "#22863a",
  },
  diffRemoved: {
    backgroundColor: "#ffeef0", // Light Red
    color: "#b31d28",
  },
  diffMeta: {
    backgroundColor: "#f1f8ff", // Light Blue
    color: "#0366d6",
    fontWeight: "bold" as const,
  },
  diffHeader: {
    fontWeight: "bold" as const,
    paddingTop: "10px",
    paddingBottom: "5px",
    borderBottom: "1px solid #eee",
    marginBottom: "5px",
    display: "block",
  },
};

const DiffViewer = ({ diffText }: { diffText: string }) => {
  if (!diffText) return <div style={{ padding: 20 }}>No changes detected.</div>;

  const lines = diffText.split("\n");

  return (
    <div style={styles.container}>
      {lines.map((line, index) => {
        let style = {};
        let type = "normal";

        // Simple Heuristics for Git Diff format
        if (line.startsWith("diff --git")) {
          type = "file-header";
          style = styles.diffHeader;
        } else if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("index ")) {
          type = "meta";
          style = { color: "#666" }; // Dim metadata
        } else if (line.startsWith("@@")) {
          type = "chunk-header";
          style = styles.diffMeta;
        } else if (line.startsWith("+")) {
          type = "added";
          style = styles.diffAdded;
        } else if (line.startsWith("-")) {
          type = "removed";
          style = styles.diffRemoved;
        }

        // Don't render empty newlines at end of file
        if (line === "" && index === lines.length - 1) return null;

        return (
          <div key={index} style={{ ...styles.line, ...style }}>
            {/* Fake Line Number Column (Visual only) */}
            <div style={styles.lineNumber}>
               {/* Only show dots or symbols for readability, calculating real line numbers is complex without a library */}
               {type === 'added' && '+'}
               {type === 'removed' && '-'}
            </div>
            <div style={styles.content}>{line}</div>
          </div>
        );
      })}
    </div>
  );
};

export const GitDiffExtension = (props: { application: Application }) => {
  const { application } = props;
  const [diff, setDiff] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDiff = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          appName: application.metadata.name,
          appNamespace: application.metadata.namespace,
          repoURL: application.spec.source.repoURL,
          targetRevision: application.spec.source.targetRevision || "HEAD",
          path: application.spec.source.path || ".",
        });

        const appIdentifier = `${application.metadata.namespace}:${application.metadata.name}`;
        
        const response = await fetch(`/extensions/git-diff-extension/api/diff?${params.toString()}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "argocd-application-name": appIdentifier,
            "argocd-application-namespace": application.metadata.namespace,
            "argocd-project-name": application.spec.project || "default"
          },
          credentials: "include"
        });

        if (!response.ok) {
          throw new Error(`Backend Error: ${response.statusText}`);
        }

        const data = await response.json();
        const rawDiff = typeof data === 'string' ? data : (data.diff || JSON.stringify(data, null, 2));
        
        setDiff(rawDiff);
      } catch (err: any) {
        setError(err.message || "Failed to load git diff");
      } finally {
        setLoading(false);
      }
    };

    if (application) {
      fetchDiff();
    }
  }, [application]);

  return (
    <div style={{ padding: "20px", height: "100%", boxSizing: "border-box" }}>
      <div style={{ marginBottom: "15px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, color: "#444" }}>Git Diff Analysis</h3>
        <span style={{ fontSize: "12px", color: "#666", backgroundColor: "#eee", padding: "4px 8px", borderRadius: "10px" }}>
           Target: {application?.spec?.source?.targetRevision || "HEAD"}
        </span>
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: "40px", color: "#666" }}>
          <i className="fa fa-circle-o-notch fa-spin" style={{ marginRight: "10px" }}></i>
          Loading comparison...
        </div>
      )}

      {!loading && error && (
        <div style={{ padding: "15px", backgroundColor: "#ffeef0", color: "#b31d28", borderRadius: "4px", border: "1px solid #f9dbe0" }}>
          <i className="fa fa-exclamation-triangle" style={{ marginRight: "8px" }}></i>
          <strong>Error:</strong> {error}
        </div>
      )}

      {!loading && !error && <DiffViewer diffText={diff} />}
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
