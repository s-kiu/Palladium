#!/usr/bin/env bash
# backups.sh — list world snapshots, newest last.
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib.sh"

shopt -s nullglob
FILES=("$BACKUPS_DIR"/palworld-*.tar.gz)
if [[ ${#FILES[@]} -eq 0 ]]; then
    echo "no backups yet (dir: $BACKUPS_DIR)"
    exit 0
fi

printf '%-55s %10s\n' "ARCHIVE" "SIZE"
for f in "${FILES[@]}"; do
    printf '%-55s %10s\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)"
done
echo
echo "restore one with: docker compose run --rm palworld restore <archive|latest>"
