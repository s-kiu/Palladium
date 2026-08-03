#!/usr/bin/env bash
# palapi.sh — thin CLI over the local Palworld REST admin API.
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

SUB="${1:-}"
shift || true

usage() {
    cat <<'EOF'
pal-up palapi <subcommand>

  info | metrics | players | settings     read server state (JSON)
  save                                    force a world save
  announce <message...>                   broadcast to all players
  shutdown [seconds] [message...]         graceful stop with warning
  stop                                    force stop (no warning!)
  kick <steam-or-player-uid> [message...] kick a player
  ban <steam-or-player-uid> [message...]  ban a player
  unban <steam-or-player-uid>             lift a ban
EOF
}

require_uid() {
    [[ -n "${1:-}" ]] || die "player uid required (see 'pal-up palapi players')"
}

case "$SUB" in
info | metrics | players | settings)
    palapi GET "$SUB" | jq .
    ;;
save)
    palapi POST save
    echo "save requested"
    ;;
announce)
    [[ $# -gt 0 ]] || die "usage: palapi announce <message>"
    palapi POST announce "$(jq -cn --arg m "$*" '{message: $m}')"
    echo "announced"
    ;;
shutdown)
    WAIT="${1:-$SHUTDOWN_WARN_SECONDS}"
    shift || true
    MSG="${*:-$SHUTDOWN_MESSAGE}"
    palapi POST shutdown "$(jq -cn --argjson w "$WAIT" --arg m "$MSG" '{waittime: $w, message: $m}')"
    echo "shutdown scheduled in ${WAIT}s"
    ;;
stop)
    palapi POST stop
    echo "force stop sent"
    ;;
kick | ban)
    require_uid "${1:-}"
    UID_ARG="$1"
    shift || true
    MSG="${*:-"You have been ${SUB}ned from the server"}"
    palapi POST "$SUB" "$(jq -cn --arg u "$UID_ARG" --arg m "$MSG" '{userid: $u, message: $m}')"
    echo "${SUB}: $UID_ARG"
    ;;
unban)
    require_uid "${1:-}"
    palapi POST unban "$(jq -cn --arg u "$1" '{userid: $u}')"
    echo "unban: $1"
    ;;
"" | help | --help | -h)
    usage
    ;;
*)
    usage >&2
    die "unknown subcommand: $SUB"
    ;;
esac
