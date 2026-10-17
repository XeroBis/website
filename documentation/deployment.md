# Deployment

> Not deployed yet. The old repos still serve production until cutover
> (`migration-plan.md` step 7). This is the target runbook.

## Stack

`docker-compose.prod.yml` on the VPS: `db` (Postgres 18), `backend`, `edge` (nginx with every app's bundle built in). Only `edge` publishes 80/443.

```bash
cp .env.template .env      # POSTGRES_PASSWORD=$(openssl rand -hex 24); chmod 600 .env
make prod                  # docker compose -f docker-compose.prod.yml up --build -d
```

Migrations run automatically (`alembic upgrade head`) on backend start.

## TLS certificate

One multi-SAN Let's Encrypt cert for every host. The old box's cert (`--cert-name multi-alanbignon`) lacks `workout.alanbignon.com` (and `media.` must be checked), so expand it once DNS for the new names points at the box:

```bash
sudo certbot certonly --webroot -w ~/website/infra/certbot-webroot \
  --cert-name multi-alanbignon --expand \
  -d alanbignon.com -d www.alanbignon.com -d alanbignon.fr -d www.alanbignon.fr \
  -d auth.alanbignon.com -d cards.alanbignon.com -d media.alanbignon.com \
  -d workout.alanbignon.com
```

Copy it (with `-L`, certbot's `live/` entries are symlinks) to the single path the edge reads:

```bash
sudo cp -L /etc/letsencrypt/live/multi-alanbignon/fullchain.pem infra/ssl/alanbignon.com/fullchain.pem
sudo cp -L /etc/letsencrypt/live/multi-alanbignon/privkey.pem  infra/ssl/alanbignon.com/privkey.pem
```

The certbot deploy hook (`/etc/letsencrypt/renewal-hooks/deploy/`) must do the same copy, then `docker compose -f docker-compose.prod.yml exec edge nginx -s reload`. Certs are bind-mounted as a directory and replaced in place, so a reload is enough. That differs from config: `nginx.conf` is baked into the image, so config changes need `make prod` (rebuild).

## Cutover (step 7)

1. Expand the cert (above). It's the same box, so old and new can't both hold 80/443.
2. Stop the old stacks (`vps-edge` last).
3. `make prod` here.
4. Re-create accounts, then re-import workout and cards data through their import features.
