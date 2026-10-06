FROM golang:1.26-bookworm AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY db ./db
RUN CGO_ENABLED=0 go build -o /api ./cmd/api

FROM node:24-bookworm-slim AS assets
WORKDIR /asset-tools
COPY asset-tools/package.json asset-tools/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY asset-tools/process.mjs asset-tools/inventory.mjs asset-tools/chunks.mjs asset-tools/shared-images.mjs asset-tools/spatial-split.mjs ./

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /api /api
COPY --from=assets /asset-tools /app/asset-tools
ENV ASSET_PROCESSOR_SCRIPT=/app/asset-tools/process.mjs
USER node
EXPOSE 8080
ENTRYPOINT ["/api"]
