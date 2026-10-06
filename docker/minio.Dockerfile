# Build official pinned releases because prebuilt community images are unavailable.
FROM golang:1.26-bookworm AS minio-build
ENV CGO_ENABLED=0 GOBIN=/out
RUN go install github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z

FROM golang:1.26-bookworm AS mc-build
ENV CGO_ENABLED=0 GOBIN=/out
RUN go install github.com/minio/mc@RELEASE.2025-08-13T08-35-41Z

FROM debian:bookworm-slim AS minio
COPY --from=minio-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=minio-build /out/minio /usr/local/bin/minio
RUN mkdir -p /data && chown 1000:1000 /data
USER 1000:1000
EXPOSE 9000 9001
ENTRYPOINT ["minio"]

FROM debian:bookworm-slim AS mc
COPY --from=mc-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=mc-build /out/mc /usr/local/bin/mc
ENTRYPOINT ["mc"]
