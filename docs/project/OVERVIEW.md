# Project Overview

This is the **impulsionantedigital/mautic** fork (branch `7.x`), running on
**EasyPanel** (self-hosted Docker/Swarm PaaS) as three containers built from
one image: `docker/Dockerfile`.

This file is the always-loaded entry point for AI agents (see `CLAUDE.md`).
It's meant to be short. For depth, follow the links below instead of
duplicating detail here.

- **`docs/project/DEPLOYMENT.md`** — step-by-step EasyPanel setup, env vars, first deploy.
- **`docs/project/DECISIONS.md`** — why things are built the way they are, one entry per decision.
- **`docs/project/TROUBLESHOOTING.md`** — every real incident hit in production so far, with root cause and fix.
- **`docs/specs/`** — specs for features/changes being planned. One file per initiative.
- **`docs/brainstorm/`** — freeform exploration notes, not yet a spec.
- **`AGENTS.md`** — upstream Mautic's own contributor guide (ddev, tests, coding standards). Keep this aligned with upstream; put fork-specific stuff here in `docs/` instead.

## What this fork adds on top of stock Mautic 7

1. **`docker/` deployment**: a single `php:8.2-apache` image that runs as
   `web` (Apache), `cron` (supercronic), or `worker` (`messenger:consume`)
   depending on EasyPanel's "Command override" field. See
   `docs/project/DECISIONS.md` for why each role works the way it does.
2. **Amazon SES plugin enabled for production**: `etailors/mautic-amazon-ses`
   + `symfony/amazon-mailer` moved from `require-dev` to `require` in
   `composer.json` (they were unreachable in a `--no-dev` prod install and
   weren't even in `composer.lock`). Mail transport and messenger queues are
   controlled purely by environment variables (`MAUTIC_MAILER_DSN`,
   `MAUTIC_MESSENGER_DSN_EMAIL`, `MAUTIC_MESSENGER_DSN_HIT`,
   `MAUTIC_MESSENGER_DSN_FAILED`), **not** by Mautic's admin UI — that UI
   field writes to a `local.php` parameter nothing in this codebase reads
   for actual sending.

## Platform requirements (non-negotiable)

- MySQL **8.4.0+** or MariaDB **10.11.0+** — 8.0 is rejected by the installer.
- PHP 8.2 (pinned by `mautic/core-lib`).

## Current state (update this as things change)

- Live and working at `https://mautic.trilhasdearuanda.com.br/` as of
  2026-09-05, after a server reformat + clean redeploy. Custom domain DNS
  and the media bind-mount split (see Decisions/Troubleshooting) were the
  last two blockers, both resolved.
- `cron` and `worker` apps have **not been created yet** in EasyPanel — only
  `web` exists so far. Follow `docs/project/DEPLOYMENT.md` steps 3-4 to add them.
- No Docker `HEALTHCHECK` yet — zero-downtime redeploys can have a brief
  window where the domain shows "Service is not reachable" between the
  old container stopping and the new one finishing boot. See
  `docs/project/TROUBLESHOOTING.md`.
- Async messenger transports (`MAUTIC_MESSENGER_DSN_EMAIL`/`_HIT`) are left at
  the default `sync://` — the `worker` app (once created) will sit mostly
  idle until/unless these are pointed at `doctrine://default?queue_name=...`.
