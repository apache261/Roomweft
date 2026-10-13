FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY scripts/fiber-timer-clock.mjs scripts/patch-fiber-timer.mjs scripts/copy-asset-decoders.mjs ./scripts/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit --no-fund
COPY . .
ARG VITE_SPLAT_WALKING=off
ARG VITE_SPLAT_STREAMING=off
ENV VITE_SPLAT_WALKING=$VITE_SPLAT_WALKING
ENV VITE_SPLAT_STREAMING=$VITE_SPLAT_STREAMING
ARG VITE_SPLAT_SUPPORT=off
ENV VITE_SPLAT_SUPPORT=$VITE_SPLAT_SUPPORT
RUN npm run build

FROM nginx:1.28-alpine AS production
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

# Keep the default Docker target compatible with the development Compose stack.
FROM build AS development
EXPOSE 5173
CMD ["npm", "run", "dev"]
