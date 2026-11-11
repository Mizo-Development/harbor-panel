FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/agent/package.json apps/agent/package.json
COPY packages/sdk/package.json packages/sdk/package.json
RUN npm ci
COPY . .
ENV API_URL=http://api:4000
RUN npm run db:generate && npm run build
RUN mkdir -p apps/web/.next/standalone/apps/web/.next && cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app /app
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=4000 EXTENSIONS_DIR=/data/extensions
USER node
EXPOSE 3000 4000
CMD ["node","apps/api/dist/main.js"]
