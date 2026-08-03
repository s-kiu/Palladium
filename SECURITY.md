# Security policy

## Reporting a vulnerability

Please do **not** open a public issue with exploit details. Instead:

1. Use GitHub's **private vulnerability reporting** on this repository
   (Security tab → Report a vulnerability), if enabled; or
2. open an issue titled `[security]` *without* details and ask for a private
   channel — you'll get one.

You can expect an acknowledgement within a few days. Please include the image
tags / commit you tested and enough detail to reproduce.

## Scope & threat model

The deployment model, port policy, UE4SS trust chain, panel session handling,
and the deliberate absence of docker.sock access are documented in
[docs/security.md](docs/security.md) — read that first; reports that assume a
different deployment (e.g. the panel exposed to the public internet) are still
welcome but will be triaged against the documented model.

Backups contain player data (names, Steam IDs). Treat `./backups/` as
sensitive when reporting anything involving it.
