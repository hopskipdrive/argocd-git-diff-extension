const path = require("path");
const webpack = require("webpack");
const TerserWebpackPlugin = require("terser-webpack-plugin");

const config = {
  // 1. Entry: Now pointing to .tsx
  entry: {
    extension: "./src/index.tsx",
  },
  output: {
    // 2. Output: Keep filename 'main.js' so your GitHub Action doesn't break
    filename: "main.js",
    path: __dirname + "/dist",
    libraryTarget: "window",
    library: ["extensionsAPI", "git-diff-extension"],
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".json"],
  },
  externals: {
    react: "React",
    "react-dom": "ReactDOM",
  },
  optimization: {
    minimize: true,
    minimizer: [
      new TerserWebpackPlugin({
        terserOptions: {
          format: { comments: false },
        },
        extractComments: false,
      }),
    ],
  },
  module: {
    rules: [
      {
        // 3. Loader: Use esbuild-loader for .ts and .tsx files
        test: /\.(ts|js)x?$/,
        loader: "esbuild-loader",
        options: {
          loader: "tsx",
          target: "es2015",
        },
      },
      {
        test: /\.scss$/,
        use: ["style-loader", "css-loader", "sass-loader"],
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
};

module.exports = config;
