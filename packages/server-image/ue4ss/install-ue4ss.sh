#!/usr/bin/env bash
# install-ue4ss.sh — Docker BUILD-TIME staging of the vendored UE4SS artifact.
#
#   install-ue4ss.sh <src-dir> <dest-dir> <omit:true|false>
#
# Resolution order:
#   1. UE4SS_OMIT=true build arg          -> stage nothing (marker file)
#   2. tarball present in <src>/vendor/   -> verify against lock, stage it
#   3. lock pinned but tarball absent     -> download from the pinned release,
#                                            verify sha256, stage it
#   4. lock not pinned                    -> stage nothing (marker file)
#
# "Stage" = extract and normalize into <dest>:
#   libUE4SS.so, *.ini config templates, bundled Mods/, .version

set -Eeuo pipefail

SRC="${1:?src dir}"
DST="${2:?dest dir}"
OMIT="${3:-false}"
LOCK="$SRC/ue4ss.lock"

die() { echo "install-ue4ss: ERROR: $*" >&2; exit 1; }
note() { echo "install-ue4ss: $*" >&2; }

lock_get() { sed -n "s/^$1=//p" "$LOCK" | head -n1; }

omit() {
    mkdir -p "$DST"
    echo "$1" >"$DST/.omitted"
    note "UE4SS omitted from this image: $1"
    exit 0
}

[[ "$OMIT" == "true" ]] && omit "UE4SS_OMIT=true build arg"
[[ -f "$LOCK" ]] || die "lock file missing: $LOCK"

REPO="$(lock_get UE4SS_REPO)"
TAG="$(lock_get UE4SS_TAG)"
ARTIFACT_TPL="$(lock_get UE4SS_ARTIFACT)"
SHA="$(lock_get UE4SS_SHA256)"

# "{tag}" in the artifact template expands to the pinned tag.
ARTIFACT="${ARTIFACT_TPL//\{tag\}/$TAG}"
TARBALL="$SRC/vendor/$ARTIFACT"

if [[ ! -f "$TARBALL" ]]; then
    if [[ -z "$SHA" ]]; then
        omit "ue4ss.lock has no pinned checksum — run ue4ss/vendor.sh --pin and rebuild"
    fi
    URL="https://github.com/$REPO/releases/download/$TAG/$ARTIFACT"
    note "vendor tarball absent; fetching pinned release $URL"
    curl -fL --retry 3 --retry-delay 2 -o "$TARBALL" "$URL" \
        || die "download failed: $URL"
fi

[[ -n "$SHA" ]] || die "tarball provided but lock has no checksum — pin it first (vendor.sh --pin)"
echo "$SHA  $TARBALL" | sha256sum -c --quiet - \
    || die "sha256 mismatch: $TARBALL does not match ue4ss.lock"

WORK="$(mktemp -d)"
tar -xzf "$TARBALL" -C "$WORK" || die "could not extract $TARBALL"

# Layout inside upstream tarballs varies (flat vs. one top-level dir); locate
# the library and treat its directory as the artifact root.
LIB="$(find "$WORK" -name 'libUE4SS.so' -type f | head -n1)"
[[ -n "$LIB" ]] || die "libUE4SS.so not found inside $ARTIFACT — wrong or corrupt artifact?"
ROOT="$(dirname "$LIB")"

mkdir -p "$DST"
cp "$LIB" "$DST/libUE4SS.so"
# Config templates shipped by the port (UE4SS-settings.ini,
# MemberVariableLayout.ini, ...) and any build metadata.
find "$ROOT" -maxdepth 1 -type f \( -name '*.ini' -o -name 'BUILD_INFO*' \) \
    -exec cp {} "$DST/" \;
# Bundled mods and signature overrides (UE4SS_Signatures carries Lua-side
# function-address fixes, e.g. the FName::ToString leak fix).
for dir in Mods UE4SS_Signatures; do
    if [[ -d "$ROOT/$dir" ]]; then
        cp -r "$ROOT/$dir" "$DST/$dir"
    fi
done

printf '%s %s\n' "$TAG" "$SHA" >"$DST/.version"
rm -rf "$WORK"
note "staged UE4SS $TAG into $DST"
