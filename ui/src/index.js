import React, { useEffect, useState } from 'react';
import { parseDiff, Diff, Hunk } from 'react-diff-view';
import { fetchDiff } from './api';

// Minimal CSS for the diff viewer to look decent
import 'react-diff-view/style/index.css';

const GitDiffExtension = ({ application, tree, resource }) => {
  const [diffFiles, setDiffFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // 1. EXTRACT CONFIG
  // We grab the backend URL from the config injected by the Helmfile
  // ArgoCD injects this into the global scope or we parse it from the extension config map
  // For this demo, we assume it's available via a global variable or hardcoded for dev
  const backendUrl = window.EXTENSION_CONFIG?.backendUrl || "http://localhost:4000";

  // 2. EXTRACT IMAGE TAGS
  // This logic depends heavily on your specific Manifest structure.
  // We assume a standard Deployment here.
  const liveContainer = resource.liveState?.spec?.template?.spec?.containers?.[0];
  const targetContainer = resource.targetState?.spec?.template?.spec?.containers?.[0];

  const liveImage = liveContainer?.image || '';
  const targetImage = targetContainer?.image || '';

  const getSha = (str) => str.split(':').pop();
  const oldSha = getSha(liveImage);
  const newSha = getSha(targetImage);

  const shouldRun = liveImage && targetImage && oldSha !== newSha;

  useEffect(() => {
    if (shouldRun) {
      loadData();
    }
  }, [oldSha, newSha]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Clean image name (remove tag)
      const imageName = liveImage.split(':')[0]; 
      const data = await fetchDiff(oldSha, newSha, imageName, backendUrl);
      setDiffFiles(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  if (!shouldRun) {
    return (
      <div style={{ padding: 20 }}>
        <p>No image tag change detected or container not found.</p>
        <p>Live: {liveImage}</p>
        <p>Target: {targetImage}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', background: 'white', color: 'black', height: '100%', overflow: 'auto' }}>
      <h3 style={{ borderBottom: '1px solid #ccc', paddingBottom: '10px' }}>
        Code Diff: {oldSha.substring(0,7)} &rarr; {newSha.substring(0,7)}
      </h3>

      {loading && <div>Loading diff from GitHub...</div>}
      {error && <div style={{ color: 'red' }}>Error: {error}</div>}

      {diffFiles.map((file, idx) => {
        // react-diff-view needs a parsed diff object
        // Our backend returns raw patch strings, so we parse them here
        // Note: Ideally backend does this, but for simplicity we do it here
        // If 'file.patch' is the unified diff string:
        const [diff] = parseDiff(file.patch || ''); 
        
        if (!diff) return <div key={idx}>No content change for {file.filename}</div>;

        return (
          <div key={idx} style={{ marginBottom: '20px', border: '1px solid #ddd' }}>
            <div style={{ background: '#f5f5f5', padding: '5px 10px', fontWeight: 'bold' }}>
              {file.filename}
            </div>
            <Diff viewType="unified" diffType={diff.type} hunks={diff.hunks}>
              {hunks => hunks.map(hunk => <Hunk key={hunk.content} hunk={hunk} />)}
            </Diff>
          </div>
        );
      })}
    </div>
  );
};

// Register the extension
((window) => {
  window.extensionsAPI && window.extensionsAPI.registerResourceExtension(
    GitDiffExtension,
    '*',
    'Deployment',
    'Git Diff',
    { icon: "fa fa-chart-area" }
  );
})(window);
