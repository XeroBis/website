

.DEFAULT_GOAL := help

help:
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@echo '  - format'
	@echo '  - lint'
	@echo '  - checks'
	@echo '  - build'
	@echo '  - up'
	@echo '  - down'
	@echo '  - down-v'
	@echo '  - prod-build'
	@echo '  - prod-up'
	@echo '  - prod-down'
	@echo '  - makemigrations'
	@echo '  - static'
	@echo '  - makemessages'
	@echo '  - comp'


format:
	uv run black .
	uv run isort .

lint:
	uv run flake8 apps/ mysite/

checks:
	uv run pre-commit run --all-files

build:
	docker compose up --build -d

up:
	docker compose up -d

down:
	docker compose -f docker-compose.yml down

down-v:
	docker compose -f docker-compose.yml down -v

prod-build:
	docker compose -f docker-compose.prod.yml up --build -d

prod-up:
	docker compose -f docker-compose.prod.yml up -d

prod-down:
	docker compose -f docker-compose.prod.yml down

makemigrations:
	uv run python manage.py makemigrations

static:
	uv run python manage.py collectstatic --noinput

mess:
	uv run python manage.py makemessages -l en
	uv run python manage.py makemessages -l fr

comp:
	uv run python manage.py compilemessages -l en -l fr --ignore=.venv
