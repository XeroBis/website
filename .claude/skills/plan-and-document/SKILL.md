---
name: plan-and-document
description: Use this skill whenever the user proposes a change to this monorepo — a new feature, a business rule, a tech/architecture decision ("let's use X", "switch to Y", "add Z"), a data model change, porting a piece of an old sibling repo (auth-service, pokemon_cards, workout, media, vps-edge), or anything that would touch a file in documentation/. Ask clarifying questions before writing any code or docs, then update the relevant documentation/ file(s) per CLAUDE.md's table. Trigger on requests that change how any app works, is built, or is structured — even short ones like "add a wishlist to media" or "port the workout import" — not just requests that explicitly ask for planning or documentation.
---

# Plan and Document

## Why

Requests like "port cards" or "add tags to the portfolio" read as final decisions but usually hide unresolved choices: how much to build now, what to drop or change from the old repo, which schema owns the data, what goes in `@shared`. Building immediately risks doing the wrong thing, redoing it, or drifting from a choice already recorded in `documentation/decisions.md`. Asking first keeps the docs — and then the code — an accurate record of what the user actually wants.

## When this applies

Any request that would change something `documentation/` tracks: a feature or user-facing behaviour, a schema/table/column/business rule, a tech or library choice, the folder/architecture structure, or a step of `migration-plan.md`. Small, fully-specified edits (fix this typo, rename this label to exactly X) don't need the interview — use judgment on how much is actually ambiguous.

## Steps

1. **Read before asking.** Skim the `documentation/*.md` sections that relate to the request (and the relevant code). When porting, also read the old repo's own docs (`../<repo>/documentation/`, `../<repo>/CLAUDE.md`) and the code being ported. Don't ask something either already answers. Use them as the baseline for your questions.

2. **Ask clarifying questions with AskUserQuestion.** Prefer several small, concrete questions over one broad one. Good targets for this repo:
   - how much to build now vs. later;
   - when porting: what to keep as-is, change, or drop from the old app (old behaviour isn't automatically wanted);
   - which schema owns new tables (an app's own, or `core` if every app needs it);
   - whether a piece belongs in one app or in `@shared` / a shared backend module;
   - UX details `features.md` would need to record, and the shape of new data.

   Give each question a recommended default so the user can move fast.

3. **Respect the scope the user gives back exactly.** If they narrow it to "docs only" or "just X, not Y", don't quietly do more — confirm again before expanding scope later.

4. **Update the docs in the same step as the decision**, routed per CLAUDE.md's table:
   - Folder structure, environments, ports, request flow → `architecture.md`
   - Schemas, tables, columns, relationships, business rules → `data-model.md`, under that schema's section
   - Tech/library/architecture choice → `decisions.md`: a dated entry stating what was chosen, over what, and why, matching that file's style
   - User-facing behaviour, validation rules → `features.md`, under that app's section
   - Anything deferred, ruled out, or still just a possibility → `ideas.md`
   - Porting progress → `migration-plan.md` status column
   - Prod runbook changes → `deployment.md`

5. **Move resolved ideas out of `ideas.md`.** If a change turns an `ideas.md` entry into an actual decision, remove or rewrite that entry rather than leaving a stale duplicate.
