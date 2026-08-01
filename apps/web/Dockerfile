# syntax=docker/dockerfile:1

# ─── Build ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/validation/package.json packages/validation/
COPY packages/config/package.json packages/config/
COPY packages/constants/package.json packages/constants/
COPY packages/utilities/package.json packages/utilities/
COPY packages/design-tokens/package.json packages/design-tokens/
COPY packages/api-client/package.json packages/api-client/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile --filter @medsupply/web...

COPY packages/ packages/
COPY apps/web/ apps/web/

# The API origin is compiled into the bundle, so it is a build argument rather
# than a runtime variable. A deployment that serves the API under the same
# origin can leave it as the default and let the reverse proxy route /api.
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm --filter @medsupply/shared-types build \
 && pnpm --filter @medsupply/validation build \
 && pnpm --filter @medsupply/web build

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
