# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=20.11.0

FROM node:${NODE_VERSION}-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_STANDALONE=1
RUN pnpm build
# Standalone output produced under .next/standalone when NEXT_STANDALONE=1

FROM node:${NODE_VERSION}-alpine AS runtime
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app

# Copy standalone server + public + static
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public

# Copy source for worker/scheduler (tsx runtime)
COPY --from=build --chown=app:app /app/src ./src
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/drizzle.config.ts ./drizzle.config.ts

COPY --chown=app:app docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER app
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/entrypoint.sh"]
