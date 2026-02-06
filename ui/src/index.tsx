import * as React from "react";

export const GitDiffExtension = (props: any) => {
  return (
    <div style={{ padding: '20px', backgroundColor: 'white', borderRadius: '4px' }}>
      <h3 style={{ marginTop: 0 }}>Git Diff (TypeScript)</h3>
      <p>Coming soon!</p>
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
