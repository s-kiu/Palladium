#!/usr/bin/env bash
# lib.sh — shared library for the pal-up server image.
#
# Sourced by every command script and by the bats unit tests (which set
# PALUP_TEST=1 and override PAL_ROOT to a tmpdir). Functions that matter
# are parameterized on paths so they can be exercised outside a container.

[[ -n "${PALUP_TEST:-}" ]] || set -Eeuo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── layout ───────────────────────────────────────────────────────────────────
: "${PAL_ROOT:=/palworld}"
: "${UE4SS_STAGE:=/opt/ue4ss}"
# Pristine SteamCMD shipped in the image. SteamCMD needs write access to its
# own directory (it self-updates), so it runs from a copy in $HOME — which
# lives on the data volume and is owned by the server user.
: "${STEAMCMD_SEED:=/opt/steamcmd}"
: "${STEAMCMD_SH:=${HOME:-/root}/steamcmd/steamcmd.sh}"

SERVER_DIR="$PAL_ROOT/server"
SAVES_DIR="$PAL_ROOT/saves"
LOGS_DIR="$PAL_ROOT/logs"
SERVER_LOG="$LOGS_DIR/server.log"
# Event stream published by the in-game bridge agent, consumed by the panel and
# by external tools. Cursors into it are byte offsets, so it is only ever
# appended to during a run and truncated at boot alongside the server log.
# shellcheck disable=SC2034  # consumed by cmd/serve.sh after sourcing
BRIDGE_EVENTS="$LOGS_DIR/bridge-events.jsonl"
CONFIG_DIR="$PAL_ROOT/config"
USER_MODS_DIR="$PAL_ROOT/mods"
USER_PAKS_DIR="$PAL_ROOT/paks"
USER_LOGICMODS_DIR="$PAL_ROOT/logicmods"
BACKUPS_DIR="$PAL_ROOT/backups"
STATE_DIR="$PAL_ROOT/.state"

PANEL_SETTINGS_FILE="$CONFIG_DIR/panel-settings.env"
GAME_PAL_DIR="$SERVER_DIR/Pal"
SAVED_LINK="$GAME_PAL_DIR/Saved"
SETTINGS_DIR="$SAVES_DIR/Config/LinuxServer"
SETTINGS_INI="$SETTINGS_DIR/PalWorldSettings.ini"
# shellcheck disable=SC2034  # consumed by cmd/serve.sh after sourcing
PAKS_TARGET="$GAME_PAL_DIR/Content/Paks/~mods"
# shellcheck disable=SC2034  # consumed by cmd/serve.sh after sourcing
LOGICMODS_TARGET="$GAME_PAL_DIR/Content/Paks/LogicMods"
UE4SS_MODS_TARGET="$SERVER_DIR/Mods"
UE4SS_LIB="$SERVER_DIR/libUE4SS.so"

# Data files ship at config/ next to the entrypoint dir in the repo, but at
# ./config/ below it inside the image — probe both.
if [[ -z "${MAP_FILE:-}" ]]; then
    for _c in "$LIB_DIR/config/settings.map" "$LIB_DIR/../config/settings.map"; do
        [[ -f "$_c" ]] && MAP_FILE="$_c" && break
    done
fi
if [[ -z "${MODS_BASE_FALLBACK:-}" ]]; then
    for _c in "$LIB_DIR/config/mods-base.txt" "$LIB_DIR/../config/mods-base.txt"; do
        [[ -f "$_c" ]] && MODS_BASE_FALLBACK="$_c" && break
    done
fi
unset _c

# ── env defaults ─────────────────────────────────────────────────────────────
: "${STEAM_APP_ID:=2394010}"
: "${GAME_PORT:=8211}"
: "${PUBLIC_PORT:=$GAME_PORT}"
: "${MAX_PLAYERS:=32}"
: "${REST_API_ENABLED:=true}"
: "${REST_API_PORT:=8212}"
: "${UPDATE_ON_BOOT:=true}"
: "${VALIDATE_ON_BOOT:=false}"
: "${SETTINGS_MODE:=env}"
: "${MODS_ENABLED:=true}"
: "${MODS_TXT_MODE:=managed}"
: "${UE4SS_FORCE_SYNC:=false}"
: "${MODS_AUTO_FALLBACK:=true}"
: "${FASTCRASH_LIMIT:=3}"
: "${FASTCRASH_WINDOW_SECONDS:=120}"
: "${UE4SS_HEADLESS:=true}"
: "${BACKUP_ON_STOP:=true}"
: "${BACKUP_BEFORE_UPDATE:=true}"
: "${BACKUP_INTERVAL_MINUTES:=0}"
: "${UPDATE_CHECK_INTERVAL_MINUTES:=60}"
: "${BACKUP_KEEP_COUNT:=14}"
: "${BACKUP_KEEP_DAYS:=0}"
: "${BACKUP_HOT:=true}"
: "${SHUTDOWN_WARN_SECONDS:=30}"
: "${SHUTDOWN_MESSAGE:=Server is shutting down}"
: "${PERF_ARGS:=-useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS}"
: "${SERVER_ARGS:=}"

