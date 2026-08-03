#!/usr/bin/env bats
# Update decisions, buildid parsing, backup retention, ini editing

load helpers

setup() { setup_lib; }

# ── decide_update_action ─────────────────────────────────────────────────────

@test "not installed → install, regardless of mode" {
    [ "$(decide_update_action true no '' '')" = "install" ]
    [ "$(decide_update_action false no '' '')" = "install" ]
    [ "$(decide_update_action hold no '' '')" = "install" ]
}

@test "mode=false never updates" {
    [ "$(decide_update_action false yes 100 200)" = "skip" ]
}

@test "mode=true updates when builds differ or remote unknown" {
    [ "$(decide_update_action true yes 100 200)" = "update" ]
    [ "$(decide_update_action true yes 100 '')" = "update" ]
    [ "$(decide_update_action true yes 100 100)" = "skip" ]
}

@test "mode=hold holds on newer build, skips when current or unknown" {
    [ "$(decide_update_action hold yes 100 200)" = "hold" ]
    [ "$(decide_update_action hold yes 100 100)" = "skip" ]
    [ "$(decide_update_action hold yes 100 '')" = "skip" ]
}

# ── buildid parsing ──────────────────────────────────────────────────────────

@test "acf_buildid extracts the buildid" {
    ACF="$BATS_TEST_TMPDIR/appmanifest.acf"
    cat >"$ACF" <<'EOF'
"AppState"
{
	"appid"		"2394010"
	"name"		"Palworld Dedicated Server"
	"StateFlags"		"4"
	"buildid"		"13380109"
}
EOF
    [ "$(acf_buildid "$ACF")" = "13380109" ]
}

@test "acf_buildid on a missing file is empty, not an error" {
    [ -z "$(acf_buildid /nonexistent/file.acf)" ]
}

@test "parse_remote_buildid finds the public branch buildid" {
    OUT="$(parse_remote_buildid <<'EOF'
"2394010"
{
	"depots"
	{
		"branches"
		{
			"public"
			{
				"buildid"		"13399999"
				"timeupdated"		"1753900000"
			}
			"experimental"
			{
				"buildid"		"13400001"
			}
		}
	}
}
EOF
)"
    [ "$OUT" = "13399999" ]
}

# ── backup retention ─────────────────────────────────────────────────────────

mkbackup() { # name [age-days]
    local f="$BACKUPS_DIR/$1"
    echo data >"$f"
    [[ -n "${2:-}" ]] && touch -d "$2 days ago" "$f"
    true
}

@test "prune_backups keeps the newest N by count" {
    mkbackup palworld-20260101-000000-manual.tar.gz
    mkbackup palworld-20260102-000000-manual.tar.gz
    mkbackup palworld-20260103-000000-manual.tar.gz
    prune_backups "$BACKUPS_DIR" 2 0
    [ ! -e "$BACKUPS_DIR/palworld-20260101-000000-manual.tar.gz" ]
    [ -e "$BACKUPS_DIR/palworld-20260102-000000-manual.tar.gz" ]
    [ -e "$BACKUPS_DIR/palworld-20260103-000000-manual.tar.gz" ]
}

@test "prune_backups deletes archives older than keep-days" {
    mkbackup palworld-20260701-000000-old.tar.gz 10
    mkbackup palworld-20260801-000000-new.tar.gz
    prune_backups "$BACKUPS_DIR" 0 7
    [ ! -e "$BACKUPS_DIR/palworld-20260701-000000-old.tar.gz" ]
    [ -e "$BACKUPS_DIR/palworld-20260801-000000-new.tar.gz" ]
}

@test "prune_backups ignores non-backup files" {
    echo keep >"$BACKUPS_DIR/notes.txt"
    mkbackup palworld-20260101-000000-a.tar.gz
    prune_backups "$BACKUPS_DIR" 1 0
    [ -e "$BACKUPS_DIR/notes.txt" ]
}

# ── panel log mirroring ──────────────────────────────────────────────────────

