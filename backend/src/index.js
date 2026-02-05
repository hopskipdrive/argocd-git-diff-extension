const express = require('express');
const cors = require('cors');
const { getCommitDiff } = require('./githubClient');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;
const path = require('path');

// Allow CORS so the ArgoCD UI (running on a different port/domain) can hit this
app.use(cors());
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, '../static')));

// In-memory mapping of Container Image Names -> Source Code Repos
// In production, this might come from a ConfigMap or a DB
const REPO_MAPPING = {
  'heptio-images/ks-guestbook-demo': { owner: 'argoproj', repo: 'argocd-example-apps' },
  'google-samples/gb-frontend': { owner: 'argoproj', repo: 'argocd-example-apps' },
  'gcr.io/google-samples/gb-frontend': { owner: 'argoproj', repo: 'argocd-example-apps' }
};

app.get('/api/diff', async (req, res) => {
  try {
    const { base, head, imageName } = req.query;

    if (!base || !head || !imageName) {
      return res.status(400).json({ error: 'Missing base, head, or imageName parameters' });
    }

    // 1. Resolve the Source Repository from the Image Name
    // We strip the registry (e.g. docker.io/) if present to match our mapping keys
    const cleanImageName = imageName.split('/').slice(-2).join('/'); 
    const repoConfig = REPO_MAPPING[cleanImageName];

    if (!repoConfig) {
      return res.status(404).json({ error: `No source repo mapping found for image: ${cleanImageName}` });
    }

    const baseSHA = "d008f89b0c56846bd86ab9fa0ad5239386e91f3a"
    const headSHA = "529b4edf726cfa4ed3eb170593a9acce15a7b0b5"

    console.log(`Fetching diff for ${repoConfig.repo}: ${baseSHA}...${headSHA}`);

    // 2. Fetch Diff from GitHub
    const diffData = await getCommitDiff(repoConfig.owner, repoConfig.repo, baseSHA, headSHA);
    
    res.json(diffData);

  } catch (error) {
    console.error("Diff Error:", error.message);
    res.status(500).json({ error: 'Failed to fetch diff', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Extension Backend running on port ${PORT}`);
});