# ── logging (stderr, so functions can return data on stdout) ─────────────────
# When SERVER_LOG_ACTIVE is exported (serve.sh does), every line is mirrored
# into the on-volume server log so the web panel can show it.
_emit() {
    local line
    line="$(printf '[pal-up] %s | %s' "$(date -u '+%H:%M:%S')" "$*")"
    printf '%s\n' "$line" >&2
    if [[ -n "${SERVER_LOG_ACTIVE:-}" ]]; then
        printf '%s\n' "$line" >>"$SERVER_LOG_ACTIVE" 2>/dev/null || true
    fi
}
log()  { _emit "$*"; }
warn() { _emit "WARN: $*"; }
die()  { _emit "FATAL: $*"; exit 1; }

# ── small helpers ────────────────────────────────────────────────────────────
norm_bool() { # anything → true|false
    case "${1,,}" in
    1 | true | yes | on) echo true ;;
    *) echo false ;;
    esac
}

is_true() { [[ "$(norm_bool "${1:-}")" == "true" ]]; }

ini_bool() { if is_true "${1:-}"; then echo True; else echo False; fi; }

game_running() { pgrep -f 'PalServer-Linux' >/dev/null 2>&1; }

# The volume can be shared by several containers at once (main service +
# `docker compose run … update`). pgrep can't see across PID namespaces, so
# serve.sh holds a kernel flock on the volume for its whole lifetime; anything
# that must not run alongside the server probes that lock.
SERVER_LOCK="$STATE_DIR/server.lock"

hold_server_lock() { # serve.sh only — fd 9 stays open for the process lifetime
    mkdir -p "$STATE_DIR"
    exec 9>>"$SERVER_LOCK"
    flock -n 9 || die "another server process is already using $PAL_ROOT (is a second container running on this volume?)"
}

server_is_stopped() { # update/restore guard: same-container process + cross-container lock
    game_running && return 1
    mkdir -p "$STATE_DIR"
    (
        exec 9>>"$SERVER_LOCK"
        flock -n 9
    ) || return 1
    return 0
}

saves_exist() { [[ -d "$SAVES_DIR/SaveGames" ]]; }

ue4ss_staged() { [[ -f "$UE4SS_STAGE/libUE4SS.so" ]]; }

ue4ss_active() { is_true "$MODS_ENABLED" && [[ -f "$UE4SS_LIB" ]]; }

ue4ss_missing_deps() { # → unresolvable shared-library names, empty if all fine
    command -v ldd >/dev/null 2>&1 || return 0
    ldd "$UE4SS_LIB" 2>/dev/null | awk '/not found/ {print $1}'
}

# ── rapid-crash bookkeeping ──────────────────────────────────────────────────
# A game patch can make the mod loader abort seconds after launch, every
# launch. serve.sh counts consecutive fast crashes that happened with UE4SS
# active, keyed by (UE4SS version, game build): when either changes the count
# starts over, because the combination under suspicion no longer exists.

fastcrash_context() { # → stable key for the current loader+game pairing
    printf '%s@%s\n' \
        "$(head -c 120 "$STATE_DIR/ue4ss-version" 2>/dev/null | tr -d '\n' || true)" \
        "$(local_buildid)"
}

fastcrash_count() { # <context> → consecutive fast crashes recorded for it
    local ctx="$1" file="$STATE_DIR/ue4ss-fastcrash" stored="" count=""
    [[ -f "$file" ]] || { echo 0; return 0; }
    IFS='|' read -r stored count <"$file" || true
    if [[ "$stored" == "$ctx" && "$count" =~ ^[0-9]+$ ]]; then
        echo "$count"
    else
        echo 0
    fi
}

fastcrash_record() { # <context> → new count on stdout
    local ctx="$1" n
    n=$(($(fastcrash_count "$ctx") + 1))
    mkdir -p "$STATE_DIR"
    printf '%s|%s\n' "$ctx" "$n" >"$STATE_DIR/ue4ss-fastcrash"
    echo "$n"
}

fastcrash_reset() { rm -f "$STATE_DIR/ue4ss-fastcrash"; }

fastcrash_prune_stale() { # <current-context> — a streak recorded for a pairing
    local ctx="$1" file="$STATE_DIR/ue4ss-fastcrash" stored=""
    # that no longer exists is meaningless; drop it so status readers (panel)
    # see the truth without having to replicate the context comparison.
    [[ -f "$file" ]] || return 0
    IFS='|' read -r stored _ <"$file" || true
    if [[ "$stored" != "$ctx" ]]; then
        rm -f "$file"
    fi
}

