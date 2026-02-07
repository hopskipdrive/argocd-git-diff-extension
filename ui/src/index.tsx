import * as React from "react";
import { useEffect, useState } from "react";

// --- Types ---
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

// Matches the JSON structure you provided
interface FileDiffData {
  filename: string;
  status: string; // e.g. "modified", "added", "removed"
  additions: number;
  deletions: number;
  patch: string;
}

// --- Styles ---
const styles = {
  container: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    color: "#24292e",
  },
  fileCard: {
    border: "1px solid #d1d5da",
    borderRadius: "6px",
    marginBottom: "20px",
    backgroundColor: "#fff",
    overflow: "hidden", // Clips the content to the rounded corners
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
  // Color classes
  added: { backgroundColor: "#e6ffed", color: "#22863a" },
  removed: { backgroundColor: "#ffeef0", color: "#b31d28" },
  chunk: { backgroundColor: "#f1f8ff", color: "#0366d6", fontWeight: "bold" as const },
  normal: { color: "#24292e" },
};

// --- Helper to guess language (for display purposes) ---
const getLanguageLabel = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'rb': return 'Ruby';
    case 'js': return 'JavaScript';
    case 'ts': return 'TypeScript';
    case 'tsx': return 'React TS';
    case 'go': return 'Go';
    case 'py': return 'Python';
    case 'yaml': case 'yml': return 'YAML';
    case 'json': return 'JSON';
    case 'md': return 'Markdown';
    default: return ext?.toUpperCase() || 'Text';
  }
};

// --- Component to Render a Single File's Diff ---
const FileDiffViewer = ({ file }: { file: FileDiffData }) => {
  if (!file.patch) {
    return (
      <div style={styles.fileCard}>
        <div style={styles.fileHeader}>
           <span style={styles.fileName}>{file.filename}</span>
           <span>{file.status}</span>
        </div>
        <div style={{ padding: 20, fontStyle: "italic", color: "#666" }}>
          Binary file or no changes recorded in patch.
        </div>
      </div>
    );
  }

  const lines = file.patch.split("\n");

  return (
    <div style={styles.fileCard}>
      {/* File Header */}
      <div style={styles.fileHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <i className="fa fa-file-code-o" style={{ color: '#666' }} />
          <span style={styles.fileName}>{file.filename}</span>
          <span style={{ 
            backgroundColor: '#eff3f6', 
            border: '1px solid #e1e4e8', 
            borderRadius: '2rem', 
            padding: '0 7px', 
            fontSize: '10px',
            color: '#666' 
          }}>
            {getLanguageLabel(file.filename)}
          </span>
        </div>
        <div style={styles.fileStats}>
          <span style={{ color: '#28a745', marginRight: 8 }}>+{file.additions}</span>
          <span style={{ color: '#cb2431' }}>-{file.deletions}</span>
        </div>
      </div>

      {/* Diff Content */}
      <div style={styles.diffContainer}>
        {lines.map((line, idx) => {
          let lineStyle = {};
          let type = "normal";

          // Parsing the Git Patch format
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

          // Don't render empty trailing newline if it's the last one
          if (idx === lines.length - 1 && line === "") return null;

          return (
            <div key={idx} style={{ ...styles.line, ...lineStyle }}>
              {/* Gutter (Line Marker) */}
              <div style={styles.lineNumber}>
                {type === 'added' && '+'}
                {type === 'removed' && '-'}
              </div>
              {/* Code Content */}
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
  const [files, setFiles] = useState<FileDiffData[]>([]);
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

        // Headers required by ArgoCD Proxy
        const headers = {
          "Content-Type": "application/json",
          "argocd-application-name": `${application.metadata.namespace}:${application.metadata.name}`,
          "argocd-application-namespace": application.metadata.namespace,
          "argocd-project-name": application.spec.project || "default"
        };

        const response = await fetch(`/extensions/git-diff-extension/api/diff?${params.toString()}`, {
          method: "GET",
          headers: headers,
          credentials: "include"
        });

        if (!response.ok) {
          throw new Error(`Backend Error: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Handle case where backend might return array directly or wrapped object
        // The new structure is [ { filename... }, { filename... } ]
        const fileList = Array.isArray(data) ? data : (data.files || []);
        
        setFiles(fileList);

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
    <div style={styles.container}>
      {/* Extension Header */}
      <div style={{ padding: "20px 20px 10px 20px" }}>
         <h3 style={{ margin: 0, fontWeight: 600 }}>Git Diff Analysis</h3>
         <p style={{ margin: "5px 0 0 0", color: "#586069", fontSize: "14px" }}>
           Comparing <strong>{application?.spec?.source?.targetRevision || "HEAD"}</strong> changes.
         </p>
      </div>

      <div style={{ padding: "20px" }}>
        {loading && (
          <div style={{ textAlign: "center", padding: "40px", color: "#586069" }}>
            <i className="fa fa-circle-o-notch fa-spin" style={{ marginRight: "10px" }}></i>
            Loading comparison...
          </div>
        )}

        {!loading && error && (
          <div style={{ padding: "15px", backgroundColor: "#ffeef0", color: "#b31d28", borderRadius: "6px", border: "1px solid #f9dbe0" }}>
            <i className="fa fa-exclamation-triangle" style={{ marginRight: "8px" }}></i>
            <strong>Error:</strong> {error}
          </div>
        )}

        {!loading && !error && files.length === 0 && (
           <div style={{ padding: "30px", textAlign: "center", color: "#586069", border: "1px dashed #d1d5da", borderRadius: "6px" }}>
             No changes detected for this revision.
           </div>
        )}

        {/* Render List of Files */}
        {!loading && !error && files.map((file, idx) => (
          <FileDiffViewer key={idx} file={file} />
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
