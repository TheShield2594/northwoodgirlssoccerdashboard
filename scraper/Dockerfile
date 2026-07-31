FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
# Run unprivileged; the scrape cache volume mounts at /cache and must be
# writable by the node user (mkdir -p in http.ts handles subdirs).
RUN mkdir -p /cache && chown node:node /cache
USER node
CMD ["npm", "run", "start"]
