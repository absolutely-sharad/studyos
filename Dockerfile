# syntax=docker/dockerfile:1
#
#   docker build -t studyos .                          the web app (default target)
#   docker build --target migrate -t studyos-migrate .  one-off job that applies database migrations
#
# NEXT_PUBLIC_* values are baked into the browser bundle at build time, so pass them as build args:
#   docker build --build-arg NEXT_PUBLIC_APP_URL=https://studyos.example.com -t studyos .

# Pin by digest or point at an internal mirror with --build-arg NODE_IMAGE=...
ARG NODE_IMAGE=node:22-slim
FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# ── Dependencies (cached until package files or the Prisma schema change) ──
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# ── Migrations: has the Prisma CLI and nothing else ──
FROM deps AS migrate
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "deploy"]

# ── Build ──
FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_COMPANY_NAME
ARG NEXT_PUBLIC_DEVELOPER_NAME
ARG NEXT_PUBLIC_GITHUB_URL
ARG NEXT_PUBLIC_LINKEDIN_URL
# No database or secrets are needed to build.
RUN npm run build

# ── Runtime: the standalone server only, as an unprivileged user ──
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=/data/uploads
RUN groupadd --system --gid 1001 studyos \
 && useradd --system --uid 1001 --gid studyos --home-dir /app studyos \
 && mkdir -p /data/uploads \
 && chown -R studyos:studyos /data
COPY --from=build --chown=studyos:studyos /app/.next/standalone ./
COPY --from=build --chown=studyos:studyos /app/.next/static ./.next/static
USER studyos
# Uploads live here when STORAGE_DRIVER=local (the default). Mount a persistent volume, or use STORAGE_DRIVER=supabase.
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
