export const fetchDiff = async (base, head, imageName, backendUrl) => {
  // If backendUrl is missing, try to infer it or default to localhost for dev
  const baseUrl = backendUrl || 'http://localhost:4000';
  
  const response = await fetch(
    `${baseUrl}/api/diff?base=${base}&head=${head}&imageName=${encodeURIComponent(imageName)}`
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch diff');
  }

  return response.json();
};
