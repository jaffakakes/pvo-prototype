FROM node:22-bookworm-slim

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
