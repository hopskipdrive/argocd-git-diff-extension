FROM node:18-alpine as builder
WORKDIR /app
COPY package*.json ./
RUN npm install 
COPY . .
# This runs the new script that creates the 'resources' folder structure and tarball
RUN npm run build 

# Runtime stage
FROM alpine:latest
WORKDIR /app/dist

# 1. We ONLY need the tarball now.
# The individual main.js and extension.yaml are inside this archive.
COPY --from=builder /app/dist/extension.tar.gz .

# (Removed the failing COPY commands for main.js and extension.yaml)

CMD ["tail", "-f", "/dev/null"]
