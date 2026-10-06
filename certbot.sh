#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$project_dir"

usage() {
  cat <<'EOF'
Usage: ./certbot.sh [--production] COMMAND

  issue       Start HTTP validation and obtain the production certificate
  start       Start HTTP validation and automatic renewal (every 12 hours)
  renew       Run a renewal check immediately
  test        Test renewal against staging without replacing certificates
  certificates  List managed certificates
  logs        Follow automatic renewal logs
  status      Show certificate container status
  stop        Pause production renewal; standalone mode stops its certificate stack

Configuration: .env.production (copy .env.production.example first).
Use --production for the bundled PostgreSQL/S3/HTTPS application stack.
Requires Docker Compose access. Prefix with sudo if your Docker socket requires it.
EOF
}

production=false
if [[ "${1:-}" == --production ]]; then production=true; shift; fi
action=${1:-help}
if [[ "$action" == help || "$action" == --help || "$action" == -h ]]; then
  usage
  exit 0
fi
if (($# != 1)); then usage >&2; exit 2; fi
case "$action" in
  issue|start|renew|test|certificates|logs|status|stop) ;;
  *) usage >&2; exit 2 ;;
esac
if [[ ! -f .env.production ]]; then
  echo 'Missing .env.production; copy .env.production.example and set your production values.' >&2
  exit 1
fi

compose=(docker compose --env-file .env.production -f compose.certbot.yml)
if [[ "$production" == true ]]; then
  compose=(docker compose --env-file .env.production -f compose.production.yml)
fi
pause_scheduler() {
  # Avoid concurrent Certbot locks, and resume even if the manual command fails.
  local running
  running=$("${compose[@]}" ps --status running --services renew)
  if [[ "$running" == renew ]]; then
    "${compose[@]}" stop renew
    trap '"${compose[@]}" start renew' EXIT
  fi
}
case "$action" in
  issue)
    "${compose[@]}" up -d challenge
    pause_scheduler
    "${compose[@]}" run --rm certbot
    ;;
  start) exec "${compose[@]}" up -d challenge renew ;;
  renew|test)
    "${compose[@]}" up -d challenge
    pause_scheduler
    args=(renew --non-interactive --webroot --webroot-path=/var/www/certbot)
    if [[ "$action" == test ]]; then args+=(--dry-run); fi
    "${compose[@]}" run --rm certbot "${args[@]}"
    ;;
  certificates) exec "${compose[@]}" run --rm --no-deps certbot certificates ;;
  logs) exec "${compose[@]}" logs -f renew ;;
  status) exec "${compose[@]}" ps ;;
  stop)
    if [[ "$production" == true ]]; then
      # Leave the HTTPS application proxy and database running.
      exec "${compose[@]}" stop renew
    fi
    exec "${compose[@]}" down
    ;;
esac
