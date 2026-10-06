FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY scripts/fiber-timer-clock.mjs scripts/patch-fiber-timer.mjs scripts/copy-asset-decoders.mjs ./scripts/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.28-alpine AS production
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

# Keep the default Docker target compatible with the development Compose stack.
FROM build AS development
EXPOSE 5173
CMD ["npm", "run", "dev"]
