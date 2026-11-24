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

- **Places** (the default): a table of places and ten measures, with a filter column (search and area type; tracts are off until chosen), sortable columns, Download (CSV, JSON) and Fullscreen. A value shows its margin of error under it. An open-ended median reads "$250,000 or more". A value the Census does not give reads "Not available".
- **A place** (`?place=marin-city`): all the measures with margins of error and what each rate is out of, and the source.

## Data

`data/source/` holds files copied from `marin-data` (never edit them): run `python3 ../marin-data/scripts/sync_copies.py .`. Then `python3 scripts/build_data.py` writes `data/census.json`, the one file the page reads. The build only reshapes: nothing is rounded or calculated. `assets/format.js` rounds for display. `bash scripts/check.sh` fails if `data/census.json` is out of date.

## Login

`assets/gate.js` shows a password form until the password has been entered in the browser tab. It is the same login Marin Budget uses. It is a gate in the browser, not access control: the pages and data are static files and anyone who requests them directly gets them. Only a SHA-256 hash of the password is kept in the file. To change the password, replace `HASH` in `assets/gate.js` with the hash of the new one (`printf '%s' 'NEW PASSWORD' | shasum -a 256`).

## Check

`bash scripts/check.sh`, then look at the page in a browser: keyboard, narrow layout, light and dark.

## Shell

Built on Marin App Shell 2.2.0 (`vendor/marinos/`). Do not edit it. See `docs/development.md` for updating it.
