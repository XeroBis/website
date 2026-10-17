.PHONY: help up build down logs ps hooks lint test b-test f-test prod prod-down

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
