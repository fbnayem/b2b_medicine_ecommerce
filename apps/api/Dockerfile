# syntax=docker/dockerfile:1

# ─── Build ────────────────────────────────────────────────────────────────────
# The workspace packages the API depends on are built here, so the runtime image
# never carries a compiler, a test runner or a lockfile.
FROM node:20-alpine AS build

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo

# Manifests first: a change to source code should not invalidate the dependency
# layer, which is by far the most expensive one to rebuild.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/validation/package.json packages/validation/
COPY packages/config/package.json packages/config/
COPY packages/constants/package.json packages/constants/
COPY packages/utilities/package.json packages/utilities/
COPY packages/design-tokens/package.json packages/design-tokens/
COPY packages/api-client/package.json packages/api-client/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile --filter @medsupply/api...

COPY packages/ packages/
COPY apps/api/ apps/api/

RUN pnpm --filter @medsupply/shared-types build \
 && pnpm --filter @medsupply/validation build \
 && pnpm --filter @medsupply/api build \
 && pnpm --filter @medsupply/api scripts:build

# Production dependencies only, resolved into a self-contained tree so the
# runtime stage needs no package manager at all.
RUN pnpm --filter @medsupply/api --prod deploy /runtime

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# `tini` reaps zombies and forwards SIGTERM, which is what makes the graceful
# shutdown in server.ts actually run instead of the container being killed.
RUN apk add --no-cache tini \
 && addgroup -S medsupply && adduser -S medsupply -G medsupply

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=medsupply:medsupply /runtime/node_modules ./node_modules
COPY --from=build --chown=medsupply:medsupply /runtime/package.json ./package.json
COPY --from=build --chown=medsupply:medsupply /repo/apps/api/dist ./dist

# The migrations and the index check ship with the image, because the release
# sequence in docs/DEPLOYMENT.md runs them against the deployed database:
#
#   docker compose run --rm api node dist-scripts/scripts/checkIndexes.js --apply
#
# Without them an operator would need a full checkout with a matching toolchain
# on the release machine, which is most of what shipping an image avoids.
COPY --from=build --chown=medsupply:medsupply /repo/apps/api/dist-scripts ./dist-scripts

# Never root: a process that is compromised should not also own the filesystem.
USER medsupply

EXPOSE 5000

# Readiness is the honest check — it fails while the database is unreachable, so
# an orchestrator stops sending traffic instead of collecting errors.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