@test "log lines mirror into SERVER_LOG_ACTIVE when set" {
    SERVER_LOG_ACTIVE="$BATS_TEST_TMPDIR/panel.log" log "hello mirror"
    grep -q "hello mirror" "$BATS_TEST_TMPDIR/panel.log"
    unset SERVER_LOG_ACTIVE   # env prefixes on functions persist in bash
    log "unmirrored line"
    ! grep -q "unmirrored line" "$BATS_TEST_TMPDIR/panel.log"
}

# ── panel request markers ────────────────────────────────────────────────────

@test "restore request marker round-trips a world" {
    mkdir -p "$SAVES_DIR/SaveGames/0/w"
    echo original >"$SAVES_DIR/SaveGames/0/w/Level.sav"
    archive="$(BACKUP_HOT=false create_backup markertest)"
    echo tampered >"$SAVES_DIR/SaveGames/0/w/Level.sav"
    printf '%s' "$(basename "$archive")" >"$STATE_DIR/restore-request"
    BACKUP_HOT=false process_request_markers
    [ "$(cat "$SAVES_DIR/SaveGames/0/w/Level.sav")" = "original" ]
    [ ! -f "$STATE_DIR/restore-request" ]
    run cat "$STATE_DIR/last-request-result"
    [[ "$output" == restore\ ok* ]]
}

@test "restore request with a hostile name is rejected" {
    printf '/etc/passwd' >"$STATE_DIR/restore-request"
    process_request_markers
    [ ! -f "$STATE_DIR/restore-request" ]
    run cat "$STATE_DIR/last-request-result"
    [[ "$output" == *rejected* ]]
}

@test "update request marker runs the steam update and records the result" {
    run_steam_update() { touch "$STATE_DIR/steam-called"; return 0; }
    touch "$STATE_DIR/update-request"
    process_request_markers
    [ -f "$STATE_DIR/steam-called" ]
    [ ! -f "$STATE_DIR/update-request" ]
    run cat "$STATE_DIR/last-request-result"
    [[ "$output" == update\ ok* ]]
}

# ── UE4SS console configuration ──────────────────────────────────────────────

@test "ue4ss_headless_config honors UE4SS_HEADLESS in both directions" {
    INI="$BATS_TEST_TMPDIR/u.ini"
    printf '[Debug]\nConsoleEnabled = 1\nGuiConsoleEnabled = 1\nGuiConsoleVisible = 1\n' >"$INI"
    ue4ss_headless_config "$INI"
    run cat "$INI"
    [[ "$output" == *"ConsoleEnabled = 0"* ]]
    UE4SS_HEADLESS=false ue4ss_headless_config "$INI"
    run cat "$INI"
    [[ "$output" == *"ConsoleEnabled = 1"* ]]
    [[ "$output" == *"GuiConsoleEnabled = 1"* ]]
}

# ── rapid-crash counter ──────────────────────────────────────────────────────

@test "fastcrash counter increments per context and resets on context change" {
    CTX_A="ue4ss-v1@build100"
    CTX_B="ue4ss-v2@build100"
    [ "$(fastcrash_count "$CTX_A")" = "0" ]
    [ "$(fastcrash_record "$CTX_A")" = "1" ]
    [ "$(fastcrash_record "$CTX_A")" = "2" ]
    [ "$(fastcrash_count "$CTX_A")" = "2" ]
    # different loader/game pairing → old count irrelevant
    [ "$(fastcrash_count "$CTX_B")" = "0" ]
    [ "$(fastcrash_record "$CTX_B")" = "1" ]
    fastcrash_reset
    [ "$(fastcrash_count "$CTX_B")" = "0" ]
}

@test "fastcrash_prune_stale drops counters from a different pairing only" {
    fastcrash_record "old-loader@100" >/dev/null
    fastcrash_prune_stale "new-loader@200"
    [ ! -f "$STATE_DIR/ue4ss-fastcrash" ]
    fastcrash_record "new-loader@200" >/dev/null
    fastcrash_prune_stale "new-loader@200"
    [ "$(fastcrash_count "new-loader@200")" = "1" ]
}

@test "fastcrash_count survives a corrupt state file" {
    echo "garbage-no-separator" >"$STATE_DIR/ue4ss-fastcrash"
    [ "$(fastcrash_count "x@y")" = "0" ]
    printf 'x@y|not-a-number\n' >"$STATE_DIR/ue4ss-fastcrash"
    [ "$(fastcrash_count "x@y")" = "0" ]
}

