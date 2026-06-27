# Security

noledge is built to run **self-hosted, single-user, on localhost**. In that
default mode it has no authentication — anyone who can reach the port can use it.
That is fine on a trusted machine and risky anywhere else. This document
describes the controls available when you want to run it less privately, and the
hardening applied to the codebase.

## Deployment modes

### Localhost only (default)

No configuration needed. Bind to `127.0.0.1` and do not expose the port. Secrets
are stored in the local SQLite DB (file permissions are tightened to owner-only
on a best-effort basis).

### Exposed (LAN, server, or tunnel)

Set these before exposing the app:

| Variable | Purpose |
| --- | --- |
| `NOLEDGE_PASSWORD` | Turns on the auth gate. Every page and API route then requires a signed session cookie; unauthenticated requests are redirected to `/login` (pages) or get a `401` (API). |
| `NOLEDGE_SECRET` | Long random value (`openssl rand -hex 32`). Encrypts provider keys + OAuth tokens at rest **and** signs session cookies. Strongly recommended whenever the app is exposed. |
| `NOLEDGE_COOKIE_SECURE=true` | Marks the session cookie `Secure`. Set this **only** when serving over HTTPS, otherwise the cookie won't be sent over plain HTTP. |

See `.env.example` for the full list.

## Hardening in the codebase

- **SSRF egress guard** (`src/lib/ai/net/ssrf.ts`). Server-side fetches of
  user-supplied URLs (RSS feeds, article pages, paper APIs) now reject
  loopback / private / link-local / reserved addresses (IPv4 + IPv6), including
  the `169.254.169.254` cloud-metadata endpoint, and re-validate every redirect
  hop. (Full DNS-rebinding defense — pinning the resolved IP for the actual
  socket — is not implemented; it is a disproportionate cost for this app.)
- **Secrets encrypted at rest** (`src/lib/ai/crypto/secrets.ts`). With
  `NOLEDGE_SECRET` set, provider API keys, OAuth access/refresh tokens, and the
  rerank API key are stored AES-256-GCM encrypted. Without it, behavior is
  unchanged (plaintext, as before), so upgrades don't break existing databases.
- **No remote package installs.** The YouTube transcript path no longer
  auto-installs `yt-dlp` via `pip3`/`brew` on demand; install it yourself if you
  want the fallback.
- **Dependencies.** `undici` is pinned to a patched release (>= 8.5.0) to clear
  the SOCKS5 ProxyAgent TLS-bypass advisory (the transcript proxy path uses
  `undici`'s `ProxyAgent`).

## Reporting

This is a personal fork. Open an issue on the upstream project for
vulnerabilities affecting the original.
