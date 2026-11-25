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

## Tabs and tables

The tabs are Places, Reports, Data: Data is always last. Every table has a border and each cell has one, the same as Marin Budget's tables (see `.table-scroll table` in `assets/app.css`).

## The list view

Read `marin-ui/docs/components.md` ("Filter column", "Results header", "Cards") before changing it. The list is a directory of places and stays simple: the filter column has Search and Area types and nothing else. Cards are the default layout (the name, then Population); the table has a fixed set of columns, the headline measures in `topics.json`. The toolbar has, in order: sort (cards only), layout, then Copy, Copy link, Download and Fullscreen (table only). Copy, Copy link and Download are in a `.doc-actions` that is a direct child of the toolbar, never inside an `.action-group`. Choosing other measures and comparing places belongs to the compare and reports tool (the shell's `docs/reports-plan.md`), not to the list: do not add column pickers or measure filters here. The source is on a place's page and the Data tab, not on the list. The layout and sort are kept in the address; always keep `location.hash`, because the shell's tabs use it. Do not add a control the rules do not describe.

## Reports

The Reports tab is the only place that chooses measures or compares places; keep that out of the list. A report is made by the shell's core (`window.marinReports`), never by hand: `assets/report-model.js` (pure, tested in Node) turns sections into the report object, `assets/reports.js` is the screens and the address. A cell's raw value carries `{ value, margin }` or a one-sided bound (`min`/`max`), so the CSV keeps both, and a value the Census does not give is empty, never zero. A section has no limit on places or measures: more than 11 across (the core allows 12 columns) become several tables, the core holds 10 tables, and the page says when some are left out. A list of choices never scrolls inside the page: show it in full, or narrow it with a filter, and put a border round a group so its edges are clear. The core's HTML has inline styles for pasting into Word; the preview drops them because the page's policy forbids inline styles. Do not add inline styles or write report HTML anywhere else.

## Charts

`assets/chart.js` draws a section's chart with no library: `spec` (pure, tested in Node) picks and orders the bars and writes the sentence; `draw` makes an SVG with DOM calls that set text and numbers, in 'page' mode (styled by `.chart-*` classes, so light, dark and forced colors work) or 'image' mode (colors as attributes, for the PNG a report holds; `png` draws it on a canvas). The chart is drawn from our own numbers, never from a saved file's data: an opened report file shows only the chart's sentence. A chart never draws a value the Census does not give or an open-ended one ("250,000 or more"); it counts them in its sentence. Keep every chart's `title`, `desc` and `role="img"`, and check contrast (the test does).

## Accessibility of the Reports sidebar

`tests/a11y_reports.py` is the test (run with `AXE_CORE=/path/to/axe.min.js` to include axe-core; `npm pack axe-core` gets it). It checks what a screen reader hears is unique (a section's fields are a `fieldset` whose legend is "Section N", and repeated controls say which section: "Move up, section 2"), focus is never under another element (the Report/Reset row does not stick), targets are 24 px, a table that scrolls sideways is a focusable named region (`watchScrollBoxes` in `assets/app.js`), changes are announced after a pause in `#report-announce`, the report is a region named by its title with a "Skip to the report" link, and a removed section or a reset has Undo. Do not use `role="group"` on a div (Pico lays it out inline-flex): use a `fieldset`. In forced colors a checked checkbox shows a mark (shell 2.4.0 and later); the test fails if it does not.

## Boundaries

- Do not edit `vendor/marinos/`. Adopt a new shell with its installer and update `platform.shell`.
- After a reviewed change to `security.json`, run `python3 scripts/sync-security-meta.py --write`.
- Do not use "view" in button or link text. No breadcrumbs, intro text above the content, or explanatory notes unless asked.
- Never put the password in a file. Only its SHA-256 hash is kept, in `assets/gate.js`.

## Before finishing

Run `python3 scripts/build_data.py` if the data changed, then `bash scripts/check.sh --browser`, then check the page in a browser: keyboard operation, narrow layout, light and dark.

## References

`marin-data`, `marin-app-shell`, `marin-ui`, `marin-digital-standards`, `marin-os` (catalog entry): https://github.com/marincountygov
