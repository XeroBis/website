# Deployment

## Stack

`docker-compose.prod.yml` on the VPS, cloned at `~/website`: `db` (Postgres 18), `backend`, `edge` (nginx with every app's bundle built in). Only `edge` publishes 80/443.

```bash
cp .env.template .env      # fill in, then chmod 600 .env:
                           #   POSTGRES_PASSWORD=$(openssl rand -hex 24)
                           #   SECRET_KEY=$(openssl rand -hex 32)
                           #   REGISTER_SECRET=$(openssl rand -hex 16)
                           #   TMDB_READ_ACCESS_TOKEN=… (themoviedb.org/settings/api, "API Read Access Token")
make prod                  # docker compose -f docker-compose.prod.yml up --build -d
make prod-seed-user ADMIN_EMAIL=… ADMIN_PASSWORD=… [ADMIN_PSEUDO=…]   # admin account
```

Volumes: `pgdata` (the database) and `cards_data` (cards' downloaded images, ~2 GB, not in the database and not in the backups: keep the catalog image export zip as its copy, or rebuild it with the refresh steps). Cards' **Import images** (Catalog Management) uploads the ~2 GB zip into `cards_data` before restoring it, so that volume's disk needs about twice the archive's size free during an import; the edge accepts up to 4 GB on that one route (`snippets/app.conf`).

Migrations run automatically (`alembic upgrade head`) on backend start. The backend refuses to start if `SECRET_KEY` (≥ 32 chars) or `REGISTER_SECRET` (≥ 16 chars) is missing or too short. Changing `SECRET_KEY` logs everyone out. Without `TMDB_READ_ACCESS_TOKEN` the backend still starts, but media's film and series search answers 502 (books use Open Library, no key).

`make prod-media-refresh` re-fetches every TMDB / Open Library catalog row (e.g. after a column is added); covers are kept. Other accounts sign up at `auth.alanbignon.com/signup` with `REGISTER_SECRET` as the sign-up code; an admin then ticks their apps on `/admin/users`.

Building the image compiles the five Angular apps on the VPS. Check `free -h` before the first build; if it runs out of memory, add swap (or move the build to CI, see ideas.md).

## CI and deploy

`.github/workflows/ci.yml`, on every push and PR: `lint` (ruff + `black --check`), `backend` (pytest against a `postgres:18` service on port 5440, like the dev `db`) and `frontend` (`npm test`, every project, Node 24). On a push to `main`, `deploy` runs once all three pass: over SSH, `cd website && git pull --ff-only origin main && make prod`, then `docker image prune -f` to drop the previous build's images. Deploys never overlap.

GitHub repository secrets (Settings → Secrets and variables → Actions):
- `VPS_HOST`: the box's IP or hostname.
- `VPS_USER`: the account that owns `~/website` and can run `docker` without `sudo`.
- `VPS_SSH_KEY`: a private key (ed25519) whose public key is in that account's `~/.ssh/authorized_keys`.

The VPS clone must be able to `git pull` without a prompt (public repo over HTTPS, or a read-only deploy key).

## TLS certificate

One multi-SAN Let's Encrypt cert (`--cert-name multi-alanbignon`) for every host. Certbot validates through the edge's webroot, `~/website/infra/certbot-webroot`. To add a host, point its DNS at the box, then re-issue with every name:

```bash
sudo certbot certonly --webroot -w ~/website/infra/certbot-webroot \
  --cert-name multi-alanbignon --expand \
  -d alanbignon.com -d www.alanbignon.com -d alanbignon.fr -d www.alanbignon.fr \
  -d auth.alanbignon.com -d cards.alanbignon.com -d media.alanbignon.com \
  -d workout.alanbignon.com
```

(`--expand` re-issues the cert with the listed names: list every name, or certbot drops the ones left out.)

`infra/certbot/deploy-hook.sh` copies the cert (with `cp -L`, certbot's `live/` entries are symlinks) to the single path the edge reads, `infra/ssl/alanbignon.com/`, and reloads the edge if it's running. Run it by hand once, then install it as a symlink, so renewals keep running the repo's version:

```bash
sudo ~/website/infra/certbot/deploy-hook.sh
sudo ln -s ~/website/infra/certbot/deploy-hook.sh /etc/letsencrypt/renewal-hooks/deploy/website.sh
sudo certbot renew --dry-run
```

The certs are bind-mounted as a directory and replaced in place, so a reload is enough. That differs from config: `nginx.conf` is baked into the image, so config changes need `make prod` (rebuild).

## Backups

`infra/backups/backup.sh` dumps the whole `website` database (`pg_dump -Fc`, compressed) to `infra/backups/dumps/website-YYYYMMDD.dump` (gitignored), keeps the newest 7 and emails the new one through `msmtp`: attached when under 20 MB, otherwise the email gives its path and size. `make prod-backup` runs it without the email.

`infra/backups/restore.sh {all|portfolio|workout|cards|media} [dump]` (or `make prod-restore SCHEMA=… [DUMP=…]`) restores from a dump, the newest one by default. It asks you to type the target, stops the backend and starts it again afterwards.
- `all`: drops and recreates the database, then loads the whole dump (users and `alembic_version` included).
- one app schema: drops and reloads only that schema, in one transaction (a failure leaves it as it was). Users stay as they are now, so it fails if the dump has rows of a since-deleted user. `core` alone isn't offered: every app schema has FKs into `core.users`; use `all`.

One-time setup on the box:
1. `sudo apt-get install -y msmtp msmtp-mta`.
2. A Gmail app password for `alanbignon2@gmail.com` (Google Account → Security → 2-Step Verification → App passwords) in `/etc/msmtprc`, from `infra/backups/msmtprc.template`, readable by the account whose crontab runs the backup and nobody else (`chmod 600`).
3. Run `infra/backups/backup.sh` once by hand; check the dump and the email.
4. Host crontab (`crontab -e`), Sunday 3am:
   ```
   0 3 * * 0 /home/<user>/website/infra/backups/backup.sh >> /home/<user>/website/infra/backups/backup.log 2>&1
   ```

To try the scripts against the dev stack: `COMPOSE_FILE=docker-compose.yml NO_EMAIL=1 infra/backups/backup.sh`, and the same `COMPOSE_FILE` for `restore.sh` (it replaces the dev data).
