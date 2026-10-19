---
name: plan-and-document
description: Use this skill whenever the user proposes a change to this monorepo — a new feature, a business rule, a tech/architecture decision ("let's use X", "switch to Y", "add Z"), a data model change, or anything that would touch a file in documentation/. Ask clarifying questions before writing any code or docs, then update the relevant documentation/ file(s) per CLAUDE.md's table. Trigger on requests that change how any app works, is built, or is structured — even short ones like "add a wishlist to media" or "let users export their decks" — not just requests that explicitly ask for planning or documentation.
---

# Plan and Document

## Why

Requests like "add tags to the portfolio" read as final decisions but usually hide unresolved choices: how much to build now, which schema owns the data, what goes in `@shared`. Building immediately risks doing the wrong thing, redoing it, or drifting from a choice already recorded in `documentation/decisions.md`. Asking first keeps the docs — and then the code — an accurate record of what the user actually wants.

## When this applies

Any request that would change something `documentation/` tracks: a feature or user-facing behaviour, a schema/table/column/business rule, a tech or library choice, or the folder/architecture structure. Small, fully-specified edits (fix this typo, rename this label to exactly X) don't need the interview — use judgment on how much is actually ambiguous.

## Steps

1. **Read before asking.** Skim the `documentation/*.md` sections that relate to the request (and the relevant code). Don't ask something either already answers. Use them as the baseline for your questions.

2. **Ask clarifying questions with AskUserQuestion.** Prefer several small, concrete questions over one broad one. Good targets for this repo:
   - how much to build now vs. later;
   - which schema owns new tables (an app's own, or `core` if every app needs it);
   - whether a piece belongs in one app or in `@shared` / a shared backend module;
   - UX details `features.md` would need to record, and the shape of new data.

   Give each question a recommended default so the user can move fast.

3. **Respect the scope the user gives back exactly.** If they narrow it to "docs only" or "just X, not Y", don't quietly do more — confirm again before expanding scope later.

4. **Update the docs in the same step as the decision**, routed per the table in CLAUDE.md's "Documentation Rule". Match the style of the file you're writing in (e.g. `decisions.md` entries are dated and say what was chosen, over what, and why).

5. **Move resolved ideas out of `ideas.md`.** If a change turns an `ideas.md` entry into an actual decision, remove or rewrite that entry rather than leaving a stale duplicate.
