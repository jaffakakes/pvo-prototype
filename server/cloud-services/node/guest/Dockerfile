FROM node@sha256:6642ef280aebc09c4541bee0b15c9f89f0f3f3c247ddee79ae1d37eddfdcbbaa
WORKDIR /runtime
COPY server.mjs files.mjs ./
EXPOSE 8080
# Guest logging cannot create an unbounded stdout bill. Generated replies are separately byte-limited.
ENTRYPOINT ["sh", "-c", "exec node /runtime/server.mjs >/dev/null 2>&1"]
