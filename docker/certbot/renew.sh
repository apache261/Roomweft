#!/bin/sh
set -eu

interval=${CERTBOT_RENEW_INTERVAL_SECONDS:-43200}
case "$interval" in
    ''|*[!0-9]*|0) echo "CERTBOT_RENEW_INTERVAL_SECONDS must be a positive integer" >&2; exit 2 ;;
esac
if ! [ "$interval" -gt 0 ] 2>/dev/null; then
    echo "CERTBOT_RENEW_INTERVAL_SECONDS must be a positive integer" >&2
    exit 2
fi

child=
stop() {
    if [ -n "$child" ]; then
        kill -TERM "$child" 2>/dev/null || true
        wait "$child" 2>/dev/null || true
    fi
    exit 0
}
trap stop TERM INT

while :; do
    # Certbot renews only certificates that are due. Retain errors in Docker logs.
    certbot renew --non-interactive --webroot --webroot-path=/var/www/certbot &
    child=$!
    if wait "$child"; then
        echo "Certbot renewal check completed"
    else
        echo "Certbot renewal check failed; retrying after ${interval}s" >&2
    fi
    sleep "$interval" &
    child=$!
    wait "$child"
    child=
done
