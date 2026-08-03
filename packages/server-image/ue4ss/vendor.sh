#!/usr/bin/env bash
# vendor.sh — fetch & pin the UE4SS Linux artifact used by the server image.
#
#   ./vendor.sh              download (if missing) and verify against the lock
#   ./vendor.sh --pin [TAG]  download TAG (default: lock's tag), record its
#                            sha256 in ue4ss.lock — trust-on-first-use
#   ./vendor.sh --verify     verify an already-downloaded artifact only
#
# The image build only ever accepts an artifact matching the sha256 recorded
# in ue4ss.lock; this script is the only place a new artifact/checksum enters
# the project. Review what you pin — you are trusting native code that will
# run inside your game server. Building upstream from source is the paranoid
# path: drop your own tarball into vendor/ before pinning.

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCK="$HERE/ue4ss.lock"
VENDOR_DIR="$HERE/vendor"

die() { echo "vendor.sh: ERROR: $*" >&2; exit 1; }
note() { echo "vendor.sh: $*" >&2; }

lock_get() { sed -n "s/^$1=//p" "$LOCK" | head -n1; }

lock_set() {
    local key=$1 value=$2
    if grep -q "^$key=" "$LOCK"; then
        sed -i "s|^$key=.*|$key=$value|" "$LOCK"
    else
        echo "$key=$value" >>"$LOCK"
    fi
}

[[ -f "$LOCK" ]] || die "lock file not found: $LOCK"

REPO="$(lock_get UE4SS_REPO)"
TAG="$(lock_get UE4SS_TAG)"
ARTIFACT_TPL="$(lock_get UE4SS_ARTIFACT)"
SHA="$(lock_get UE4SS_SHA256)"
[[ -n "$REPO" && -n "$ARTIFACT_TPL" ]] || die "lock file is missing UE4SS_REPO / UE4SS_ARTIFACT"

# Release asset names embed the tag (ue4ss-linux-palworld-<tag>.tar.gz), so
# the lock stores a template that gets expanded per tag.
artifact_name() { echo "${ARTIFACT_TPL//\{tag\}/$1}"; }

download() { # <tag>
    local tag=$1 artifact url tmp
    artifact="$(artifact_name "$tag")"
    url="https://github.com/$REPO/releases/download/$tag/$artifact"
    tmp="$VENDOR_DIR/$artifact.part"
    mkdir -p "$VENDOR_DIR"
    note "downloading $url"
    curl -fL --retry 3 --retry-delay 2 -o "$tmp" "$url" \
        || die "download failed: $url"
    mv "$tmp" "$VENDOR_DIR/$artifact"
}

verify() { # <tag>
    local tarball
    tarball="$VENDOR_DIR/$(artifact_name "$1")"
    [[ -f "$tarball" ]] || die "artifact not present: $tarball (run: $0)"
    [[ -n "$SHA" ]] || die "lock has no checksum yet (run: $0 --pin)"
    echo "$SHA  $tarball" | sha256sum -c --quiet - \
        || die "sha256 MISMATCH for $tarball — artifact does not match the lock. \
Delete it and re-download, or re-pin deliberately with --pin."
    note "OK: $(basename "$tarball") matches pinned sha256"
}

case "${1:---fetch}" in
--pin)
    TAG="${2:-$TAG}"
    [[ -n "$TAG" ]] || die "no tag given and none in lock"
    TARBALL="$VENDOR_DIR/$(artifact_name "$TAG")"
    [[ -f "$TARBALL" ]] || download "$TAG"
    SHA="$(sha256sum "$TARBALL" | cut -d' ' -f1)"
    lock_set UE4SS_TAG "$TAG"
    lock_set UE4SS_SHA256 "$SHA"
    note "pinned $REPO@$TAG"
    note "sha256: $SHA"
    cat >&2 <<'EOF'

  ┌────────────────────────────────────────────────────────────────────┐
  │ TRUST NOTICE                                                       │
  │ You just pinned a native library that will be LD_PRELOADed into    │
  │ your game server. This checksum guarantees future builds get the   │
  │ same bytes — it does not vouch for the bytes themselves.           │
  │ Review the upstream release, or build it from source and drop the  │
  │ tarball into ue4ss/vendor/ before pinning.                         │
  └────────────────────────────────────────────────────────────────────┘
EOF
    note "commit the updated ue4ss.lock; vendor/*.tar.gz stays untracked"
    ;;
--verify)
    verify "$TAG"
    ;;
--fetch)
    [[ -n "$SHA" ]] || die "lock has no checksum yet — run: $0 --pin"
    [[ -f "$VENDOR_DIR/$(artifact_name "$TAG")" ]] || download "$TAG"
    verify "$TAG"
    ;;
*)
    die "unknown argument: $1 (use --pin [tag], --verify, or no args)"
    ;;
esac
