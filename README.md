# Marin Census

Public statistics about Marin's people, communities and housing.

- **Audience:** County staff
- **Owner:** County of Marin
- **Status:** Alpha. The page is a shell behind a login; no statistics are shown yet.
- **Data:** will come from `marin-data` (`statistics/`, ACS 5-year estimates)

## Run locally

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/`. Use HTTP, not `file://`. There is no build step.

## Login

`assets/gate.js` shows a password form until the password has been entered in the browser tab. It is the same login Marin Budget uses. It is a gate in the browser, not access control: the pages and data are static files and anyone who requests them directly gets them. Only a SHA-256 hash of the password is kept in the file. To change the password, replace `HASH` in `assets/gate.js` with the hash of the new one (`printf '%s' 'NEW PASSWORD' | shasum -a 256`).

## Check

`bash scripts/check.sh`, then look at the page in a browser: keyboard, narrow layout, light and dark.

## Shell

Built on Marin App Shell 2.0.0 (`vendor/marinos/`). Do not edit it. See `docs/development.md` for updating it.
