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

## Login hangs forever after a clean, single install

**Symptom:** `mautic:install` ran once, cleanly, no errors in
`var/logs/`. Apache starts fine. `GET /` and `GET /s/dashboard` return
302 as expected, but the browser never gets a response for `/s/login` —
just spins.

**Root cause:** the app's Storage was configured with a single Bind mount
covering the whole `/var/www/html/media` directory. That hides the
build-time-generated `media/js/libraries.js`/`media/css/libraries.css`/
`media/css/offline.css` behind an empty host directory, so Mautic tries
(and struggles) to regenerate them from `node_modules` on every request
that needs them — including the login page.

**Fix:** split the mount into three, one each for `media/files`,
`media/images`, `media/assets`. See `docs/project/DEPLOYMENT.md` step 2
and `docs/project/DECISIONS.md`.

## "Service is not reachable" / "404 Not Found" right after a redeploy

Two different EasyPanel/Traefik-level pages (not Mautic errors) seen
during this fork's deploys:

- **"Service is not reachable, make sure the service is running and
  healthy"**: hit during a zero-downtime redeploy's handover window — the
  old container had already been stopped but the new one hadn't finished
  its ~30-60s boot sequence (schema check, plugin reload, cache warmup)
  and started Apache yet. There's no Docker `HEALTHCHECK` on this image
  yet, so Swarm/Traefik has no reliable signal for "actually ready to
  serve HTTP" beyond "process started". Just wait and retry; a proper
  `HEALTHCHECK` in the Dockerfile would close this gap (not implemented
  yet — candidate for `docs/specs/`).
- **"404 Not Found, make sure you have the correct URL and that you have
  configured your domain correctly"**: this is Traefik saying it has no
  route for the exact host+path requested. Seen after switching from the
  auto-generated `*.easypanel.host` domain to a custom domain — the old
  `*.easypanel.host` URL (e.g. bookmarked, or from an old redirect) no
  longer has a route once it's not the app's registered domain anymore.
  Not a bug; just don't use stale domain URLs after changing a domain.

## Custom domain shows the wrong thing / doesn't resolve to this deployment

**Symptom:** the app's own `*.easypanel.host` URL works, but the intended
custom domain (e.g. `mautic.yourdomain.com.br`) gives an unrelated error —
because it's not even reaching this server.

**Root cause seen:** DNS for the custom domain was pointed at a
*different* server's IP than the one this app is deployed on (a stale
CNAME to another EasyPanel install, `168.231.90.62`, while this app lived
on `167.88.33.210`).

**How to check:**
```bash
dig +short mautic.yourdomain.com.br A
```
Compare against the actual IP of the EasyPanel server you deployed to
(the one you SSH into). If they don't match, fix the DNS record (A or
CNAME) at the domain's DNS provider — nothing on the EasyPanel/Mautic side
can fix a wrong DNS target.

## New domain deployed from this same stack: test email doesn't arrive, another domain does

**Context:** this Docker setup is reused as a template for multiple
separate Mautic instances (different domain, DB, and `MAUTIC_SITE_URL`
per client - e.g. `trilhasdearuanda.com.br`, `gpsdapena.com.br` - but the
same shared AWS SES SMTP user/password across all of them).

**Symptom:** test email works fine on one domain but not another, even
though the app config (DSN, credentials) is otherwise identical between
them.

**Root cause:** AWS SES only delivers mail from a **verified**
sender identity - verification is per domain (or per individual email
address), not account-wide. A shared SES SMTP user doesn't imply every
`MAUTIC_MAILER_FROM_EMAIL` domain sending through it is verified.

**Fix:** in AWS SES Console → Verified identities, confirm the new
domain (or the specific `MAUTIC_MAILER_FROM_EMAIL` address) is verified
(DKIM/SPF DNS records for domain verification is the recommended route).
Also check the SES account isn't still in sandbox mode. If unsure whether
this is really the cause, check `var/logs/mautic_prod*.log` in the
affected app's `web` container for the SMTP rejection reason (e.g. "Email
address is not verified", "554 Message rejected").

**Takeaway for every new client domain deployed on this stack:** verify
the sending domain in SES *before* wiring up `MAUTIC_MAILER_DSN` /
`MAUTIC_MAILER_FROM_EMAIL` for it, to skip this failure mode entirely.

## OPEN: email stopped arriving after enabling async messenger

