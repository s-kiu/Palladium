#!/usr/bin/env bash
# run-tests.sh — shellcheck + bats for the server image.
# Uses local tools when present, falls back to Docker images.
set -Eeuo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PKG_DIR"

FAIL=0

echo "── shellcheck ──────────────────────────────────────────────"
SH_FILES=()
while IFS= read -r -d '' f; do SH_FILES+=("$f"); done \
    < <(find . -name '*.sh' -not -path './ue4ss/vendor/*' -print0)

if command -v shellcheck >/dev/null 2>&1; then
    shellcheck -x "${SH_FILES[@]}" || FAIL=1
elif command -v docker >/dev/null 2>&1; then
    docker run --rm -v "$PKG_DIR:/mnt" -w /mnt koalaman/shellcheck:stable \
        -x "${SH_FILES[@]}" || FAIL=1
else
    echo "shellcheck not found and no docker — SKIPPED" >&2
fi

echo "── bats ────────────────────────────────────────────────────"
if command -v bats >/dev/null 2>&1; then
    bats test/ || FAIL=1
elif command -v docker >/dev/null 2>&1; then
    docker run --rm -v "$PKG_DIR:/code" -w /code bats/bats:latest test/ || FAIL=1
else
    echo "bats not found and no docker — SKIPPED" >&2
    echo "install: apt install bats  |  https://bats-core.readthedocs.io" >&2
fi

exit "$FAIL"
