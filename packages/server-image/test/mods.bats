#!/usr/bin/env bats
# Mod syncing and mods.txt generation

load helpers

setup() {
    setup_lib
    TARGET="$BATS_TEST_TMPDIR/server-Mods"
    MANIFEST="$STATE_DIR/lua-mods.manifest"
    mkdir -p "$TARGET"
}

mkmod() { mkdir -p "$USER_MODS_DIR/$1/scripts"; echo "-- $1" >"$USER_MODS_DIR/$1/scripts/main.lua"; }

# A mod Palladium loads inside the game: a mod.lua, and no Scripts/ for UE4SS.
mkfwmod() {
    mkdir -p "$USER_MODS_DIR/$1"
    echo "return { name = \"$1\" }" >"$USER_MODS_DIR/$1/mod.lua"
}

# A mod the panel runs outside the game: a manifest and an entry file, no Lua.
mkscriptmod() {
    mkdir -p "$USER_MODS_DIR/$1"
    echo "{\"name\":\"$1\",\"entry\":\"main.mjs\"}" >"$USER_MODS_DIR/$1/mod.json"
    echo "// $1" >"$USER_MODS_DIR/$1/main.mjs"
}

@test "valid_mod_name accepts sane names, rejects hostile ones" {
    valid_mod_name "CoolMod"
    valid_mod_name "mod-2.1_x"
    ! valid_mod_name "has space"
    ! valid_mod_name "../escape"
    ! valid_mod_name ".hidden"
    ! valid_mod_name ""
}

@test "sync_lua_mods copies mods and records a manifest" {
    mkmod Alpha
    mkmod Beta
    sync_lua_mods "$USER_MODS_DIR" "$TARGET" "$MANIFEST"
    [ -f "$TARGET/Alpha/scripts/main.lua" ]
    [ -f "$TARGET/Beta/scripts/main.lua" ]
    run cat "$MANIFEST"
    [[ "$output" == *"Alpha"* && "$output" == *"Beta"* ]]
}

@test "sync_lua_mods removes previously-synced mods that disappeared" {
    mkmod Alpha
    mkmod Beta
    sync_lua_mods "$USER_MODS_DIR" "$TARGET" "$MANIFEST"
    rm -rf "$USER_MODS_DIR/Beta"
    sync_lua_mods "$USER_MODS_DIR" "$TARGET" "$MANIFEST"
    [ -d "$TARGET/Alpha" ]
    [ ! -d "$TARGET/Beta" ]
}

@test "sync_lua_mods strips shipped enabled.txt so mods.txt stays authoritative" {
    mkmod Alpha
    touch "$USER_MODS_DIR/Alpha/enabled.txt"
    sync_lua_mods "$USER_MODS_DIR" "$TARGET" "$MANIFEST"
    [ ! -e "$TARGET/Alpha/enabled.txt" ]          # stripped from the copy
    [ -e "$USER_MODS_DIR/Alpha/enabled.txt" ]     # source untouched
    MODS_TXT_MODE=manual sync_lua_mods "$USER_MODS_DIR" "$TARGET" "$MANIFEST"
    [ -e "$TARGET/Alpha/enabled.txt" ]            # preserved in manual mode
}

@test "sync_lua_mods never deletes folders it did not create" {
    mkdir -p "$TARGET/BPModLoaderMod"    # bundled UE4SS mod, not user-managed
    mkmod Alpha
    sync_lua_mods "$USER_MODS_DIR" "$TARGET" "$MANIFEST"
    [ -d "$TARGET/BPModLoaderMod" ]
}

@test "a mod with no Lua half is left for the panel to run" {
    mkscriptmod Kit
    mkmod Alpha
    sync_lua_mods "$USER_MODS_DIR" "$TARGET" "$MANIFEST"
    [ -d "$TARGET/Alpha" ]
    [ ! -d "$TARGET/Kit" ]
    run cat "$MANIFEST"
    [[ "$output" != *"Kit"* ]]
    gen_mods_txt "$USER_MODS_DIR" "$TARGET"
    run cat "$TARGET/mods.txt"
    [[ "$output" == *"Alpha : 1"* && "$output" != *"Kit"* ]]
}

