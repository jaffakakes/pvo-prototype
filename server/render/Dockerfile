FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
    && ffmpeg -hide_banner -filters | grep -q ' zscale ' \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./package.json
COPY server/render/ ./server/render/

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server/render/start.js"]
