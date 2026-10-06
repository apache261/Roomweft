#!/usr/bin/env bash
set -Eeuo pipefail

# Run Compose from this project's directory, even when called elsewhere.
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$project_dir"

usage() {
  cat <<'EOF'
Usage: ./deploy.sh COMMAND [OPTIONS] [SERVICES]

  up                 Build and start the stack in the background
  down               Stop and remove containers; keep data volumes
  down -v            Stop and remove containers AND delete data volumes
  restart [SERVICES]  Restart existing containers
  logs [OPTIONS]     View logs (use logs -f to follow)
  ps                 Show container status
  config [OPTIONS]   Inspect the resolved Compose configuration
  build [SERVICES]   Build images without starting containers
  pull [SERVICES]    Pull service images

Additional options are passed directly to Docker Compose. Examples:
  ./deploy.sh up --no-deps web
  ./deploy.sh logs -f api
  ./deploy.sh down --remove-orphans

Customize ports and startup settings in .env. Compose also accepts
COMPOSE_FILE, COMPOSE_PROJECT_NAME and COMPOSE_PROFILES environment variables.
EOF
}

action="${1:-help}"
if (($#)); then shift; fi
case "$action" in
  help|-h|--help) usage; exit 0 ;;
  up|down|restart|logs|ps|config|build|pull) ;;
  *) printf 'Unknown command: %s\n' "$action" >&2; usage >&2; exit 2 ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker is not installed or is not on PATH.\n' >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  printf 'Docker Compose v2 is required (docker compose).\n' >&2
  exit 1
fi

if [[ "$action" == up && ! -f .env ]]; then
  cp -- .env.example .env
  printf 'Created .env from .env.example. Edit it to customize the stack.\n'
fi

docker_command=(docker)
# Local Docker installs often require sudo. Remote/custom contexts retain their
# own credentials and must not be silently switched to root's Docker context.
if [[ "$action" != config && -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" &&
      -S /var/run/docker.sock && ! -w /var/run/docker.sock ]] &&
   [[ "$(docker context show)" == default ]]; then
  if ! command -v sudo >/dev/null 2>&1; then
    printf 'No access to the Docker socket. Run this script with Docker permissions.\n' >&2
    exit 1
  fi
  printf 'Docker requires elevated access; sudo may ask for your password.\n' >&2
  docker_command=(sudo --preserve-env=COMPOSE_FILE,COMPOSE_PROJECT_NAME,COMPOSE_PROFILES docker)
fi

case "$action" in
  up) exec "${docker_command[@]}" compose up --build --detach "$@" ;;
  *) exec "${docker_command[@]}" compose "$action" "$@" ;;
esac
