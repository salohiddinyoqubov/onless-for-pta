FROM mirror.gcr.io/library/node:22.17.1-alpine3.22@sha256:5539840ce9d013fa13e3b9814c9353024be7ac75aca5db6d039504a56c04ea59 AS builder

ENV npm_config_audit=false \
    npm_config_fund=false

WORKDIR /build/apps/web

COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

COPY apps/web/index.html apps/web/tsconfig.json apps/web/vite.config.ts ./
COPY apps/web/src ./src
RUN npm run build

FROM ghcr.io/nginx/nginx-unprivileged:1.31-alpine3.24@sha256:f972e5322b9797dc2a6b830030094426437b1ae7032e4644496395336ac6fdac AS runtime

COPY --from=builder --chown=101:101 /build/apps/web/dist /usr/share/nginx/html
COPY --chown=101:101 deploy/nginx.conf /etc/nginx/nginx.conf

USER 101:101
EXPOSE 8080
