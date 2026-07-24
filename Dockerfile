# AlphaStudio local-first image (no Docker socket, no privileged).
# Core mode by default: optional binaries may be absent; capabilities stay honest.
FROM node:22-bookworm-slim

WORKDIR /app

# System fonts help headless document rendering when LibreOffice is later layered.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-dejavu-core \
    python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --no-audit --no-fund

COPY . .

# Frontend + server emit
RUN npm run build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data \
    SERVE_FRONTEND=1 \
    LOG_LEVEL=info \
    ALLOW_INSECURE_BIND=1

# Persistent app data (uploads, outputs, SQLite)
VOLUME ["/data"]

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Prefer explicit auth token in non-loopback deployments
CMD ["node", "server/dist/index.js"]
