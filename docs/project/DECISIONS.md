# Decisions

One entry per non-obvious technical decision in this fork's deployment
setup. Newest at the top. Link back here from commit messages when a
decision changes.

## Single Docker image, three roles via Command override

`docker/Dockerfile` builds one image. EasyPanel's per-app "Command override"
field (Deploy tab) picks the role by passing an argument to
`docker/entrypoint.sh`: `web` (default, Apache), `cron` (supercronic),
`worker` (`messenger:consume` loop). All three read the same env vars.

**Why:** one image to build/version/redeploy instead of three, and the
apps only differ in what they run, not what they contain.

## `config/local.php` is regenerated from env vars on every boot

`docker/render-local-config.php` writes `config/local.php` fresh every time
a container starts, for all three roles. Nothing persists it across
restarts or between containers.

**Why:** EasyPanel/Docker is the source of truth for configuration (env
vars per app), not a file baked into an image or living on a volume. This
also means the Mautic admin UI's "Configuration" screens are **not** where
you change infrastructure-level settings (DB, mailer, site URL) — they get
overwritten on the next restart. Only settings genuinely meant to be
edited by admins through the UI (most of Configuration) are safe there.

## Mail/queue transports are env vars, not `local.php` params

`app/config/config.php` wires `framework.mailer`/`framework.messenger`
straight from `%env(...)%`: `MAUTIC_MAILER_DSN`, `MAUTIC_MESSENGER_DSN_EMAIL`,
`MAUTIC_MESSENGER_DSN_HIT`, `MAUTIC_MESSENGER_DSN_FAILED`. There is no code
path connecting the `mailer_dsn` parameter the admin UI's Email Settings
screen edits to these. Changing SMTP in the UI does nothing to real
delivery in this codebase.

**Why discovered:** the user had this exact problem on a previous Mautic
instance — configured SMTP in the panel, it silently didn't apply. Traced
it to `MailerDsnEnvVarProcessor` reading straight from the OS environment.

**How to apply:** always set `MAUTIC_MAILER_DSN` (and, if using async
queues, `MAUTIC_MESSENGER_DSN_EMAIL`/`_HIT`) as EasyPanel environment
variables on all three apps, never through the Mautic UI.

## `mautic:install`'s "already installed" check needed a workaround

`InstallService::checkIfInstalled()` only checks that `db_driver` and
`site_url` are non-empty in `config/local.php` — it never looks at the
actual database. Since `local.php` is regenerated with those fields on
every boot (see above), this check is always true, which would make
`mautic:install` silently no-op forever, even against a genuinely empty
database.

**Fix:** `docker/is-schema-installed.php` checks for a real table
(`plugins`) directly via PDO, independent of `local.php`. `entrypoint.sh`
uses that instead of trusting `mautic:install`'s own check, and passes
`--db_*` credentials as CLI options (not via `local.php`) so the install
can run even when `local.php` doesn't exist yet.

**Consequence to watch:** EasyPanel's "Tempo de inatividade zero"
(zero-downtime deploy) starts the new container before stopping the old
one. If you redeploy while a first-time install is still running, you get
**two containers racing to install against the same empty database**,
which corrupts the schema. Turn zero-downtime off before the very first
deploy against a fresh database; safe to turn back on once installed.

## `node_modules` must stay in the runtime image

Originally deleted after `composer install`/`npm run build` to shrink the
image (Dockerfile used to `rm -rf node_modules`). This broke the login
page in production: `Mautic\CoreBundle\Helper\AssetGenerationHelper`
rebuilds `media/js/libraries.js` / `media/css/libraries.css` from raw
source files under `node_modules/` **at runtime**, whenever it decides the
merged file is stale — and a freshly-written `config/local.php` on every
boot is enough to trigger that. Deleting `node_modules` after build made
every page needing those assets (login included) throw
`Twig\Error\RuntimeError: These files are missing: .../node_modules/...`.

**Fix:** `docker/Dockerfile` keeps root `node_modules`; only
`plugins/GrapesJsBuilderBundle/node_modules` (its own separate npm project,
build-tool-only) gets removed.

## `imap` PHP extension is not installed

Debian trixie (the base of `php:8.2-apache`'s current tag) dropped
`libc-client-dev`, which the `imap` extension needs to build — it's gone
from the apt repos entirely, not just renamed.

**Why it's fine:** `imap` is only used by Mautic's optional "monitored
mailbox" bounce-handling feature. This deployment uses the
`etailors/mautic-amazon-ses` plugin's SNS callback (`/mailer/callback`)
for bounce/complaint handling instead, which needs no IMAP mailbox at all.
`composer install` needs `--ignore-platform-req=ext-imap` since
`mautic/core-lib` still lists it as a soft requirement.

## `symfony/amazon-mailer` + `etailors/mautic-amazon-ses` moved to `require`

They were in `require-dev` with `symfony/amazon-mailer: ^8.1.5` — a
constraint that can **never** resolve here: v8.1.5 needs PHP >=8.4, and
this app is pinned to PHP 8.2 (`mautic/core-lib: ^7.0` needs it). They also
weren't in `composer.lock` at all (added to `composer.json` by hand,
`composer update` never run), so even in a dev install they'd have been
silently absent. Fixed by moving both to `require` and correcting the
constraint to `^7.4` (matching this app's actual Symfony 7.4 line), then
running a real `composer update` for just those two packages.

**Why require, not require-dev:** SES sending/bounce-handling is a
production concern, and this Dockerfile runs `composer install --no-dev`.

## Migrations metadata table needs an explicit sync after fresh install

`mautic:install`'s final step runs
`doctrine:migrations:version --add --all --no-interaction` to mark all
migrations as already-applied (since a fresh install creates the schema
directly, not migration-by-migration). On a truly empty database this
fails — the migrations metadata storage table doesn't exist yet — logged
as a `console.CRITICAL` but the overall install continues (non-fatal to
`mautic:install`, but leaves migration tracking broken for future
`mautic:update:apply` runs).

**Fix:** `entrypoint.sh` runs
`doctrine:migrations:sync-metadata-storage` immediately before the
`version --add --all` step, on first-time install only.

## MySQL 8.4+ / MariaDB 10.11+ is a hard requirement

Mautic 7's installer explicitly checks and refuses MySQL 8.0 ("too old").
Discovered by testing locally against `mysql:8.0` before switching to
`mysql:8.4`. Make sure any EasyPanel MySQL/MariaDB service is provisioned
at a compatible version *before* creating the Mautic apps.

## EasyPanel bind mounts need the host directory to exist first

EasyPanel runs Docker in Swarm mode. Unlike plain `docker run`, Swarm does
**not** auto-create a bind mount's source path — it fails deploy with
`invalid mount config for type "bind": bind source path does not exist`.

**Fix:** SSH into the EasyPanel host and `mkdir -p` the path once (e.g.
`/etc/easypanel/mautic-media-<slug>`) before configuring the bind mount in
each app (web/cron/worker all point at the same host path so they share
uploaded media/files).
