const axios = require('axios');

const getCommitDiff = async (owner, repo, baseSha, headSha) => {
  const token = process.env.GITHUB_TOKEN;
  
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set in environment variables");
  }

  // GitHub Compare API: https://docs.github.com/en/rest/commits/commits?apiVersion=2022-11-28#compare-two-commits
  const url = `https://api.github.com/repos/${owner}/${repo}/compare/${baseSha}...${headSha}`;

  const response = await axios.get(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });

  // We return the list of files and the patch (diff) data
  return response.data.files.map(file => ({
    filename: file.filename,
    status: file.status,     // added, removed, modified
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch         // The actual unified diff string
  }));
};

module.exports = { getCommitDiff };
