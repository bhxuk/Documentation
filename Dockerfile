# ---- build the web client ----
FROM node:24-alpine AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- server deps ----
FROM node:24-alpine AS server
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:24-alpine
LABEL org.opencontainers.image.source="https://github.com/bhxuk/Documentation" \
      org.opencontainers.image.title="Documentation" \
      org.opencontainers.image.description="Self-hosted docs: block-editor pages, code editor and whiteboards in one"
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY --from=server /app/server ./server
COPY --from=client /app/client/dist ./client/dist
COPY VERSION ./VERSION
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server/index.js"]