valid_mod_name() { [[ "${1:-}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; }

# ── steam install / update ───────────────────────────────────────────────────
acf_buildid() { # <appmanifest.acf> → buildid or ""
    [[ -f "${1:-}" ]] || { echo ""; return 0; }
    sed -n 's/^[[:space:]]*"buildid"[[:space:]]*"\([0-9]*\)".*/\1/p' "$1" | head -n1
}

local_buildid() { acf_buildid "$SERVER_DIR/steamapps/appmanifest_${STEAM_APP_ID}.acf"; }

ensure_steamcmd() { # copy the read-only image seed into a writable, user-owned dir
    [[ -x "$STEAMCMD_SH" ]] && return 0
    local dir
    dir="$(dirname "$STEAMCMD_SH")"
    log "bootstrapping SteamCMD into $dir"
    mkdir -p "$dir"
    cp -r "$STEAMCMD_SEED"/. "$dir"/
    chmod -R u+rwX "$dir"
    chmod u+x "$STEAMCMD_SH"
}

steamcmd_run() {
    ensure_steamcmd
    "$STEAMCMD_SH" "$@"
}

parse_remote_buildid() { # stdin: `app_info_print` output → public branch buildid
    awk '
        /"branches"/ { in_branches = 1 }
        in_branches && /"public"/ { in_public = 1 }
        in_public && /"buildid"/ { gsub(/[^0-9]/, "", $2); print $2; exit }
    '
}

remote_buildid() { # cached 5 min; empty output = unknown
    local cache="$STATE_DIR/remote-buildid" ts="" val="" now
    if [[ -f "$cache" ]]; then
        read -r ts val <"$cache" || true
        now="$(date +%s)"
        if [[ "$ts" =~ ^[0-9]+$ && -n "$val" ]] && ((now - ts < 300)); then
            echo "$val"
            return 0
        fi
    fi
    local out id
    out="$(steamcmd_run +login anonymous +app_info_update 1 +app_info_print "$STEAM_APP_ID" +quit 2>/dev/null || true)"
    id="$(parse_remote_buildid <<<"$out")"
    if [[ -n "$id" ]]; then
        mkdir -p "$STATE_DIR"
        printf '%s %s\n' "$(date +%s)" "$id" >"$cache"
    fi
    echo "$id"
}

decide_update_action() { # <mode> <installed:yes|no> <local> <remote> → install|update|skip|hold
    local mode="$1" installed="$2" lb="$3" rb="$4"
    if [[ "$installed" != "yes" ]]; then
        echo install
        return 0
    fi
    case "$mode" in
    false)
        echo skip
        ;;
    hold)
        if [[ -n "$rb" && "$rb" != "$lb" ]]; then echo hold; else echo skip; fi
        ;;
    *)  # true (default): unknown remote → let steamcmd figure it out
        if [[ -z "$rb" || "$rb" != "$lb" ]]; then echo update; else echo skip; fi
        ;;
    esac
}

run_steam_update() { # [validate]
    local -a args=(+@ShutdownOnFailedCommand 1 +force_install_dir "$SERVER_DIR" +login anonymous +app_update "$STEAM_APP_ID")
    [[ "${1:-}" == "validate" ]] && args+=(validate)
    args+=(+quit)
    local try
    for try in 1 2 3; do
        if steamcmd_run "${args[@]}" && [[ -f "$SERVER_DIR/PalServer.sh" ]]; then
            return 0
        fi
        warn "steamcmd attempt $try/3 failed, retrying in 5s"
        sleep 5
    done
    warn "steamcmd could not install/update app $STEAM_APP_ID after 3 attempts"
    return 1
}

print_hold_banner() { # <local> <remote>
    warn "################################################################"
    warn "#  GAME UPDATE AVAILABLE — NOT APPLIED (UPDATE_ON_BOOT=hold)   #"
    warn "#  installed build: ${1:-?}    latest build: ${2:-?}"
    warn "#  Your mods keep working, but clients on the new game version #"
    warn "#  may be unable to join. When your mods are ready:            #"
    warn "#    set UPDATE_ON_BOOT=true and restart, or run:              #"
    warn "#    docker compose run --rm palworld update                   #"
    warn "################################################################"
}

install_or_update_server() {
    local mode installed=no lb rb action
    mode="$UPDATE_ON_BOOT"
    case "$mode" in true | false | hold) ;; *)
        warn "invalid UPDATE_ON_BOOT='$mode', falling back to 'true'"
        mode=true
        ;;
    esac

    [[ -f "$SERVER_DIR/PalServer.sh" ]] && installed=yes
    lb="$(local_buildid)"
    rb=""
    if [[ "$installed" == "yes" && "$mode" != "false" ]]; then
        rb="$(remote_buildid)"
        [[ -z "$rb" ]] && warn "could not determine latest Steam build (network/steam hiccup?)"
    fi

    action="$(decide_update_action "$mode" "$installed" "$lb" "$rb")"
    case "$action" in
    install)
        log "no server install found — downloading Palworld dedicated server (~15 GB, be patient)"
        run_steam_update validate || die "initial server install failed"
        rm -f "$STATE_DIR/update-held"
        log "install complete (build $(local_buildid))"
        ;;
    update)
        log "applying Steam update (installed: ${lb:-?}, latest: ${rb:-unknown})"
        if is_true "$BACKUP_BEFORE_UPDATE" && saves_exist; then
            create_backup pre-update >/dev/null
        fi
        local vflag=""
        is_true "$VALIDATE_ON_BOOT" && vflag=validate
        if run_steam_update "$vflag"; then
            rm -f "$STATE_DIR/update-held"
            log "update complete (build $(local_buildid))"
        else
            warn "update failed — continuing with the installed build ${lb:-?}"
        fi
        ;;
    hold)
        print_hold_banner "$lb" "$rb"
        printf '%s\n' "$rb" >"$STATE_DIR/update-held"
        ;;
    skip)
        if [[ "$mode" == "false" ]]; then
            log "updates disabled (UPDATE_ON_BOOT=false), running build ${lb:-?}"
        else
            log "server is up to date (build ${lb:-?})"
        fi
        ;;
    esac

    if is_true "$VALIDATE_ON_BOOT" && [[ "$action" == "skip" ]]; then
        log "VALIDATE_ON_BOOT=true — verifying game files"
        run_steam_update validate || warn "validation pass failed"
    fi
}

