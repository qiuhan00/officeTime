FROM node:24-slim AS builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-slim
WORKDIR /app

ENV TZ=Asia/Shanghai \
    NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY public ./public
COPY assets ./assets

RUN mkdir -p /app/data
EXPOSE 3000

CMD ["node", "src/server.js"]
