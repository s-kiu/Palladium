#!/usr/bin/env bash
# healthcheck.sh — healthy iff the game process runs and (when enabled) the
# REST API answers. The Dockerfile's start-period absorbs the long first-boot
# Steam download.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh" 2>/dev/null \
    || source /opt/pal-up/lib.sh

game_running || exit 1

if is_true "$REST_API_ENABLED"; then
    curl -sf -m 5 -u "admin:${ADMIN_PASSWORD:-}" \
        "http://127.0.0.1:${REST_API_PORT}/v1/api/info" >/dev/null || exit 1
fi

exit 0
