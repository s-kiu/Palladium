#!/usr/bin/env bash
# restore.sh — replace the current world with a snapshot.
# Safety: refuses while the server runs, and snapshots the current world first.
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

ARG="${1:-}"
[[ -n "$ARG" ]] || die "usage: pal-up restore <archive|latest>"

if ! server_is_stopped; then
    die "the server is running (process or volume lock detected) — stop it first: docker compose stop palworld, then: docker compose run --rm palworld restore $ARG"
fi

ARCHIVE="$(resolve_backup_archive "$ARG")"
[[ -n "$ARCHIVE" ]] || die "archive not found: $ARG (looked in $BACKUPS_DIR; see 'pal-up backups')"

log "restoring from $(basename "$ARCHIVE")"
do_restore "$ARCHIVE" || die "restore failed"
log "restore complete — start the server with: docker compose start palworld"
