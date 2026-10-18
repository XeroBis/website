# Rarity icons

One PNG per rarity **category** slug — see
`frontend/src/app/util/rarity-category.util.ts::rarityCategory()`, which
maps raw `card_catalog.rarity` values (e.g. "Rare Holo ex", "LEGEND",
"Rare Prime") onto a smaller set of ~20 categories before this folder's
files are even looked up (via `rarity-icons.util.ts::raritySlug()` on the
*category* name, not the raw rarity). A category with no matching file
falls back to a text badge in the UI, so this can be filled in
incrementally.

**Restart the frontend container after adding/changing a file here** —
`ng serve`'s asset watcher only globs `public/` on startup, so a file
dropped in while it's already running won't be served until the next
`docker compose restart frontend`.

## Sourcing from pokecardex.com

Icons are pulled from pokecardex.com's CDN
(`https://pokecardex.b-cdn.net/assets/images/rarete/ids/rarete_{ID}.png`)
at the user's explicit request. To preview an ID, open that URL with the
ID filled in. The first pass at guessing IDs from pokecardex's own
letter-badge abbreviations (without confirming against the user) was
wrong across the board — don't repeat that; get the ID confirmed instead.

## `reverse.png` is not a rarity category

Every other file here is keyed by a `rarity-category.util.ts` category and
sourced from pokecardex's rarity-badge CDN (see below) — `reverse.png` is
the one exception, used only by the Sets page's completion filter row's
"Reverse" button (`sets-list.component.html`, not the rarity-toggle rows
elsewhere) to mark the reverse-holo-ownership filter. There's no
pokecardex rarity ID for it (reverse holo is a print variant, not a
rarity), so it isn't in the ID table below and isn't looked up via
`raritySlug()`/`rarityIconUrl()` — it's referenced by its literal path.
Generated locally (a diagonal rainbow-foil gradient on a rounded-rect card
silhouette, evoking a reverse-holo card back) rather than pulled from
pokecardex, for that reason.

## Current mapping (category → pokecardex ID)

| Category | Slug / filename | pokecardex ID |
|---|---|---|
| ACE SPEC Rare | `ace-spec-rare.png` | 40 |
| Black White Rare | `black-white-rare.png` | 43 |
| Common | `common.png` | 1 |
| Double Rare | `double-rare.png` | 32 |
| Futurist Rare (`Futuriste Rare` in imported DATA) | `futurist-rare.png` | — |
| Hyper Rare | `hyper-rare.png` | 36 |
| Illustration Rare | `illustration-rare.png` | 33 |
| Mega Attack Rare | `mega-attack-rare.png` | 47 |
| Mega Hyper Rare | `mega-hyper-rare.png` | 45 |
| Pikachu rare | `pikachu-rare.png` | — |
| Promo | `promo.png` | 7 |
| Rainbow Rare | `rainbow-rare.png` | 27 |
| Rare | `rare.png` | 3 |
| Rare Holo | `rare-holo.png` | 4 |
| Rare Secret | `rare-secret.png` | 6 |
| RGB Rare (`RGB` in imported DATA) | `rgb-rare.png` | — |
| Secrète | `secrete.png` | — |
| Shiny Rare | `shiny-rare.png` | 38 |
| Shiny Ultra Rare | `shiny-ultra-rare.png` | 39 |
| Special Illustration Rare | `special-illustration-rare.png` | 35 |
| Ultra Rare | `ultra-rare.png` | 34 |
| Uncommon | `uncommon.png` | 2 |

Not yet sourced (no icon, falls back to text): **No Rarity** — not
grouped with anything (see below), it's a placeholder for cards with no
scraped rarity, not a real tier.

## Raw rarity → category (see `rarity-category.util.ts`)

Every `card_catalog.rarity` not listed below is its own category (same
name/icon as a row above). These raw values collapse into a broader
category instead of getting their own filter button/icon:

| Raw `card_catalog.rarity` | Category |
|---|---|
| Amazing Rare | Ultra Rare |
| Futuriste Rare | Futurist Rare |
| Holo Rare V | Ultra Rare |
| Holo Rare VMAX | Ultra Rare |
| Holo Rare VSTAR | Ultra Rare |
| LEGEND | Ultra Rare |
| Radiant Rare | Ultra Rare |
| Rare BREAK | Ultra Rare |
| Rare Holo LV.X | Ultra Rare |
| Rare Holo Star | Ultra Rare |
| Rare Holo ex | Ultra Rare |
| Rare HoloEX | Ultra Rare |
| Rare HoloGX | Ultra Rare |
| Rare Prime | Ultra Rare |
| Rare Prism Star | Ultra Rare |
| Rare Shining | Ultra Rare |
| Rare ShinyGX | Ultra Rare |
| RGB | RGB Rare |
| Shiny Rare V or VMAX | Ultra Rare |
| Special Full Art | Rare Secret |
| Trainer Gallery Holo Rare | Rare Secret |
| Trainer Gallery Holo Rare V | Rare Secret |
| Trainer Gallery Holo Rare V or VMAX | Rare Secret |
| Trainer Gallery Secret Rare | Rare Secret |
| Trainer Gallery Ultra Rare | Rare Secret |

To add/change a grouping, edit `RARITY_CATEGORY_OVERRIDES` in
`rarity-category.util.ts` directly (this table is descriptive, not read by
code).
