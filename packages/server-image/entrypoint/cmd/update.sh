#!/usr/bin/env bash
# update.sh — apply a Steam update explicitly (works even with UPDATE_ON_BOOT=hold).
# The server must be stopped: Steam must not touch files the game has open.
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

if ! server_is_stopped; then
    die "the server is running (process or volume lock detected) — stop it first: docker compose stop palworld, then: docker compose run --rm palworld update"
fi

ensure_runtime_dirs

VALIDATE=""
[[ "${1:-}" == "--validate" ]] && VALIDATE=validate

BEFORE="$(local_buildid)"
if is_true "$BACKUP_BEFORE_UPDATE" && saves_exist; then
    BACKUP_HOT=false create_backup pre-update >/dev/null
fi

run_steam_update "$VALIDATE" || die "update failed"
rm -f "$STATE_DIR/update-held"

AFTER="$(local_buildid)"
if [[ -n "$BEFORE" && "$BEFORE" == "$AFTER" ]]; then
    log "already up to date (build $AFTER)"
else
    log "updated: build ${BEFORE:-none} → ${AFTER:-?}"
    log "reminder: game patches can break UE4SS/mods — test before letting players back in"
fi
