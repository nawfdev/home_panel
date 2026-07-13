# Security Policy

## Supported Versions

Nestcore is developed on `main`; only the latest commit on `main` is supported. There are no maintained release branches.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead, use GitHub's private reporting flow:

1. Go to the [Security tab](https://github.com/nawfdev/home_panel/security) of this repo.
2. Click **Report a vulnerability**.
3. Describe the issue, affected component (backend/frontend), and steps to reproduce if possible.

You should get an initial response within a few days. Confirmed vulnerabilities will be fixed and disclosed via a security advisory once a patch is available.

## Scope notes

Nestcore is a self-hosted homelab admin panel with broad system access by design (file manager, terminal, service control). It is **not** intended to be exposed directly to the public internet without a reverse proxy, authentication, and network-level restrictions (e.g. a VPN or Cloudflare Tunnel with access policies). Reports about the panel behaving as documented when exposed without these protections are expected behavior, not vulnerabilities — but reports about auth bypass, path traversal, injection, or privilege escalation *within* the intended threat model are very welcome.
