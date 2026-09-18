# Multi-stage build for Cloud Run — follows Next.js's own documented
# standalone-output pattern (node_modules/next/dist/docs/*/self-hosting.md
# via `output: "standalone"` in next.config.js): only traced dependencies
# end up in the final image, not a full `npm install`.
#
# IMPORTANT: .env is excluded via .dockerignore and must stay excluded —
# `output: "standalone"` copies .env into .next/standalone/.env at build
# time, which would otherwise bake real secrets (GEMINI_API_KEY,
# DATAMALL_ACCOUNT_KEY, Upstash credentials) into the image itself. Secrets
# belong in Cloud Run's --set-env-vars / Secret Manager at deploy time, not
# in the image. NEXT_PUBLIC_* vars are the one exception — those are
# inlined into the client JS at build time by design, so they must be
# passed as build args if you want a non-default map tile provider (see
# GCP_DEPLOY.md).

FROM node:20-alpine AS base

FROM base AS deps
# libc6-compat: sharp (pulled in transitively for next/image) needs this on
# Alpine — matches Next.js's official Dockerfile example.
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are inlined into the client bundle at build time —
# optional here since MapView.tsx falls back to Stadia Maps (no key
# needed) when these are unset. Pass with --build-arg if you have a keyed
# tile provider for the deployed domain.
ARG NEXT_PUBLIC_TILE_URL
ARG NEXT_PUBLIC_TILE_ATTRIBUTION
ENV NEXT_PUBLIC_TILE_URL=$NEXT_PUBLIC_TILE_URL
ENV NEXT_PUBLIC_TILE_ATTRIBUTION=$NEXT_PUBLIC_TILE_ATTRIBUTION
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# Cloud Run sets $PORT (defaults to 8080) and expects the container to
# listen on it — server.js (from output: "standalone") reads it via
# Next's own `next start`-equivalent server, which binds to
# process.env.PORT automatically (verified against Next's CLI source,
# next-start reads PORT through Commander's .env('PORT') binding).
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
EXPOSE 8080

CMD ["node", "server.js"]
