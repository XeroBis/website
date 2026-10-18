.PHONY: help up build down logs ps seed-user seed-basic-user media-refresh hooks lint test b-test f-test prod prod-down prod-seed-user prod-media-refresh

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

# ── dev (docker-compose.yml) ─────────────────────────────────────────────────
# APPS="cards auth" limits which Angular dev servers start (default: all five).

up: ## Start the dev stack
	$(if $(APPS),APPS="$(APPS)" )docker compose up -d

build: ## Rebuild and start the dev stack
	$(if $(APPS),APPS="$(APPS)" )docker compose up --build -d

down: ## Stop the dev stack
	docker compose down

logs: ## Tail dev logs
	docker compose logs -f

ps: ## Show dev containers
	docker compose ps

# Admin account from ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_PSEUDO (dev defaults in
# docker-compose.yml, overridable), e.g.:
#   make seed-user ADMIN_EMAIL=me@example.com ADMIN_PASSWORD=change-me-please
seed-user: ## Create or update the dev admin account
	docker compose exec $(foreach v,ADMIN_EMAIL ADMIN_PASSWORD ADMIN_PSEUDO,$(if $($(v)),-e $(v)="$($(v))" )) backend /opt/venv/bin/python -m domains.auth.seed

# Same, without making the account admin (an existing admin stays admin). Also
# resets a password. EMAIL and PASSWORD are required, e.g.:
#   make seed-basic-user EMAIL=friend@example.com PASSWORD=change-me-please PSEUDO=Friend
seed-basic-user: ## Create or update a dev non-admin account (or reset its password)
	@test -n "$(EMAIL)" -a -n "$(PASSWORD)" || { echo "EMAIL and PASSWORD are required"; exit 1; }
	docker compose exec -e ADMIN_EMAIL="$(EMAIL)" -e ADMIN_PASSWORD="$(PASSWORD)" -e ADMIN_PSEUDO="$(or $(PSEUDO),User)" backend /opt/venv/bin/python -m domains.auth.seed --no-admin

media-refresh: ## Re-fetch every TMDB / Open Library catalog row (dev)
	docker compose exec backend /opt/venv/bin/python -m domains.media.refresh

# ── quality ──────────────────────────────────────────────────────────────────

hooks: ## Enable the git pre-commit hook (ruff + black on staged backend files)
	git config core.hooksPath .githooks

lint: ## ruff --fix + black on the backend
	cd backend && uv run ruff check --fix . && uv run black .

b-test: ## Backend pytest (needs the dev db on :5440)
	cd backend && uv run pytest

f-test: ## Frontend unit tests, every project (in a throwaway frontend container)
	docker compose run --rm --no-deps frontend npm test

test: b-test f-test ## Backend + frontend tests

# ── prod (docker-compose.prod.yml, on the VPS) ───────────────────────────────

prod: ## Build and start the prod stack
	docker compose -f docker-compose.prod.yml up --build -d

prod-down: ## Stop the prod stack
	docker compose -f docker-compose.prod.yml down

prod-seed-user: ## Create or update the prod admin: make prod-seed-user ADMIN_EMAIL=… ADMIN_PASSWORD=…
	@test -n "$(ADMIN_EMAIL)" -a -n "$(ADMIN_PASSWORD)" || { echo "ADMIN_EMAIL and ADMIN_PASSWORD are required"; exit 1; }
	docker compose -f docker-compose.prod.yml exec -e ADMIN_EMAIL="$(ADMIN_EMAIL)" -e ADMIN_PASSWORD="$(ADMIN_PASSWORD)" $(if $(ADMIN_PSEUDO),-e ADMIN_PSEUDO="$(ADMIN_PSEUDO)" )backend /opt/venv/bin/python -m domains.auth.seed

prod-media-refresh: ## Re-fetch every TMDB / Open Library catalog row (prod)
	docker compose -f docker-compose.prod.yml exec backend /opt/venv/bin/python -m domains.media.refresh
