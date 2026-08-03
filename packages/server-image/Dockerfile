# syntax=docker/dockerfile:1
# pal-up game server image — Palworld dedicated server + UE4SS (Linux native).
#
# Build (from repo root):
#   docker build -t pal-up/palworld-server:dev packages/server-image
#
# The UE4SS mod loader is vendored & checksum-pinned via ue4ss/ue4ss.lock.
# If the lock has no checksum yet (run ue4ss/vendor.sh --pin), the image builds
# WITHOUT mod support and says so at runtime. Never fetched at runtime.

# ── Stage 1: stage the vendored UE4SS artifact ───────────────────────────────
FROM ubuntu:24.04 AS ue4ss
ARG UE4SS_OMIT=false
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY ue4ss/ /src/
RUN bash /src/install-ue4ss.sh /src /opt/ue4ss "$UE4SS_OMIT"

# ── Stage 2: runtime image ───────────────────────────────────────────────────
FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
# lib32gcc-s1 + lib32stdc++6: SteamCMD is a 32-bit binary.
# libx11-6: link-time dependency of the vendored libUE4SS.so (built with GUI
# support); required for the loader to resolve it even though the GUI stays
# disabled on a headless server.
RUN dpkg --add-architecture i386 \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl jq rsync procps tzdata xdg-user-dirs \
        tini gosu \
        lib32gcc-s1 lib32stdc++6 \
        libx11-6 \
    && rm -rf /var/lib/apt/lists/*

# SteamCMD from Valve's official installer tarball (it self-updates on first
# run, so there is no meaningful version to pin here). This is only a pristine
# seed: SteamCMD must be able to write to its own directory, so the entrypoint
# copies it into the unprivileged user's home (on the data volume) on first use.
RUN mkdir -p /opt/steamcmd \
    && curl -fsSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz \
       | tar -xz -C /opt/steamcmd \
    && chmod -R a+rX /opt/steamcmd \
    && chmod a+x /opt/steamcmd/steamcmd.sh /opt/steamcmd/linux32/steamcmd

COPY --from=ue4ss /opt/ue4ss /opt/ue4ss
COPY entrypoint/ /opt/pal-up/
COPY scripts/ /opt/pal-up/scripts/
COPY config/ /opt/pal-up/config/
RUN chmod +x /opt/pal-up/entrypoint.sh /opt/pal-up/run.sh \
        /opt/pal-up/cmd/*.sh /opt/pal-up/scripts/*.sh \
    && ln -s /opt/pal-up/entrypoint.sh /usr/local/bin/pal-up

# Game traffic (UDP) and the admin REST API (TCP — keep it internal!).
EXPOSE 8211/udp 8212/tcp

# start-period is generous: the first boot downloads ~15 GB from Steam.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20m --retries=5 \
    CMD ["/opt/pal-up/scripts/healthcheck.sh"]

LABEL org.opencontainers.image.title="pal-up Palworld Server" \
      org.opencontainers.image.description="Palworld dedicated server with native-Linux UE4SS mod support" \
      org.opencontainers.image.source="https://github.com/s-kiu/pal-up" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/pal-up/entrypoint.sh"]
CMD ["serve"]
