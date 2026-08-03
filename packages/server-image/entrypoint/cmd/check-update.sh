#!/usr/bin/env bash
# check-update.sh — is a Steam update available?
# exit 0 = up to date, 1 = update available, 2 = unknown / not installed
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

LOCAL_BUILD="$(local_buildid)"
if [[ -z "$LOCAL_BUILD" ]]; then
    echo "installed: none (server not installed yet)"
    exit 2
fi

REMOTE_BUILD="$(remote_buildid)"
echo "installed: $LOCAL_BUILD"
echo "latest:    ${REMOTE_BUILD:-unknown}"

if [[ -z "$REMOTE_BUILD" ]]; then
    echo "status:    could not reach Steam (try again in a minute)"
    exit 2
elif [[ "$REMOTE_BUILD" == "$LOCAL_BUILD" ]]; then
    echo "status:    up to date"
    exit 0
else
    echo "status:    UPDATE AVAILABLE"
    echo "apply it:  docker compose stop palworld && docker compose run --rm palworld update && docker compose start palworld"
    exit 1
fi
