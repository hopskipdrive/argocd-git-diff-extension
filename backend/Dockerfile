# 1. Reference the UI image to get the artifacts
FROM local/argocd-diff-extension-ui:latest as ui-source

# 2. Build the Backend
FROM node:18-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY src ./src

# 3. Create a folder for static assets
RUN mkdir -p static

# 4. COPY the tarball from the UI image into this image
COPY --from=ui-source /app/dist/extension.tar.gz ./static/extension.tar.gz

EXPOSE 4000
CMD ["node", "src/index.js"]
