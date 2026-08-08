#!/usr/bin/env bats
# PalWorldSettings.ini generation

load helpers

setup() { setup_lib; }

@test "norm_bool accepts common truthy spellings" {
    [ "$(norm_bool True)" = "true" ]
    [ "$(norm_bool YES)" = "true" ]
    [ "$(norm_bool 1)" = "true" ]
    [ "$(norm_bool on)" = "true" ]
    [ "$(norm_bool false)" = "false" ]
    [ "$(norm_bool 0)" = "false" ]
    [ "$(norm_bool banana)" = "false" ]
    [ "$(norm_bool '')" = "false" ]
}

@test "ini_bool renders Palworld-style True/False" {
    [ "$(ini_bool yes)" = "True" ]
    [ "$(ini_bool nope)" = "False" ]
}

@test "defaults are emitted for mapped keys with defaults" {
    out="$(build_option_settings "$MAP_FILE")"
    [[ "$out" == OptionSettings=\(* ]]
    [[ "$out" == *'ServerName="Palworld Server (Pal-Up)"'* ]]
    [[ "$out" == *'ServerPlayerMaxNum=32'* ]]
    [[ "$out" == *'RESTAPIEnabled=True'* ]]
}

@test "optional unset keys are omitted" {
    out="$(build_option_settings "$MAP_FILE")"
    [[ "$out" != *'ExpRate'* ]]
    [[ "$out" != *'bIsPvP'* ]]
}

@test "env vars override defaults and set optional keys" {
    SERVER_NAME='My "Cool" Server' EXP_RATE=2.5 PVP=yes \
        out="$(build_option_settings "$MAP_FILE")"
    [[ "$out" == *'ServerName="My \"Cool\" Server"'* ]]
    [[ "$out" == *'ExpRate=2.5'* ]]
    [[ "$out" == *'bIsPvP=True'* ]]
}

@test "OPT_ passthrough appends unmapped keys verbatim" {
    OPT_SupplyDropSpan=180 out="$(build_option_settings "$MAP_FILE")"
    [[ "$out" == *'SupplyDropSpan=180'* ]]
}

@test "OPT_ passthrough overrides mapped keys" {
    OPT_ServerPlayerMaxNum=64 out="$(build_option_settings "$MAP_FILE")"
    [[ "$out" == *'ServerPlayerMaxNum=64'* ]]
    [[ "$out" != *'ServerPlayerMaxNum=32'* ]]
}

@test "panel overrides beat map defaults, env vars, and OPT_" {
    mkdir -p "$CONFIG_DIR"
    printf '# managed by the panel\nExpRate=3.5\nServerPlayerMaxNum=48\nSupplyDropSpan=99\nbad key=1\n' \
        >"$PANEL_SETTINGS_FILE"
    EXP_RATE=2.0 OPT_ServerPlayerMaxNum=64 out="$(build_option_settings "$MAP_FILE")"
    [[ "$out" == *'ExpRate=3.5'* ]]           # beats env var
    [[ "$out" == *'ServerPlayerMaxNum=48'* ]] # beats OPT_
    [[ "$out" == *'SupplyDropSpan=99'* ]]     # appends unmapped keys
    [[ "$out" != *'bad key'* ]]               # malformed lines ignored
}

@test "gen_settings_ini writes the section header and settings line" {
    ADMIN_PASSWORD=secret gen_settings_ini
    run cat "$SETTINGS_INI"
    [[ "$output" == *'[/Script/Pal.PalGameWorldSettings]'* ]]
    [[ "$output" == *'AdminPassword="secret"'* ]]
}

@test "gen_settings_ini respects SETTINGS_MODE=manual" {
    SETTINGS_MODE=manual gen_settings_ini
    [ ! -f "$SETTINGS_INI" ]
}
