# Security model

## TL;DR

- Expose **only `8211/udp`** to players. Nothing else. Ever.
- The admin REST API (`:8212`) authenticates with `admin:$ADMIN_PASSWORD`
  over **plain HTTP** — it must never leave the Docker network.
- `ADMIN_PASSWORD` is both the in-game admin password and the API credential:
  make it long, random, and unique.
- The UE4SS library is native code injected into the server — it is
  checksum-pinned at build time and never fetched at runtime, but *you*
  choose what to trust when you pin it.

## Ports

| Port | Proto | What | Exposure |
|---|---|---|---|
| 8211 | UDP | Game traffic | **Public** (players need it) |
| 8212 | TCP | REST admin API | **Internal only** — not published in compose.yaml |
| 25575 | TCP | RCON (off by default) | Internal only, prefer REST |
| 3000 | TCP | Web panel | **LAN / VPN only** — plain HTTP, admin credentials |

`compose.yaml` deliberately publishes only 8211/udp. If you add a reverse
proxy or run with `network_mode: host`, you take over this responsibility —
verify with `ss -tulpn` that 8212/25575 aren't reachable from outside.

## The REST admin API

Palworld's REST API (`/v1/api/*`) has no TLS and HTTP Basic auth. Inside this
project it is consumed only from localhost (`pal-up palapi`, healthcheck).
For remote admin, SSH into the host and use `docker compose exec`; don't
port-forward 8212.

## Container hardening

- The game process runs as the unprivileged `PUID:PGID` (default 1000:1000),
  never root; the entrypoint drops privileges via gosu after fixing volume
  ownership.
- The image contains no SSH, no cron daemon, no package manager caches.
- The game install is a normal Steam depot; `VALIDATE_ON_BOOT=true`
  re-verifies every file against Steam's manifest if you suspect tampering.

## UE4SS trust model

UE4SS is `LD_PRELOAD`ed native code with full access to the server process.
Threat vectors: a malicious upstream release, or a compromised release asset.
Mitigations in this project:

- **Vendored + pinned**: the image only ever contains the exact tarball whose
  sha256 is in `ue4ss/ue4ss.lock`. No `latest`, no runtime downloads.
- **Trust-on-first-use is explicit**: `vendor.sh --pin` prints what you're
  trusting; the paranoid path is building the upstream source yourself and
  dropping the tarball into `ue4ss/vendor/` before pinning.
- **Mods are code too**: Lua mods run inside your server with UE4SS's
  privileges. Install mods from authors you trust, same as browser extensions.
- Opt out entirely: build with `UE4SS_OMIT=true` or set `MODS_ENABLED=false`.

## Backups

Backups contain world saves — player names, Steam IDs, base layouts. Treat
`./backups/` as private data: don't put it in public object storage
unencrypted, and remember `restore` will happily resurrect old player data
(GDPR-style deletion requests must include backups).

## The web panel

The panel authenticates with `ADMIN_PASSWORD` and keeps a signed, httpOnly
session cookie (30 days rolling, invalidated by sign-out). Login attempts are
rate-limited. Deliberate design constraints:

- **No docker.sock, anywhere.** The panel administers the game through its
  REST API over the compose network and through the shared data volume.
  Actions that need the game process down (restore, update) are written as
  request markers that the game container executes itself on its next start.
- **Plain HTTP.** There is no TLS termination built in — treat port 3000 like
  you treat SSH without a password: LAN or VPN only. If you must reach it
  remotely, tunnel (`ssh -L 3000:localhost:3000 host`) or put a TLS reverse
  proxy in front. Minimal Caddy example (automatic Let's Encrypt):

  ```
  panel.example.com {
      reverse_proxy localhost:3000
  }
  ```

  With any proxy, keep 3000 itself firewalled so the proxy is the only way
  in, and consider adding the proxy's own auth layer (e.g. basic auth or
  forward-auth) — the panel's login then becomes the second factor.
- The panel container runs unprivileged (your `PUID:PGID`) and can only see
  what the game container also sees.
- **Who can reach port 3000?** By default the panel listens on all host
  addresses, which means: everyone on your LAN — but from the internet only
  if your router forwards port 3000 to this machine (don't do that). Behind a
  normal home router with no such forwarding rule, the panel is not
  internet-reachable. **Self-check:** open `http://<your-public-ip>:3000` from
  a phone on mobile data (Wi-Fi off) — a timeout means you're fine. On a VPS
  or any host with a public IP there is no router shielding you: set
  `PANEL_BIND=127.0.0.1` in `.env` so the panel only listens locally, and use
  an SSH tunnel or TLS reverse proxy to reach it.
- **One outbound call**: the Connect card detects the server's public IP via
  `api.ipify.org` (cached 10 min). Disable with `PUBLIC_IP_LOOKUP=false`, or
  set `PUBLIC_IP` explicitly and no lookup ever happens.
- The console tab is a curated allowlist of the game's own REST commands —
  it is not a shell, and nothing it runs leaves the game's API surface.

## Remote access to the panel

Want to administer from outside your network? Three supported paths, easiest
and safest first:

1. **VPN (recommended)** — install [Tailscale](https://tailscale.com) (or
   WireGuard) on the server and your devices, then open
   `http://<server-vpn-ip>:3000` from anywhere. No ports opened, traffic
   encrypted, nothing public. This is the right choice for almost everyone.
2. **SSH tunnel** — `ssh -L 3000:localhost:3000 user@server`, then browse
   `http://localhost:3000`. Nothing stays exposed; ends with your session.
3. **TLS reverse proxy** — a domain plus Caddy or nginx proxy manager
   terminating HTTPS in front of the panel, with `PANEL_BIND=127.0.0.1` so
   the proxy is the only way in (with nginx proxy manager, attach the panel
   container to the proxy network and target `pal-up-panel:3000`). The
   panel's login is one password with rate limiting — no 2FA, no lockout —
   which is fine behind a VPN but thin as the only wall on the open
   internet, so give the proxy its own auth layer (basic auth or an access
   list) and let the panel login be the second factor.

Never simply port-forward 3000: that publishes an unencrypted admin login to
the internet.

## Reporting

To report a vulnerability, open a GitHub issue marked `[security]` without
exploit details and ask for a private channel.