# ── restore & panel request markers ──────────────────────────────────────────
resolve_backup_archive() { # <name|latest|path> → absolute path, or empty
    local arg="$1"
    if [[ "$arg" == "latest" ]]; then
        find "$BACKUPS_DIR" -maxdepth 1 -name 'palworld-*.tar.gz' -type f | sort | tail -n1
    elif [[ -f "$arg" ]]; then
        echo "$arg"
    elif [[ -f "$BACKUPS_DIR/$arg" ]]; then
        echo "$BACKUPS_DIR/$arg"
    fi
}

do_restore() { # <archive-path> — caller guarantees the game is not running
    local archive="$1"
    if ! tar -tzf "$archive" | head -n1 | grep -q '^saves/'; then
        warn "$(basename "$archive") does not look like a pal-up backup (no saves/ root)"
        return 1
    fi
    if saves_exist; then
        BACKUP_HOT=false create_backup pre-restore >/dev/null
        log "current world snapshotted as a pre-restore backup"
    fi
    mkdir -p "$SAVES_DIR"
    find "$SAVES_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    tar -xzf "$archive" -C "$PAL_ROOT"
    log "world restored from $(basename "$archive")"
}

process_request_markers() {
    # The panel can only ask; actions that need the game down are written as
    # marker files and executed here, on boot, before the game starts.
    local upd="$STATE_DIR/update-request" res="$STATE_DIR/restore-request"
    local result="$STATE_DIR/last-request-result"

    if [[ -f "$upd" ]]; then
        rm -f "$upd"
        log "processing update request from the panel"
        if saves_exist && is_true "$BACKUP_BEFORE_UPDATE"; then
            BACKUP_HOT=false create_backup pre-update >/dev/null
        fi
        if run_steam_update; then
            rm -f "$STATE_DIR/update-held"
            printf 'update ok %s build=%s\n' "$(date -u +%FT%TZ)" "$(local_buildid)" >"$result"
        else
            printf 'update failed %s\n' "$(date -u +%FT%TZ)" >"$result"
        fi
    fi

    if [[ -f "$res" ]]; then
        local name archive
        name="$(head -c 200 "$res" | tr -d '\n')"
        rm -f "$res"
        log "processing restore request from the panel: $name"
        if [[ "$name" != "latest" && ! "$name" =~ ^palworld-[0-9]{8}-[0-9]{6}-[A-Za-z0-9_-]+\.tar\.gz$ ]]; then
            warn "rejecting restore request with unexpected archive name"
            printf 'restore rejected %s bad-name\n' "$(date -u +%FT%TZ)" >"$result"
            return 0
        fi
        archive="$(resolve_backup_archive "$name")"
        if [[ -n "$archive" ]] && do_restore "$archive"; then
            printf 'restore ok %s %s\n' "$(date -u +%FT%TZ)" "$(basename "$archive")" >"$result"
        else
            printf 'restore failed %s %s\n' "$(date -u +%FT%TZ)" "$name" >"$result"
        fi
    fi
}

# ── runtime prep ─────────────────────────────────────────────────────────────
ensure_runtime_dirs() {
    mkdir -p "$SERVER_DIR" "$SAVES_DIR" "$LOGS_DIR" "$CONFIG_DIR/persist" "$USER_MODS_DIR" \
        "$USER_PAKS_DIR" "$USER_LOGICMODS_DIR" "$BACKUPS_DIR" "$STATE_DIR" "$HOME"
    # The server SDK expects steamclient.so under ~/.steam/sdk64. SteamCMD
    # creates linux64/ during its first self-update, so this link may dangle
    # briefly on a fresh volume — it becomes valid the moment the file exists.
    mkdir -p "$HOME/.steam/sdk64"
    ln -sf "$(dirname "$STEAMCMD_SH")/linux64/steamclient.so" "$HOME/.steam/sdk64/steamclient.so"
}

ensure_saves_link() {
    mkdir -p "$GAME_PAL_DIR" "$SAVES_DIR"
    if [[ -e "$SAVED_LINK" && ! -L "$SAVED_LINK" ]]; then
        log "migrating existing Pal/Saved into the saves volume"
        rsync -a "$SAVED_LINK/" "$SAVES_DIR/"
        rm -rf "$SAVED_LINK"
    fi
    ln -sfn "$SAVES_DIR" "$SAVED_LINK"
}

