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
