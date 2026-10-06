#!/bin/sh
set -eu

: "${CERTBOT_DOMAIN:?Missing CERTBOT_DOMAIN}"
: "${TLS_CERT_FILE:?Missing TLS_CERT_FILE}"
: "${TLS_KEY_FILE:?Missing TLS_KEY_FILE}"

fingerprint() {
    if [ -s "$TLS_CERT_FILE" ] && [ -s "$TLS_KEY_FILE" ]; then
        sha256sum "$TLS_CERT_FILE" "$TLS_KEY_FILE"
    else
        echo pending
    fi
}
render() {
    envsubst '${CERTBOT_DOMAIN}' < /opt/proxy/http.conf.template > /etc/nginx/conf.d/default.conf
    if [ -s "$TLS_CERT_FILE" ] && [ -s "$TLS_KEY_FILE" ]; then
        envsubst '${CERTBOT_DOMAIN} ${TLS_CERT_FILE} ${TLS_KEY_FILE}' \
            < /opt/proxy/https.conf.template >> /etc/nginx/conf.d/default.conf
    fi
}

render
nginx -t
current=$(fingerprint)
nginx -g 'daemon off;' &
server=$!
child=
stop() {
    if [ -n "$child" ]; then kill -TERM "$child" 2>/dev/null || true; fi
    kill -QUIT "$server" 2>/dev/null || true
    wait "$server" 2>/dev/null || true
    exit 0
}
trap stop TERM INT

while kill -0 "$server" 2>/dev/null; do
    sleep 10 &
    child=$!
    wait "$child"
    child=
    next=$(fingerprint)
    if [ "$next" != "$current" ]; then
        # Keep the current workers running until the replacement configuration passes.
        render
        if nginx -t && nginx -s reload; then
            current=$next
            echo 'TLS certificate configuration reloaded'
        else
            echo 'TLS reload failed; retaining active workers and retrying' >&2
        fi
    fi
done
wait "$server"
