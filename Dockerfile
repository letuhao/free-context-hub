FROM node:23-alpine AS base

WORKDIR /app

RUN apk add --no-cache git

COPY package.json package-lock.json* ./
ARG NPM_STRICT_SSL=true
# Some networks MITM HTTPS with a custom CA and break npm inside containers.
# Set build-arg NPM_STRICT_SSL=false to bypass (dev-only).
RUN if [ "$NPM_STRICT_SSL" = "false" ]; then npm config set strict-ssl false; fi \
  && npm ci --no-audit --no-fund

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/index.js"]

FROM node:23-alpine AS ca-base

RUN apk add --no-cache ca-certificates
COPY certs/*.cer /usr/local/share/ca-certificates/
RUN for f in /usr/local/share/ca-certificates/*.cer; do mv "$f" "${f%.cer}.crt"; done \
  && update-ca-certificates

FROM ca-base AS with-ca

WORKDIR /app

RUN apk add --no-cache git

COPY package.json package-lock.json* ./
ARG NPM_STRICT_SSL=true
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/personal_kas.crt
RUN npm config set cafile /usr/local/share/ca-certificates/personal_kas.crt \
  && if [ "$NPM_STRICT_SSL" = "false" ]; then npm config set strict-ssl false; fi \
  && npm ci --no-audit --no-fund

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/index.js"]

