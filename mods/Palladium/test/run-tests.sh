#!/usr/bin/env bash
# run-tests.sh — syntax-check the agent and run its action tests.
# Uses a local Lua 5.4 when present, falls back to Docker.
set -Eeuo pipefail

MOD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$MOD_DIR"

run() {
    local lua=$1 luac=$2
    echo "── syntax ──────────────────────────────────────────────────"
    find Scripts test -name '*.lua' -print0 | xargs -0 -n1 "$luac" -p
    echo "ok"

    echo "── actions ─────────────────────────────────────────────────"
    local root
    root="$(mktemp -d)"
    trap 'rm -rf "$root"' RETURN
    mkdir -p "$root/logs" "$root/.state"
    : > "$root/logs/bridge-events.jsonl"
    : > "$root/.state/bridge-actions.jsonl"
    PALLADIUM_TEST_ROOT="$root" PALLADIUM_SCRIPTS="$MOD_DIR/Scripts" "$lua" test/actions.lua

    echo "── store & permissions ─────────────────────────────────────"
    local store_root
    store_root="$(mktemp -d)"
    PALLADIUM_TEST_ROOT="$store_root" PALLADIUM_SCRIPTS="$MOD_DIR/Scripts" "$lua" test/store.lua
    local store_status=$?
    rm -rf "$store_root"
    [[ $store_status -eq 0 ]] || return $store_status

    echo "── collections ─────────────────────────────────────────────"
    local col_root
    col_root="$(mktemp -d)"
    PALLADIUM_TEST_ROOT="$col_root" PALLADIUM_SCRIPTS="$MOD_DIR/Scripts" "$lua" test/collections.lua
    local col_status=$?
    rm -rf "$col_root"
    [[ $col_status -eq 0 ]] || return $col_status

    echo "── framework ───────────────────────────────────────────────"
    local fw_root
    fw_root="$(mktemp -d)"
    mkdir -p "$fw_root/.state" "$fw_root/logs"
    PALLADIUM_TEST_ROOT="$fw_root" PALLADIUM_SCRIPTS="$MOD_DIR/Scripts" "$lua" test/framework.lua
    local status=$?
    rm -rf "$fw_root"
    return $status
}

if command -v lua5.4 >/dev/null 2>&1 && command -v luac5.4 >/dev/null 2>&1; then
    run lua5.4 luac5.4
elif command -v lua >/dev/null 2>&1 && command -v luac >/dev/null 2>&1; then
    run lua luac
elif command -v docker >/dev/null 2>&1; then
    docker run --rm -v "$MOD_DIR:/mod" -w /mod ubuntu:24.04 bash -c \
        'apt-get update -qq && apt-get install -y -qq lua5.4 >/dev/null && test/run-tests.sh'
else
    echo "no lua and no docker — SKIPPED" >&2
    echo "install: apt install lua5.4" >&2
    exit 1
fi
