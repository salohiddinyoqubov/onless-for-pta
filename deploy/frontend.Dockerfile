FROM busybox:1.37.0-musl@sha256:fc6dddc4c44b1bfe37f41cae8e67d1693828e8f42a91862816d7953e2c9d3f23 AS content

COPY deploy/site /site

FROM ghcr.io/nginx/nginx-unprivileged:1.31-alpine3.24@sha256:f972e5322b9797dc2a6b830030094426437b1ae7032e4644496395336ac6fdac AS runtime

COPY --from=content --chown=101:101 /site /usr/share/nginx/html
COPY --chown=101:101 deploy/nginx.conf /etc/nginx/nginx.conf

USER 101:101
EXPOSE 8080
