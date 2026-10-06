FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY scripts/fiber-timer-clock.mjs scripts/patch-fiber-timer.mjs scripts/copy-asset-decoders.mjs ./scripts/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit --no-fund
COPY . .
RUN npm run build
EXPOSE 5173
CMD ["npm", "run", "dev"]
