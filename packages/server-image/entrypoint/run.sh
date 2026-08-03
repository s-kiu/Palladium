#!/usr/bin/env bash
# run.sh — command dispatch, running as the unprivileged server user.
set -Eeuo pipefail

: "${PAL_ROOT:=/palworld}"
# No passwd entry is guaranteed for arbitrary PUIDs — pin HOME ourselves so
# SteamCMD has a stable, persisted place for its own state.
export HOME="$PAL_ROOT/.home" USER=palworld LOGNAME=palworld

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
    cat <<'EOF'
pal-up <command>

  serve                     install/update, sync mods, start the server (default)
  update [--validate]       apply a Steam update now (server must be stopped)
  check-update              compare installed vs latest Steam build
  backup [tag]              snapshot the world to /palworld/backups
  backups                   list snapshots
  restore <archive|latest>  restore a snapshot (server must be stopped)
  palapi <sub> [...]        call the local REST admin API (info, players,
                            metrics, settings, save, announce, shutdown, stop,
                            kick, ban, unban)
  healthcheck               exit 0 iff the server process + REST API are up
  bash                      interactive shell
EOF
}

CMD="${1:-serve}"
shift || true

case "$CMD" in
serve | update | check-update | backup | backups | restore | palapi)
    exec "$SELF_DIR/cmd/$CMD.sh" "$@"
    ;;
healthcheck)
    exec "$SELF_DIR/scripts/healthcheck.sh"
    ;;
bash | sh)
    exec bash "$@"
    ;;
help | --help | -h)
    usage
    ;;
*)
    usage >&2
    echo >&2
    echo "unknown command: $CMD" >&2
    exit 64
    ;;
esac
