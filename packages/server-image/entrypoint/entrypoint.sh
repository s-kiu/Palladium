#!/usr/bin/env bash
# entrypoint.sh — PID-1 (under tini). Prepares the volume as root, then drops
# privileges to PUID:PGID and hands off to run.sh for command dispatch.
set -Eeuo pipefail

: "${PAL_ROOT:=/palworld}"
: "${PUID:=1000}"
: "${PGID:=1000}"
: "${SKIP_CHOWN:=false}"

TOP_DIRS=(server saves logs config mods paks logicmods backups .state .home)

if [[ $EUID -eq 0 ]]; then
    mkdir -p "$PAL_ROOT"
    for d in "${TOP_DIRS[@]}"; do
        mkdir -p "$PAL_ROOT/$d"
    done

    if [[ "${SKIP_CHOWN,,}" != "true" ]]; then
        # chown per top-level dir, only when ownership is wrong — a full
        # recursive chown over a 15 GB install on every boot would be slow.
        chown "$PUID:$PGID" "$PAL_ROOT"
        for d in "${TOP_DIRS[@]}"; do
            if [[ "$(stat -c '%u:%g' "$PAL_ROOT/$d")" != "$PUID:$PGID" ]]; then
                echo "[pal-up] fixing ownership of $PAL_ROOT/$d (-> $PUID:$PGID)" >&2
                chown -R "$PUID:$PGID" "$PAL_ROOT/$d"
            fi
        done
    fi

    exec gosu "$PUID:$PGID" /opt/pal-up/run.sh "$@"
fi

# Already non-root (docker --user / docker exec -u): run directly.
exec /opt/pal-up/run.sh "$@"