# ── steamcmd bootstrap ───────────────────────────────────────────────────────

@test "steamcmd_run copies the seed into a writable dir, marks it executable, runs it" {
    STEAMCMD_SEED="$BATS_TEST_TMPDIR/seed"
    STEAMCMD_SH="$BATS_TEST_TMPDIR/home/steamcmd/steamcmd.sh"
    mkdir -p "$STEAMCMD_SEED/linux32"
    printf '#!/usr/bin/env bash\necho ran-ok "$@"\n' >"$STEAMCMD_SEED/steamcmd.sh"
    echo bin >"$STEAMCMD_SEED/linux32/steamcmd"
    chmod 644 "$STEAMCMD_SEED/steamcmd.sh"    # seed itself is not executable
    run steamcmd_run +login anonymous
    [ "$status" -eq 0 ]
    [[ "$output" == *"ran-ok +login anonymous"* ]]
    [ -x "$STEAMCMD_SH" ]
    [ -f "$BATS_TEST_TMPDIR/home/steamcmd/linux32/steamcmd" ]
    # second call must not re-bootstrap (no "bootstrapping" log line)
    run steamcmd_run
    [[ "$output" != *bootstrapping* ]]
}

# ── cross-container run guard ────────────────────────────────────────────────

@test "server_is_stopped fails while the volume lock is held, passes after" {
    mkdir -p "$STATE_DIR"
    # isolate from the test host: a real Palworld server may be running here,
    # and pgrep sees straight into containers — this test is about the lock.
    game_running() { return 1; }
    # hold the lock the way serve.sh does: fd 9, owned by the process itself
    ( exec 9>>"$STATE_DIR/server.lock" && flock -n 9 && exec sleep 30 ) &
    HOLDER=$!
    sleep 0.3
    ! server_is_stopped
    kill "$HOLDER"
    wait "$HOLDER" 2>/dev/null || true
    server_is_stopped
}

# ── engine tick rate ─────────────────────────────────────────────────────────

@test "gen_engine_tickrate writes Engine.ini when set, rejects junk" {
    SERVER_TICKRATE=120 gen_engine_tickrate
    run cat "$SAVES_DIR/Config/LinuxServer/Engine.ini"
    [[ "$output" == *'[/script/onlinesubsystemutils.ipnetdriver]'* ]]
    [[ "$output" == *'NetServerMaxTickRate=120'* ]]
    [[ "$output" == *'LanServerMaxTickRate=120'* ]]
    rm -rf "$SAVES_DIR/Config"
    SERVER_TICKRATE="60; rm -rf /" gen_engine_tickrate
    [ ! -e "$SAVES_DIR/Config/LinuxServer/Engine.ini" ]
}

# ── ini_set ──────────────────────────────────────────────────────────────────

@test "ini_set updates an existing key in the right section" {
    INI="$BATS_TEST_TMPDIR/x.ini"
    printf '[Debug]\nConsoleEnabled = 1\n[Other]\nConsoleEnabled = 1\n' >"$INI"
    ini_set "$INI" Debug ConsoleEnabled 0
    run cat "$INI"
    [[ "$output" == *"[Debug]
ConsoleEnabled = 0"* ]]
    [[ "$output" == *"[Other]
ConsoleEnabled = 1"* ]]
}

@test "ini_set appends a missing key to an existing section" {
    INI="$BATS_TEST_TMPDIR/x.ini"
    printf '[Debug]\nSomething = a\n[Zed]\nz = 1\n' >"$INI"
    ini_set "$INI" Debug GuiConsoleEnabled 0
    run awk '/^\[Debug\]/,/^\[Zed\]/' "$INI"
    [[ "$output" == *"GuiConsoleEnabled = 0"* ]]
}

@test "ini_set creates the section when absent (and on empty files)" {
    INI="$BATS_TEST_TMPDIR/new.ini"
    ini_set "$INI" Debug ConsoleEnabled 0
    run cat "$INI"
    [[ "$output" == *"[Debug]"* ]]
    [[ "$output" == *"ConsoleEnabled = 0"* ]]
}