**Status: not diagnosed. Currently mitigated by staying in sync mode.**

**Symptom:** after setting `MAUTIC_MESSENGER_DSN_EMAIL`/`_HIT` to
`doctrine://default?queue_name=...` on all three apps, `worker` logs
correctly showed `Consuming messages from transports "email, hit,
failed"`, but test emails (`mailer:test` and a real send from the UI)
stopped being delivered. Reverting both env vars back to `sync://`
(unset/removed) fixed delivery immediately.

**Not yet checked, worth trying first when revisiting this:**
- `worker` container logs *at the exact moment* of a test send — did it
  actually pick up a message from the `email` transport, and if so, did
  it log a delivery success or an exception?
- The `messenger_messages` table directly (`SELECT * FROM
  messenger_messages` in phpMyAdmin/DbGate) — is it accumulating
  unconsumed rows (worker not polling/crashing) or rows stuck with
  `delivered_at IS NULL` and growing `attempts` (worker picking them up
  but failing to send, e.g. hitting the SES rate limit or a DSN quirk
  under the `doctrine://` wrapping)?
- Whether `mailer:test`'s `SendEmailMessage` really routes through the
  `email` transport as expected (it does per `app/config/config.php`) and
  whether that matters differently than a real campaign send.
- Retry/backoff settings — `RetryStrategy` (see
  `app/bundles/MessengerBundle/Retry/RetryStrategy.php`) applies to the
  `email`/`hit` transports; a message could be silently retrying instead
  of failing loud.

## `cron` app: `/bin/sh: 1: cron: not found`

**Symptom:** the `cron` app's "Comando" (Command override) field was set
to the bare word `cron` (per the original deploy guide), and the
container logs `/bin/sh: 1: cron: not found`, repeated a few times, then
gives up.

**Root cause:** EasyPanel's "Comando" field replaces the container's
command outright rather than just supplying an argument to the image's
`ENTRYPOINT` — so `cron` was executed as a literal binary name (there is
none; this image uses `supercronic`, not the system `cron` daemon), not
as `entrypoint.sh`'s `$1` role argument as intended.

**Fix:** put the full invocation in "Comando" instead of a bare role name:
```
/usr/local/bin/entrypoint.sh cron
```
(and `/usr/local/bin/entrypoint.sh worker` for the worker app). Updated
in `docs/project/DEPLOYMENT.md`.

## `mautic:campaigns:resume-stuck` fails every 5 minutes: "Not enough arguments (missing: campaign-id)"

**Symptom:** `cron` app logs `error running command: exit status 1` for
`mautic:campaigns:resume-stuck` on every run.

**Root cause:** this command isn't a maintenance sweep — it requires a
specific `<campaign-id>` argument and has no "check all campaigns" mode
(see `app/bundles/CampaignBundle/Command/ResumeStuckCampaignCommand.php`).
It was mistakenly added to `docker/crontab` as if it were a general
housekeeping command.

**Fix:** removed from `docker/crontab`. Run it manually, per-campaign,
when an admin identifies a specific stuck campaign:
```
php bin/console mautic:campaigns:resume-stuck <campaign-id> --dry-run
```

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

## Changing Configuration > Miscellaneous language (e.g. to pt_BR) throws a 500

**Symptom:** Configuration → Miscellaneous → pick a non-`en_US` language →
Save → generic "Uh oh! I think I broke it" 500 page.

**Root cause:** `en_US` is the only language bundled in the image
(`app/bundles/*/Translations/en_US`). Any other language is downloaded
and extracted on-demand at runtime by
`Mautic\CoreBundle\Helper\LanguageHelper`/`Language\Installer`, which
writes to `<root>/translations/<locale>/...`. `docker/Dockerfile`'s
runtime-writable-paths step only `chown`'d `var/`, `media/`, and `config/`
to `www-data` — `translations/` stayed root-owned from the build's
`COPY . .`, so `www-data` (Apache) couldn't create the directory and the
uncaught filesystem exception surfaced as a 500.

**Fix:** added `translations` to both the `mkdir -p` and
`chown`/`chmod ug+rwX` lists in `docker/Dockerfile`'s "Runtime writable
paths" step, same pattern as `var`/`media`/`config`. Requires a rebuild +
redeploy of the image to take effect (a chown fix in the Dockerfile
doesn't retroactively fix a running container's filesystem).
