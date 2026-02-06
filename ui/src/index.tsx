import * as React from "react";
import { useEffect, useState } from "react";

interface Application {
  metadata: {
    name: string;
    namespace: string;
  };
  spec: {
    source: {
      repoURL: string;
      targetRevision: string;
      path?: string;
    };
  };
}

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
            "Argocd-Application-Name": appIdentifier,
            "Argocd-Application-Namespace": application.metadata.namespace
          }
        });

        if (!response.ok) {
          throw new Error(`Backend Error: ${response.statusText}`);
        }

        const data = await response.text();
        setDiff(data);
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

  const styles = {
    container: {
      padding: "20px",
      backgroundColor: "#fff",
      borderRadius: "4px",
      boxShadow: "0 1px 2px 0 rgba(0,0,0,0.2)",
      minHeight: "200px",
    },
    header: {
      marginBottom: "15px",
      borderBottom: "1px solid #eee",
      paddingBottom: "10px",
    },
    codeBlock: {
      backgroundColor: "#f6f8fa",
      padding: "15px",
      borderRadius: "4px",
      fontFamily: "Monaco, Consolas, 'Courier New', monospace",
      fontSize: "12px",
      whiteSpace: "pre-wrap" as const,
      overflowX: "auto" as const,
      border: "1px solid #e1e4e8",
    },
    error: {
      color: "#d93025",
      padding: "10px",
      backgroundColor: "#fce8e6",
      borderRadius: "4px",
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={{ margin: 0 }}>Git Diff Analysis</h3>
        <small style={{ color: "#666" }}>
          Comparing <strong>{application?.spec?.source?.targetRevision}</strong> against live state.
        </small>
      </div>

      {loading && <p>Loading diff data from backend...</p>}

      {!loading && error && (
        <div style={styles.error}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {!loading && !error && (
        <div style={styles.codeBlock}>
          {diff || "No changes detected or empty response."}
        </div>
      )}
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
