# apps/api/Dockerfile — §20.2 of docs/backend-architecture.md
# Multi-stage build: builder -> runtime (non-root, healthcheck)
#
# Dependency strategy: apps/api is an INDEPENDENT package (the root
# package.json declares no npm workspaces). It is installed reproducibly
# with its own lockfile via `npm ci` — never `npm install` fallback.

FROM node:20-alpine AS builder
WORKDIR /app/apps/api

# Install API deps first (better layer caching). The lockfile MUST be
# copied — `npm ci` fails without it.
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci --ignore-scripts

# Prisma schema lives at prisma/schema.prisma (see "prisma.schema" in
# apps/api/package.json); the generated client lands in this package's
# node_modules/.prisma.
COPY prisma/schema.prisma /app/prisma/schema.prisma

# Generate Prisma Client (needs DATABASE_URL dummy for generate)
ENV DATABASE_URL="postgresql://renko:renko@db:5432/renko"
RUN npx prisma generate

# Build sources (explicit copies only — never node_modules/dist)
COPY apps/api/nest-cli.json apps/api/tsconfig.json apps/api/tsconfig.build.json ./
COPY apps/api/src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app/apps/api

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./package.json
COPY --from=builder /app/apps/api/node_modules ./node_modules
# Keep the schema resolvable at the configured ../../prisma/schema.prisma
COPY --from=builder /app/prisma/schema.prisma /app/prisma/schema.prisma

# Install curl for healthcheck and openssl CLI so Prisma detects the
# system OpenSSL 3.x at runtime and selects the matching
# linux-musl-openssl-3.0.x query engine (without it, detection fails and
# Prisma falls back to the openssl-1.1.x engine, which cannot load).
RUN apk add --no-cache curl openssl

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/v1/health || exit 1

CMD ["node", "dist/main.js"]
