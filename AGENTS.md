# Working on Marin Census

## Architecture

A static, zero-build MarinOS app on the Marin App Shell (`vendor/marinos/`, version in `platform.shell` in `marin.yml`). It follows `marin-digital-standards`. The primary view is `#start` in `index.html`; app code is `assets/app.js` and `assets/app.css`. `assets/gate.js` is the login and loads first.

The statistics come from `marin-data` (`statistics/README.md` there): schemaGov observations built from the ACS 5-year estimates. This app reads them; it does not calculate or round them. Margins of error, the source and what was left out must be shown with a value. A place with no observation shows nothing rather than a guess.

## Boundaries

- Do not edit `vendor/marinos/`. Adopt a new shell with its installer and update `platform.shell`.
- After a reviewed change to `security.json`, run `python3 scripts/sync-security-meta.py --write`.
- Do not use "view" in button or link text. No breadcrumbs, intro text above the content, or explanatory notes unless asked.
- Never put the password in a file. Only its SHA-256 hash is kept, in `assets/gate.js`.

## Before finishing

Run `bash scripts/check.sh`, then check the page in a browser: keyboard operation, narrow layout, light and dark.

## References

`marin-data`, `marin-app-shell`, `marin-ui`, `marin-digital-standards`, `marin-os` (catalog entry): https://github.com/marincountygov
