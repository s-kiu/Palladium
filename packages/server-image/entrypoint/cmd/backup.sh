#!/usr/bin/env bash
# backup.sh — create a world snapshot now. Optional tag becomes part of the name.
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

TAG="${1:-manual}"
if ! [[ "$TAG" =~ ^[A-Za-z0-9_-]+$ ]]; then
    die "invalid tag '$TAG' (letters, digits, _ and - only)"
fi

PATH_CREATED="$(create_backup "$TAG")"
if [[ -n "$PATH_CREATED" ]]; then
    echo "$PATH_CREATED"
fi
