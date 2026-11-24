# Working on Marin Census

## Architecture

A static, zero-build MarinOS app on the Marin App Shell (`vendor/marinos/`, version in `platform.shell` in `marin.yml`). It follows `marin-digital-standards`. The primary view is `#start` in `index.html`; app code is `assets/app.js` and `assets/app.css`. `assets/gate.js` is the login and loads first.

`data/source/` is copied from `marin-data` and never edited here (`python3 ../marin-data/scripts/sync_copies.py .`); `scripts/build_data.py` turns it into `data/census.json`, the one file the page reads. The statistics come from `marin-data` (`statistics/README.md` there): schemaGov observations built from the ACS 5-year estimates. This app reads them; it does not calculate or round them. Margins of error, the source and what was left out must be shown with a value. A place with no observation shows nothing rather than a guess.

Reading an observation:
- Resolve its variable by `@id`, never by a Census code. A subset such as age 65+ is its own variable.
- A 5-year estimate has `observationPeriod` (for example `2020/2024`), not a date. Never show it as one year.
- `value` can be absent. An observation with only `minValue` is an open-ended median: show it as "250,000 or more" (`maxValue` alone, "or less"). Never show the bound as an exact number.
- `marginOfError` and its `confidenceLevel` are optional. Show them when present; do not invent them.
- A statistical area is a `Place` with `areaType`. Governed areas are jurisdictions. Do not treat a community, a Census place and a tract as the same thing.

## The list view

Read `marin-ui/docs/components.md` ("Filter column", "Results header", "Cards") before changing it. The list is a directory of places and stays simple: the filter column has Search and Area types and nothing else. Cards are the default layout (the name, then Population); the table has a fixed set of columns, the headline measures in `topics.json`. The toolbar has, in order: sort (cards only), layout, then Copy link, Copy, Download and Fullscreen (table only). Copy link, Copy and Download are in a `.doc-actions` that is a direct child of the toolbar, never inside an `.action-group`. Choosing other measures and comparing places belongs to the compare and reports tool (the shell's `docs/reports-plan.md`), not to the list: do not add column pickers or measure filters here. The source is on a place's page and the Data tab, not on the list. The layout and sort are kept in the address; always keep `location.hash`, because the shell's tabs use it. Do not add a control the rules do not describe.

## Boundaries

- Do not edit `vendor/marinos/`. Adopt a new shell with its installer and update `platform.shell`.
- After a reviewed change to `security.json`, run `python3 scripts/sync-security-meta.py --write`.
- Do not use "view" in button or link text. No breadcrumbs, intro text above the content, or explanatory notes unless asked.
- Never put the password in a file. Only its SHA-256 hash is kept, in `assets/gate.js`.

## Before finishing

Run `python3 scripts/build_data.py` if the data changed, then `bash scripts/check.sh --browser`, then check the page in a browser: keyboard operation, narrow layout, light and dark.

## References

`marin-data`, `marin-app-shell`, `marin-ui`, `marin-digital-standards`, `marin-os` (catalog entry): https://github.com/marincountygov
