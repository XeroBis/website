# Documentation

`documentation/` is the source of truth for this monorepo. Keep it in sync with
every change (see `../CLAUDE.md` "Documentation Rule").

| File | What it records |
|---|---|
| `architecture.md` | Folder structure, environments, ports, request flow |
| `data-model.md` | DB schemas, tables, columns, relationships, business rules — one section per schema |
| `decisions.md` | Tech and architecture choices: what was chosen, over what, and why |
| `features.md` | User-facing behaviour and validation rules — one section per app |
| `ideas.md` | Deferred, ruled-out or not-yet-decided possibilities |
| `migration-plan.md` | Steps for moving the old per-app repos into this one, and their status |
| `deployment.md` | Production runbook (VPS, TLS cert, `.env`, bring-up) |
