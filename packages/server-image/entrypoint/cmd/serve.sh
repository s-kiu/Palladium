#!/usr/bin/env bash
# serve.sh — the main container command: prepare everything, start the game
# server, supervise it, shut it down gracefully.
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

GAME_PID=""
SCHED_PID=""
STOP_REQUESTED=false

on_stop_signal() {
    STOP_REQUESTED=true
    log "stop requested — beginning graceful shutdown"
    [[ -n "$GAME_PID" ]] && graceful_stop "$GAME_PID"
}

main() {
    log "── pal-up Palworld server ────────────────────────────────"
    if ue4ss_staged; then
        log "UE4SS in image: $(cat "$UE4SS_STAGE/.version" 2>/dev/null || echo unknown)"
    else
        log "UE4SS in image: none ($(cat "$UE4SS_STAGE/.omitted" 2>/dev/null || echo 'not staged'))"
    fi

    if [[ "$SETTINGS_MODE" != "manual" && -z "${ADMIN_PASSWORD:-}" ]]; then
        die "ADMIN_PASSWORD is not set. It secures in-game admin and the REST admin API. Set it in .env and restart."
    fi

    ensure_runtime_dirs
    hold_server_lock
    # Fresh on-volume log per boot; from here on every log line (ours and the
    # game's) is visible to the web panel.
    : >"$SERVER_LOG"
    export SERVER_LOG_ACTIVE="$SERVER_LOG"

    # Admin stop: while the stop marker exists the container parks here instead
    # of launching the game. Update/restore requests still run while parked —
    # the game being down is exactly when they are safe.
    local parked=""
    while [[ -f "$STATE_DIR/stop-request" ]]; do
        if [[ -z "$parked" ]]; then
            parked=1
            log "server stopped by admin — parked until Start is pressed (marker: .state/stop-request)"
        fi
        process_request_markers
        sleep 3
    done
    [[ -n "$parked" ]] && log "start requested — booting"

    process_request_markers
    install_or_update_server
    ensure_saves_link

    # ── mods ──
    if is_true "$MODS_ENABLED"; then
        if ue4ss_staged; then
            install_ue4ss
            sync_lua_mods "$USER_MODS_DIR" "$UE4SS_MODS_TARGET" "$STATE_DIR/lua-mods.manifest"
            if [[ "$MODS_TXT_MODE" == "managed" ]]; then
                gen_mods_txt "$USER_MODS_DIR" "$UE4SS_MODS_TARGET" "$(ue4ss_base_modstxt)"
            else
                log "MODS_TXT_MODE=manual — mods.txt left untouched"
            fi
        else
            warn "MODS_ENABLED=true but this image was built without UE4SS — Lua/LogicMods will NOT load."
            warn "Fix: rebuild the image with a pinned ue4ss.lock (see packages/server-image/README.md)."
        fi
    else
        log "mods disabled (MODS_ENABLED=false)"
    fi
    # .pak mods load through the stock UE pak system — sync them regardless.
    sync_tree "$USER_PAKS_DIR" "$PAKS_TARGET"
    sync_tree "$USER_LOGICMODS_DIR" "$LOGICMODS_TARGET"

    # ── config ──
    gen_settings_ini
    apply_persist_overlay

    # ── background maintenance (scheduled backups, update checks) ──
    maintenance_loop &
    SCHED_PID=$!

    # ── launch ──
    local -a args perf extra
    read -ra perf <<<"$PERF_ARGS"
    read -ra extra <<<"$SERVER_ARGS"
    args=(-port="$GAME_PORT" -publicport="$PUBLIC_PORT" -players="$MAX_PLAYERS")
    [[ -n "${PUBLIC_IP:-}" ]] && args+=(-publicip="$PUBLIC_IP")
    args+=("${perf[@]}")
    [[ ${#extra[@]} -gt 0 ]] && args+=("${extra[@]}")

    cd "$SERVER_DIR"
    trap on_stop_signal TERM INT
    local use_ue4ss=false missing mod_count=0 fc_ctx fc_count
    if ue4ss_active; then
        missing="$(ue4ss_missing_deps)"
        if [[ -n "$missing" ]]; then
            warn "UE4SS is installed but cannot load — missing system libraries: $(tr '\n' ' ' <<<"$missing")"
            warn "starting UNMODDED so the server stays up. This is an image defect — please report it."
        else
            use_ue4ss=true
        fi
    fi
    fc_ctx="$(fastcrash_context)"
    fastcrash_prune_stale "$fc_ctx"
    if [[ "$use_ue4ss" == "true" ]] && is_true "$MODS_AUTO_FALLBACK"; then
        fc_count="$(fastcrash_count "$fc_ctx")"
        if ((fc_count >= FASTCRASH_LIMIT)); then
            warn "#############################################################"
            warn "# UE4SS DISABLED AUTOMATICALLY: the server crashed within    #"
            warn "# ${FASTCRASH_WINDOW_SECONDS}s of launch $fc_count times in a row with UE4SS active."
            warn "# The mod loader is most likely incompatible with the        #"
            warn "# current game build. Starting UNMODDED so players can play. #"
            warn "# To try mods again: pin a newer UE4SS release               #"
            warn "# (ue4ss/vendor.sh --pin <tag>) and rebuild — the crash      #"
            warn "# counter resets when the loader or game build changes.      #"
            warn "# Opt out of this fallback with MODS_AUTO_FALLBACK=false.    #"
            warn "#############################################################"
            use_ue4ss=false
        fi
    fi
    if [[ "$use_ue4ss" == "true" ]]; then
        mod_count="$(find "$USER_MODS_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"
        log "starting PalServer WITH UE4SS (LD_PRELOAD) — $mod_count user Lua mod(s)"
        LD_PRELOAD="$UE4SS_LIB" ./PalServer.sh "${args[@]}" > >(tee -a "$SERVER_LOG") 2>&1 &
    else
        log "starting PalServer (unmodded)"
        ./PalServer.sh "${args[@]}" > >(tee -a "$SERVER_LOG") 2>&1 &
    fi
    GAME_PID=$!
    local game_started_at
    game_started_at="$(date +%s)"
    log "game port: ${GAME_PORT}/udp | REST admin API: 127.0.0.1:${REST_API_PORT} (internal)"

    # Wait until the game process is really gone; wait(1) returns early when a
    # trapped signal arrives, so loop while the PID is alive.
    local rc=0
    set +e
    wait "$GAME_PID"
    rc=$?
    while kill -0 "$GAME_PID" 2>/dev/null; do
        wait "$GAME_PID"
        rc=$?
    done
    set -e

    if [[ -n "$SCHED_PID" ]]; then
        kill "$SCHED_PID" 2>/dev/null || true
    fi

    if [[ "$STOP_REQUESTED" == "true" ]]; then
        log "server stopped"
        if [[ "$use_ue4ss" == "true" ]] && (($(date +%s) - game_started_at >= FASTCRASH_WINDOW_SECONDS)); then
            fastcrash_reset
        fi
        if is_true "$BACKUP_ON_STOP"; then
            BACKUP_HOT=false create_backup shutdown >/dev/null || warn "shutdown backup failed"
        fi
        exit 0
    fi

    warn "server exited on its own (rc=$rc)"
    local ran_s=$(($(date +%s) - game_started_at))
    if [[ "$use_ue4ss" == "true" ]]; then
        if ((rc != 0 && ran_s < FASTCRASH_WINDOW_SECONDS)); then
            fc_count="$(fastcrash_record "$fc_ctx")"
            warn "rapid crash with UE4SS active: #$fc_count within ${ran_s}s of launch (auto-fallback at $FASTCRASH_LIMIT)"
        else
            fastcrash_reset
        fi
    fi
    if is_true "$BACKUP_ON_STOP"; then
        BACKUP_HOT=false create_backup crash >/dev/null || warn "post-crash backup failed"
    fi
    exit "$rc"
}

main "$@"