# ── ini editing ──────────────────────────────────────────────────────────────
ini_set() { # <file> <section> <key> <value> [separator]
    local file="$1" section="$2" key="$3" value="$4" sep="${5:- = }" tmp
    [[ -f "$file" ]] || touch "$file"
    tmp="$(mktemp)"
    awk -v s="[$section]" -v k="$key" -v v="$value" -v sep="$sep" '
        BEGIN { insec = 0; done = 0; kre = "^[ \t]*" k "[ \t]*=" }
        /^\[/ {
            if (insec && !done) { print k sep v; done = 1 }
            insec = ($0 == s)
            print
            next
        }
        insec && !done && $0 ~ kre { print k sep v; done = 1; next }
        { print }
        END {
            if (!done) {
                if (!insec) print s
                print k sep v
            }
        }
    ' "$file" >"$tmp" && mv "$tmp" "$file"
}

gen_engine_tickrate() {
    # Optional Engine.ini tick-rate override (the server targets 60 by
    # default). Lives under Saved/Config, so it persists with the world.
    [[ -n "${SERVER_TICKRATE:-}" ]] || return 0
    if ! [[ "$SERVER_TICKRATE" =~ ^[0-9]+$ ]]; then
        warn "SERVER_TICKRATE must be a plain number — ignoring '$SERVER_TICKRATE'"
        return 0
    fi
    local ini="$SAVES_DIR/Config/LinuxServer/Engine.ini"
    mkdir -p "$(dirname "$ini")"
    ini_set "$ini" "/script/onlinesubsystemutils.ipnetdriver" NetServerMaxTickRate "$SERVER_TICKRATE" "="
    ini_set "$ini" "/script/onlinesubsystemutils.ipnetdriver" LanServerMaxTickRate "$SERVER_TICKRATE" "="
    log "Engine.ini tick rate set to ${SERVER_TICKRATE} (CPU cost rises with it)"
}

# ── UE4SS install & mod sync ─────────────────────────────────────────────────
ue4ss_headless_config() { # <UE4SS-settings.ini>
    # UE4SS_HEADLESS=true forces every UI/console surface off; false restores
    # the console values the vendored port ships with (its logging can depend
    # on the console subsystem).
    local v=0
    is_true "$UE4SS_HEADLESS" || v=1
    ini_set "$1" Debug ConsoleEnabled "$v"
    ini_set "$1" Debug GuiConsoleEnabled "$v"
    ini_set "$1" Debug GuiConsoleVisible "$v"
}

install_ue4ss() {
    ue4ss_staged || return 0
    local staged_ver cur_ver refresh=false ini name
    staged_ver="$(cat "$UE4SS_STAGE/.version" 2>/dev/null || echo staged)"
    cur_ver="$(cat "$STATE_DIR/ue4ss-version" 2>/dev/null || echo "")"

    [[ ! -f "$UE4SS_LIB" ]] && refresh=true
    [[ "$staged_ver" != "$cur_ver" ]] && refresh=true
    is_true "$UE4SS_FORCE_SYNC" && refresh=true

    if [[ "$refresh" == "true" ]]; then
        log "installing UE4SS into server dir (${staged_ver})"
        cp -f "$UE4SS_STAGE/libUE4SS.so" "$UE4SS_LIB"
        for ini in "$UE4SS_STAGE"/*.ini; do
            [[ -f "$ini" ]] || continue
            name="$(basename "$ini")"
            if [[ "$name" == "UE4SS-settings.ini" && -f "$SERVER_DIR/$name" ]]; then
                continue # preserve user tweaks; headless keys are enforced below
            fi
            cp -f "$ini" "$SERVER_DIR/$name"
        done
        # Signature overrides are version-locked to the loader — always mirror.
        if [[ -d "$UE4SS_STAGE/UE4SS_Signatures" ]]; then
            rsync -a --delete "$UE4SS_STAGE/UE4SS_Signatures/" "$SERVER_DIR/UE4SS_Signatures/"
        fi
        mkdir -p "$UE4SS_MODS_TARGET"
        if [[ -d "$UE4SS_STAGE/Mods" ]]; then
            # Bundled mods (BPModLoader, shared libs, …) are version-locked to
            # UE4SS itself → force-sync them. User mods are untouched here.
            local d
            for d in "$UE4SS_STAGE/Mods"/*/; do
                [[ -d "$d" ]] || continue
                rsync -a --delete "$d" "$UE4SS_MODS_TARGET/$(basename "$d")/"
            done
        fi
        mkdir -p "$STATE_DIR"
        printf '%s\n' "$staged_ver" >"$STATE_DIR/ue4ss-version"
    fi
    ue4ss_headless_config "$SERVER_DIR/UE4SS-settings.ini"
}

sync_tree() { # <src> <dst> — dst becomes an exact mirror of src
    local src="$1" dst="$2"
    mkdir -p "$src" "$dst"
    rsync -a --delete "$src"/ "$dst"/
}

sync_lua_mods() { # <user-mods-dir> <target-Mods-dir> <manifest-file>
    local src="$1" target="$2" manifest="$3"
    mkdir -p "$target"
    local -a current=()
    local d name
    for d in "$src"/*/; do
        [[ -d "$d" ]] || continue
        name="$(basename "$d")"
        if ! valid_mod_name "$name"; then
            warn "skipping mod folder with unsafe name: '$name' (allowed: letters, digits, _ . -)"
            continue
        fi
        current+=("$name")
        rsync -a --delete "$d" "$target/$name/"
        # Some mods ship an enabled.txt, which makes UE4SS load them no matter
        # what mods.txt says — silently defeating the .disabled toggle. Under
        # managed mods.txt, strip it from the synced copy so mods.txt is the
        # single source of truth (the source folder is left untouched).
        if [[ "${MODS_TXT_MODE:-managed}" == "managed" && -e "$target/$name/enabled.txt" ]]; then
            rm -f "$target/$name/enabled.txt"
            log "stripped enabled.txt from mod '$name' — mods.txt governs enablement"
        fi
    done
    # Remove mods synced on a previous boot that are gone from the source now,
    # but never touch folders this sync did not create (UE4SS bundled mods).
    if [[ -f "$manifest" ]]; then
        local old
        while IFS= read -r old; do
            [[ -n "$old" ]] || continue
            local found=no c
            for c in "${current[@]}"; do [[ "$c" == "$old" ]] && found=yes && break; done
            if [[ "$found" == "no" && -d "$target/$old" ]]; then
                log "removing mod no longer present in /palworld/mods: $old"
                rm -rf "${target:?}/$old"
            fi
        done <"$manifest"
    fi
    mkdir -p "$(dirname "$manifest")"
    : >"$manifest"
    for name in "${current[@]}"; do printf '%s\n' "$name" >>"$manifest"; done
}

gen_mods_txt() { # <user-mods-dir> <target-Mods-dir> [base-mods.txt]
    local src="$1" target="$2" base="${3:-}"
    local -a names=() states=()
    local -A idx=()
    local name state line

    add_entry() { # name state
        if [[ -n "${idx[$1]+x}" ]]; then
            states[${idx[$1]}]="$2"
        else
            names+=("$1")
            states+=("$2")
            idx[$1]=$((${#names[@]} - 1))
        fi
    }

    if [[ -n "$base" && -f "$base" ]]; then
        while IFS= read -r line; do
            [[ "$line" =~ ^[[:space:]]*(\;|$) ]] && continue
            if [[ "$line" =~ ^[[:space:]]*([A-Za-z0-9][A-Za-z0-9_.-]*)[[:space:]]*:[[:space:]]*([01]) ]]; then
                add_entry "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
            fi
        done <"$base"
    fi

    local d
    for d in "$src"/*/; do
        [[ -d "$d" ]] || continue
        name="$(basename "$d")"
        valid_mod_name "$name" || continue
        state=1
        [[ -e "$d/.disabled" ]] && state=0
        add_entry "$name" "$state"
    done

    mkdir -p "$target"
    {
        echo "; Managed by pal-up — regenerated on every boot (MODS_TXT_MODE=managed)."
        echo "; Disable a mod by creating an empty file mods/<Name>/.disabled,"
        echo "; or take over completely with MODS_TXT_MODE=manual."
        local i
        for i in "${!names[@]}"; do
            printf '%s : %s\n' "${names[i]}" "${states[i]}"
        done
    } >"$target/mods.txt"
}

ue4ss_base_modstxt() { # → path of the base mods.txt to merge, or ""
    if [[ -f "$UE4SS_STAGE/Mods/mods.txt" ]]; then
        echo "$UE4SS_STAGE/Mods/mods.txt"
    else
        echo "${MODS_BASE_FALLBACK:-}"
    fi
}

# ── PalWorldSettings.ini generation ──────────────────────────────────────────
build_option_settings() { # <map-file> → "OptionSettings=(...)" on stdout
    local map="$1"
    local -a keys=() vals=()
    local -A kidx=()
    local envn key typ def val

    # Fifth column (description) is panel-only; absorb it so the default
    # field never swallows the rest of the line.
    while IFS='|' read -r envn key typ def _; do
        [[ -z "$envn" || "$envn" == \#* ]] && continue
        if [[ -n "${!envn+x}" ]]; then
            val="${!envn}"
        elif [[ "$def" == "-" ]]; then
            continue # optional and unset
        else
            val="$def"
        fi
        case "$typ" in
        bool) val="$(ini_bool "$val")" ;;
        str)
            val="${val//\"/\\\"}"
            val="\"$val\""
            ;;
        esac
        keys+=("$key")
        vals+=("$val")
        kidx[$key]=$((${#keys[@]} - 1))
    done <"$map"

    # OPT_<IniKey>=<verbatim value> overrides / extends the map
    local var
    while IFS= read -r var; do
        [[ -n "$var" ]] || continue
        key="${var#OPT_}"
        val="${!var}"
        if [[ -n "${kidx[$key]+x}" ]]; then
            vals[${kidx[$key]}]="$val"
        else
            keys+=("$key")
            vals+=("$val")
            kidx[$key]=$((${#keys[@]} - 1))
        fi
    done < <(compgen -A variable | grep '^OPT_' || true)

    # Web-panel overrides (highest precedence): IniKey=<ini-ready value> lines
    # written by the daemon onto the shared volume.
    if [[ -f "$PANEL_SETTINGS_FILE" ]]; then
        local line pkey pval
        while IFS= read -r line; do
            [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
            pkey="${line%%=*}"
            pval="${line#*=}"
            [[ "$pkey" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
            if [[ -n "${kidx[$pkey]+x}" ]]; then
                vals[${kidx[$pkey]}]="$pval"
            else
                keys+=("$pkey")
                vals+=("$pval")
                kidx[$pkey]=$((${#keys[@]} - 1))
            fi
        done <"$PANEL_SETTINGS_FILE"
    fi

    local out="" i
    for i in "${!keys[@]}"; do
        out+="${keys[i]}=${vals[i]},"
    done
    printf 'OptionSettings=(%s)\n' "${out%,}"
}

gen_settings_ini() {
    if [[ "$SETTINGS_MODE" == "manual" ]]; then
        log "SETTINGS_MODE=manual — leaving PalWorldSettings.ini alone"
        return 0
    fi
    [[ -n "${MAP_FILE:-}" && -f "$MAP_FILE" ]] || die "settings map not found (MAP_FILE)"
    mkdir -p "$SETTINGS_DIR"
    {
        echo "; Generated by pal-up from environment variables and panel overrides"
        echo "; (config/panel-settings.env) — regenerated on every boot. Manual edits"
        echo "; WILL be lost; set SETTINGS_MODE=manual to take over."
        echo "[/Script/Pal.PalGameWorldSettings]"
        build_option_settings "$MAP_FILE"
    } >"$SETTINGS_INI"
    log "generated PalWorldSettings.ini from environment"
}

apply_persist_overlay() {
    local pdir="$CONFIG_DIR/persist"
    [[ -d "$pdir" ]] || return 0
    local count=0
    while IFS= read -r -d '' f; do
        local rel="${f#"$pdir"/}"
        mkdir -p "$SERVER_DIR/$(dirname "$rel")"
        cp -f "$f" "$SERVER_DIR/$rel"
        count=$((count + 1))
        log "persist overlay: $rel"
    done < <(find "$pdir" -type f -print0)
    if ((count > 0)); then
        log "applied $count persisted config file(s) from config/persist/"
    fi
}

# ── REST admin API ───────────────────────────────────────────────────────────
palapi() { # <METHOD> <endpoint> [json-body]
    local method="$1" endpoint="$2" body="${3:-}"
    local -a args=(-sf -m 10 -u "admin:${ADMIN_PASSWORD:-}" -X "$method"
        -H 'Accept: application/json'
        "http://127.0.0.1:${REST_API_PORT}/v1/api/${endpoint}")
    [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' -d "$body")
    curl "${args[@]}"
}

api_up() {
    is_true "$REST_API_ENABLED" || return 1
    palapi GET info >/dev/null 2>&1
}

# ── backups ──────────────────────────────────────────────────────────────────
create_backup() { # [tag] → archive path on stdout
    local tag="${1:-manual}"
    if ! saves_exist; then
        warn "no world data yet — nothing to back up"
        return 0
    fi
    if is_true "$BACKUP_HOT" && api_up; then
        log "asking server to save before backup"
        palapi POST save >/dev/null 2>&1 || warn "REST save request failed, backing up anyway"
        sleep 3
    fi
    mkdir -p "$BACKUPS_DIR"
    local name path
    name="palworld-$(date -u +%Y%m%d-%H%M%S)-${tag}.tar.gz"
    path="$BACKUPS_DIR/$name"
    tar -czf "$path" -C "$PAL_ROOT" saves
    log "backup created: $name ($(du -h "$path" | cut -f1))"
    prune_backups "$BACKUPS_DIR" "$BACKUP_KEEP_COUNT" "$BACKUP_KEEP_DAYS"
    echo "$path"
}

prune_backups() { # <dir> <keep-count> <keep-days>
    local dir="$1" keep_count="${2:-0}" keep_days="${3:-0}"
    local -a files=()
    mapfile -t files < <(find "$dir" -maxdepth 1 -name 'palworld-*.tar.gz' -type f | sort)
    local n=${#files[@]} i
    if ((keep_count > 0 && n > keep_count)); then
        for ((i = 0; i < n - keep_count; i++)); do
            rm -f "${files[i]}"
            log "pruned backup (count): $(basename "${files[i]}")"
        done
    fi
    if ((keep_days > 0)); then
        while IFS= read -r -d '' f; do
            rm -f "$f"
            log "pruned backup (age): $(basename "$f")"
        done < <(find "$dir" -maxdepth 1 -name 'palworld-*.tar.gz' -type f -mtime "+$keep_days" -print0)
    fi
}

maintenance_loop() { # runs in the background from serve.sh
    local backup_s=$((BACKUP_INTERVAL_MINUTES * 60))
    local check_s=$((UPDATE_CHECK_INTERVAL_MINUTES * 60))
    local bmark="$STATE_DIR/last-scheduled-backup" cmark="$STATE_DIR/last-update-check"
    ((backup_s > 0)) && log "scheduled backups: every ${BACKUP_INTERVAL_MINUTES} min (retention: count=${BACKUP_KEEP_COUNT}, days=${BACKUP_KEEP_DAYS})"
    ((check_s > 0)) && log "update checks: every ${UPDATE_CHECK_INTERVAL_MINUTES} min"
    [[ -f "$bmark" ]] || touch "$bmark"
    [[ -f "$cmark" ]] || touch "$cmark"
    local hz prev_ticks=0 prev_ts=0 prev_pid=0
    hz="$(getconf CLK_TCK 2>/dev/null || echo 100)"
    while true; do
        sleep 15
        local now
        now="$(date +%s)"
        sample_game_stats "$hz" || true
        if ((backup_s > 0 && now - $(stat -c %Y "$bmark" 2>/dev/null || echo 0) >= backup_s)); then
            touch "$bmark"
            create_backup scheduled >/dev/null || warn "scheduled backup failed"
        fi
        if ((check_s > 0 && now - $(stat -c %Y "$cmark" 2>/dev/null || echo 0) >= check_s)); then
            touch "$cmark"
            rm -f "$STATE_DIR/remote-buildid"
            remote_buildid >/dev/null || true
        fi
        # copytruncate-style size cap so the panel's log file can't grow unbounded
        if [[ -f "$SERVER_LOG" ]] && (($(stat -c %s "$SERVER_LOG" 2>/dev/null || echo 0) > 8388608)); then
            tail -c 4194304 "$SERVER_LOG" >"$SERVER_LOG.trim" 2>/dev/null &&
                cat "$SERVER_LOG.trim" >"$SERVER_LOG" &&
                rm -f "$SERVER_LOG.trim"
        fi
    done
}

# ── graceful shutdown ────────────────────────────────────────────────────────
sample_game_stats() { # <clock-hz> — CPU/RSS of the game process for the panel
    local hz="$1" out="$STATE_DIR/game-stats.json"
    local pid statline rss ticks cpu="null" now
    now="$(date +%s)"
    pid="$(pgrep -f 'PalServer-Linux' | head -n1 || true)"
    if [[ -z "$pid" || ! -r "/proc/$pid/stat" ]]; then
        printf '{"at":%s,"running":false}\n' "$now" >"$out.tmp" && mv "$out.tmp" "$out"
        prev_pid=0 prev_ts=0
        return 0
    fi
    statline="$(cat "/proc/$pid/stat" 2>/dev/null || true)"
    [[ -n "$statline" ]] || return 0
    # the comm field may contain spaces — split only after the closing paren;
    # utime and stime are then fields 12 and 13
    set -- ${statline##*) }
    (($# >= 13)) || return 0
    ticks=$(( ${12} + ${13} ))
    rss="$(awk '/^VmRSS/{print $2}' "/proc/$pid/status" 2>/dev/null || echo 0)"
    if [[ "$pid" == "${prev_pid:-0}" ]] && ((${prev_ts:-0} > 0 && now > ${prev_ts:-0})); then
        cpu=$(( (ticks - ${prev_ticks:-0}) * 100 / (hz * (now - prev_ts)) ))
    fi
    printf '{"at":%s,"rssKb":%s,"cpuPercent":%s}\n' "$now" "$rss" "$cpu" >"$out.tmp" \
        && mv "$out.tmp" "$out"
    prev_ticks=$ticks prev_ts=$now prev_pid=$pid
}

graceful_stop() { # <game-pid>
    local pid="$1"
    local wait_s="$SHUTDOWN_WARN_SECONDS"
    if api_up; then
        log "graceful stop: save + shutdown announced (${wait_s}s warning)"
        palapi POST save >/dev/null 2>&1 || warn "REST save failed"
        local msg="${SHUTDOWN_MESSAGE//\"/}"
        if ! palapi POST shutdown "{\"waittime\":${wait_s},\"message\":\"${msg} (${wait_s}s)\"}" >/dev/null 2>&1; then
            warn "REST shutdown failed — falling back to SIGTERM"
            kill -TERM "$pid" 2>/dev/null || true
        fi
    else
        warn "REST API not reachable — sending SIGTERM to the server"
        kill -TERM "$pid" 2>/dev/null || true
    fi

    local deadline=$(($(date +%s) + wait_s + 60))
    while kill -0 "$pid" 2>/dev/null && (($(date +%s) < deadline)); do
        sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
        warn "server still up after grace window — SIGTERM"
        kill -TERM "$pid" 2>/dev/null || true
        sleep 15
    fi
    if kill -0 "$pid" 2>/dev/null; then
        warn "server unresponsive — SIGKILL"
        kill -KILL "$pid" 2>/dev/null || true
    fi
}
