FROM node:23-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
ARG NPM_STRICT_SSL=true
RUN if [ "$NPM_STRICT_SSL" = "false" ]; then npm config set strict-ssl false; fi \
  && npm install --no-audit --no-fund

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_CONTEXTHUB_API_URL
ARG NEXT_PUBLIC_CONTEXTHUB_TOKEN
ARG NEXT_PUBLIC_CONTEXTHUB_DEFAULT_PROJECT

RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
