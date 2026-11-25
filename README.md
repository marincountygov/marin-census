# Marin Census

Public statistics about Marin's people, communities and housing.

- **Audience:** County staff
- **Owner:** County of Marin
- **Status:** Alpha, behind a login.
- **Data:** `marin-data` (`statistics/`): American Community Survey 5-year estimates, 2020–2024, for Marin County, its cities and towns, Census-designated places and census tracts.

## Run locally

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/`. Use HTTP, not `file://`. There is no build step.

## Pages

- **Places** (the default): a directory of places as cards (the name and its population) or a table of ten headline measures that sorts from its headings. The filter column has search and area type (tracts are off until chosen). Sort buttons on the cards (population or name, press again to reverse). Copy (Text, HTML, Markdown), Copy link and Download (those, JSON, CSV) in both layouts; Fullscreen on the table. The layout, sort and filters are in the address.
- **A place** (`?place=marin-city`): all the measures by topic with margins of error and what each rate is out of, the same buttons, and the source.
- **Reports**: one tool for comparing places, for a place's profile, and for everything at once. A report is sections; a section is a table of the places and measures you choose, with no limit on how many. The place list is A to Z and narrows by area type, as the list's filter column does: an area type that is unchecked takes its places out of the report, and checking it brings them back. Select all takes what is shown. A table holds at most 11 columns across, so more than that makes several tables (part 1 of 3); the layout is automatic (the longer of places and measures runs down) or set by hand. Margins of error are on or off. The preview is the report. Copy (Text, HTML, Markdown), Copy link and Download (those, JSON report file, CSV) hold exactly that report, the CSV with a column for each margin of error and bound. A section can also have charts: choose bars or columns and any of the section's measures, and each gets a chart card like the ones in Marin Mentions, with its title, a legend (the bar and the margin-of-error whisker) Charts is an item of the Copy menu and Charts (PNG) an item of the Download menu. A chart shows one measure across the section's places, highest first, with the margin of error as a whisker (at most 30 places; the 30 highest are shown and the sentence says so; places with no exact value are not drawn and are counted). The chart is an image with a name and a description, drawn with Chart.js from the app's own numbers, and the report holds it as a picture and as its sentence. Its table is not shown with it, but Copy and Download still hold it, and a screen reader has the same numbers as a hidden table. A saved report file opens again. The report is in the address (everything is written as `*`). It uses the shell's report core (`window.marinReports`, `docs/reports.md` in marin-app-shell); `assets/report-model.js` turns the sections into the report. The list itself has no ticks or Compare: it is a directory.
- **Data**: the dataset (publisher, period, geography, retrieval date), the measures with their definitions, units and Census tables, and a download of all places.

## Data

`data/source/` holds files copied from `marin-data` (never edit them): run `python3 ../marin-data/scripts/sync_copies.py .`. Then `python3 scripts/build_data.py` writes `data/census.json`, the one file the page reads. The build only reshapes: nothing is rounded or calculated. `assets/format.js` rounds for display. `bash scripts/check.sh` fails if `data/census.json` is out of date.

## Login

`assets/gate.js` shows a password form until the password has been entered in the browser tab. It is the same login Marin Budget uses. It is a gate in the browser, not access control: the pages and data are static files and anyone who requests them directly gets them. Only a SHA-256 hash of the password is kept in the file. To change the password, replace `HASH` in `assets/gate.js` with the hash of the new one (`printf '%s' 'NEW PASSWORD' | shasum -a 256`).

## Check

`bash scripts/check.sh`, then look at the page in a browser: keyboard, narrow layout, light and dark.

## Shell

Built on Marin App Shell 2.4.0 (`vendor/marinos/`). Do not edit it. See `docs/development.md` for updating it.
