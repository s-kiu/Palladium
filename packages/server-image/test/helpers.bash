# helpers.bash — common setup for the server-image bats suite.
# Sources lib.sh with PAL_ROOT pointed at a per-test tmpdir.

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

setup_lib() {
    export PALUP_TEST=1
    export PAL_ROOT="$BATS_TEST_TMPDIR/palworld"
    export UE4SS_STAGE="$BATS_TEST_TMPDIR/ue4ss-stage"
    export MAP_FILE="$PKG_DIR/config/settings.map"
    export MODS_BASE_FALLBACK="$PKG_DIR/config/mods-base.txt"
    mkdir -p "$PAL_ROOT"
    # shellcheck source=../entrypoint/lib.sh
    source "$PKG_DIR/entrypoint/lib.sh"
    mkdir -p "$STATE_DIR" "$BACKUPS_DIR" "$SAVES_DIR" "$USER_MODS_DIR"
}
