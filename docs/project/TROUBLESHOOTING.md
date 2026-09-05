# Troubleshooting log

Real incidents hit while building and deploying this fork, in the order
they happened. Each one names the symptom first so it's greppable. See
`docs/project/DECISIONS.md` for the reasoning behind each fix.

## "Site fica carregando e dá timeout" / container "Running" but nothing responds

**Cause seen so far:** not this specific one — see the two below, which
both presented this way at different points. If neither matches: check
whether the EasyPanel domain's target port is `80` (Domains tab), and
whether `MAUTIC_DB_HOST` really matches the MySQL service's name inside
the same EasyPanel project.

**How to check when the panel's own Logs/Terminal websocket is stuck on
"Connecting to websocket..."**: that's a UI/browser-side symptom, not proof
the container is down. Hard-refresh the page and retry, or check the
app's CPU/status indicator at the top of the page instead — if it says
"Running", the container itself is up even if the log viewer can't
connect. As a last resort, test the public URL directly with `curl` from
outside (bypasses the panel entirely):
```bash
curl -sI --max-time 20 https://your-app.easypanel.host/
```

## Two containers installing at once corrupted the schema

**Symptom:** deploy logs show `No Mautic schema found, running first-time
install...` **twice**, each with its own full `Install complete`. Login
page (`/s/login`) returns HTTP 500, later degrades to a full hang (no
response at all, `curl` times out with `STATUS=000`). Host CPU spikes.

**Root cause:** EasyPanel's "Tempo de inatividade zero" (zero-downtime
deploy, Deploy tab) keeps the old container running until the new one is
healthy. Redeploying (e.g. clicking Implantar again while debugging) during
a first-time install starts a second container that *also* sees an empty
database and races the first one's schema creation.

**Fix:** wipe the database (phpMyAdmin → drop all tables in `mautic`),
turn "Tempo de inatividade zero" off, deploy exactly once, wait for it to
finish before touching anything else. See `docs/project/DECISIONS.md` →
"`mautic:install`'s already-installed check needed a workaround".

## Login page 500: `Twig\Error\RuntimeError: ... These files are missing: .../node_modules/...`

**Symptom:** `/s/login` returns HTTP 500 (consistently ~1597 bytes) even
on a clean, single install. `var/logs/mautic_prod-*.log` shows a Twig
`RuntimeError` from `@MauticUser/Security/base.html.twig`, listing dozens
of missing `node_modules/...` paths (jquery, moment, chosen-js, etc.), and
a follow-up `str_starts_with(): Argument #1 ($haystack) must be of type
string, array given` in `head.html.twig` (a secondary failure while
rendering the *error page itself*).

**Root cause:** `docker/Dockerfile` used to `rm -rf node_modules` after
the build to shrink the image. `AssetGenerationHelper` regenerates
`media/js/libraries.js`/`libraries.css` from raw `node_modules` source
files at runtime when it thinks they're stale — and a fresh
`config/local.php` on every boot is enough to trigger that check.

**Fix:** keep root `node_modules` in the final image (fixed in commit
`efc254e05e`). Only `plugins/GrapesJsBuilderBundle/node_modules` (a
separate, build-only npm project) gets removed.

**How to diagnose this class of bug in general:** the HTTP response body
under `APP_DEBUG=0` only shows Mautic's generic "site is currently
offline" page — the real exception is in
`var/logs/mautic_prod-<date>.log` inside the container. Get a shell (Terminal
tab in EasyPanel, or a fresh page reload if it's stuck on "Connecting to
websocket...") and `cat var/logs/mautic_prod*.log`.

## `doctrine:migrations:version --add --all` fails during install

**Symptom:** `var/logs/mautic_prod-*.log` shows
`Doctrine\Migrations\Exception\MetadataStorageError: The metadata storage
is not initialized...` right after `mautic:install`'s "Install complete"
line. Non-fatal to the install itself, but leaves migration tracking
broken.

**Fix:** `entrypoint.sh` now runs
`doctrine:migrations:sync-metadata-storage` before that step (commit
`efc254e05e`).

## `composer install` fails: `Unable to locate package libc-client-dev`

**Symptom:** Docker build fails during `apt-get install` for the `imap`
PHP extension's build dependency.

**Root cause:** Debian trixie (current `php:8.2-apache` base) removed
`libc-client-dev` from its repos entirely.

**Fix:** don't build the `imap` extension at all; add
`--ignore-platform-req=ext-imap` to `composer install` (it's a soft
requirement in `mautic/core-lib`, only needed for the monitored-mailbox
bounce feature this deployment doesn't use).

## `mautic:assets:generate` dies with `Allowed memory size of 134217728 bytes exhausted`

**Symptom:** Docker build fails during the `composer install` step, in the
`generate-assets` post-install script, dumping the compiled Symfony
container.

**Root cause:** PHP CLI's default 128M `memory_limit` isn't enough, and
`docker/php.ini` (which sets 512M) was only `COPY`'d into the image
*after* the `composer install` layer, so it wasn't in effect yet.

**Fix:** `COPY docker/php.ini` moved to before `composer install` in the
Dockerfile.

## `mautic:assets:generate` dies with a MySQL connection error during build

**Symptom:** `SQLSTATE[HY000] [2002] Connection refused` while running
`bin/console mautic:assets:generate` inside the Docker build (no database
exists at build time on purpose).

**Root cause:** a placeholder `config/local.php` was being written before
`composer install` (to let the kernel boot). Its mere existence made
`AppKernel` skip the "not installed yet" fallback that hardcodes a DB
`server_version` constant, so Doctrine tried to live-detect the DB
version and failed.

**Fix:** don't write any `config/local.php` during the build at all.
`AppKernel` already treats a missing `local.php` as pre-install and avoids
the live connection.

## `supercronic: command not found` in the `cron` role

**Symptom:** `cron` container logs `bash: line 1: supercronic: command not
found` and exits immediately.

**Root cause:** the install script URL used in the Dockerfile
(`raw.githubusercontent.com/aptible/supercronic/master/install.sh`)
doesn't exist. `curl -fsSL ... | bash -s --` silently did nothing (curl's
failure wasn't propagated through the pipe), so the build "succeeded"
without ever installing the binary.

**Fix:** download the actual release binary directly from GitHub releases,
picking the right architecture via `dpkg --print-architecture`, with a
`test -x` sanity check in the same `RUN` step so a bad download fails the
build loudly instead of shipping a broken image.

## MySQL 8.0 rejected: "Your database version (8.0.46) is too old"

**Symptom:** `mautic:install` fails during the requirements check.

**Fix:** use MySQL 8.4+ or MariaDB 10.11+. See
`docs/project/DECISIONS.md`.

## EasyPanel bind mount: `invalid mount config for type "bind": bind source path does not exist`

**Fix:** SSH into the EasyPanel host, `mkdir -p` the path once. See
`docs/project/DECISIONS.md`.

## SSH "REMOTE HOST IDENTIFICATION HAS CHANGED" warning

**Context:** hit when SSHing into the EasyPanel VPS after reformatting it.
This is a real security check, not boilerplate — **verify the reformat was
actually done by you/your team through an out-of-band channel (hosting
provider's own panel) before trusting the new key.** Once confirmed:
`ssh-keygen -R <ip>`, then reconnect and confirm the fingerprint shown
matches what the hosting provider/your own records say, before typing
`yes`.