@test "a framework mod is synced for Palladium but kept out of mods.txt" {
    mkfwmod Streak
    sync_lua_mods "$USER_MODS_DIR" "$TARGET" "$MANIFEST"
    [ -f "$TARGET/Streak/mod.lua" ]          # Palladium loads it from here
    gen_mods_txt "$USER_MODS_DIR" "$TARGET"
    run cat "$TARGET/mods.txt"
    [[ "$output" != *"Streak"* ]]            # UE4SS has nothing to load
}

@test "gen_mods_list names the framework mods Palladium should load" {
    mkfwmod Streak
    mkfwmod Kits
    mkfwmod Off
    touch "$USER_MODS_DIR/Off/.disabled"
    mkmod Alpha
    mkscriptmod PanelRun
    mkdir -p "$TARGET/Palladium"
    gen_mods_list "$USER_MODS_DIR" "$TARGET"
    run cat "$TARGET/Palladium/mods.list"
    [[ "$output" == *"Streak"* && "$output" == *"Kits"* ]]
    [[ "$output" != *"Off"* ]]               # .disabled keeps it out
    [[ "$output" != *"Alpha"* && "$output" != *"PanelRun"* ]]
}

@test "gen_mods_list does nothing when Palladium is not installed" {
    mkfwmod Streak
    gen_mods_list "$USER_MODS_DIR" "$TARGET"
    [ ! -f "$TARGET/Palladium/mods.list" ]
}

@test "a mod with both halves is synced like any other Lua mod" {
    mkmod Both
    echo '{"name":"Both","entry":"main.mjs"}' >"$USER_MODS_DIR/Both/mod.json"
    sync_lua_mods "$USER_MODS_DIR" "$TARGET" "$MANIFEST"
    [ -f "$TARGET/Both/scripts/main.lua" ]
    gen_mods_txt "$USER_MODS_DIR" "$TARGET"
    run cat "$TARGET/mods.txt"
    [[ "$output" == *"Both : 1"* ]]
}

@test "a folder with neither half is still synced — odd layouts predate manifests" {
    mkdir -p "$USER_MODS_DIR/Odd"
    echo "-- flat" >"$USER_MODS_DIR/Odd/main.lua"
    sync_lua_mods "$USER_MODS_DIR" "$TARGET" "$MANIFEST"
    [ -f "$TARGET/Odd/main.lua" ]
}

@test "a mod that loses its Lua half is removed from the server tree" {
    mkmod Shrink
    sync_lua_mods "$USER_MODS_DIR" "$TARGET" "$MANIFEST"
    [ -d "$TARGET/Shrink" ]
    rm -rf "$USER_MODS_DIR/Shrink/scripts"
    echo '{"name":"Shrink","entry":"main.mjs"}' >"$USER_MODS_DIR/Shrink/mod.json"
    sync_lua_mods "$USER_MODS_DIR" "$TARGET" "$MANIFEST"
    [ ! -d "$TARGET/Shrink" ]
}

@test "gen_mods_txt merges base file with user mods" {
    BASE="$BATS_TEST_TMPDIR/base.txt"
    printf '; comment\nBPModLoaderMod : 1\nKeybinds : 0\n' >"$BASE"
    mkmod Alpha
    gen_mods_txt "$USER_MODS_DIR" "$TARGET" "$BASE"
    run cat "$TARGET/mods.txt"
    [[ "$output" == *"BPModLoaderMod : 1"* ]]
    [[ "$output" == *"Keybinds : 0"* ]]
    [[ "$output" == *"Alpha : 1"* ]]
}

@test "gen_mods_txt marks .disabled mods with 0" {
    mkmod Alpha
    touch "$USER_MODS_DIR/Alpha/.disabled"
    gen_mods_txt "$USER_MODS_DIR" "$TARGET" ""
    run cat "$TARGET/mods.txt"
    [[ "$output" == *"Alpha : 0"* ]]
}

@test "user entry overrides a base entry with the same name" {
    BASE="$BATS_TEST_TMPDIR/base.txt"
    printf 'Alpha : 0\n' >"$BASE"
    mkmod Alpha
    gen_mods_txt "$USER_MODS_DIR" "$TARGET" "$BASE"
    run grep -c '^Alpha' "$TARGET/mods.txt"
    [ "$output" = "1" ]
    run cat "$TARGET/mods.txt"
    [[ "$output" == *"Alpha : 1"* ]]
}
