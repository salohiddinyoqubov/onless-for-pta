FROM docker.dragonflydb.io/dragonflydb/dragonfly:v1.39.0@sha256:0fa01a2b929e704c7a9300d23e7f52002ebd39e90996fb8bb63826aed92fa06f

# Keep the upstream runtime intact while applying published Ubuntu security fixes.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends --only-upgrade openssl libssl3 \
    && rm -rf /var/lib/apt/lists/*

USER 999:999
