# alanbignon.com

Monorepo for every site on `alanbignon.com`: portfolio, workout, cards, media and auth.
One FastAPI backend, one Angular workspace, one Postgres, one edge nginx.

```bash
make build                    # dev stack: db 5440, backend 8400, apps 4600-4604
make up APPS="cards auth"     # only some Angular dev servers (~1 GB RAM each)
make seed-user                # dev admin: admin@example.com / admin-password
make test                     # backend + frontend tests
make hooks                    # enable the ruff/black pre-commit hook
```

| App | Dev URL | Prod URL |
|---|---|---|
| portfolio | http://localhost:4600 | https://alanbignon.com |
| workout | http://localhost:4601 | https://workout.alanbignon.com |
| cards | http://localhost:4602 | https://cards.alanbignon.com |
| media | http://localhost:4603 | https://media.alanbignon.com |
| auth | http://localhost:4604 | https://auth.alanbignon.com |

See `documentation/`, starting with `architecture.md`.
