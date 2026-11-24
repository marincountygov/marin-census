#!/usr/bin/env python3
"""Exercise the Places page and a place's page in a real browser. Run: python3 tests/browser_census.py

Serves the repository over local HTTP, opens the login for the tab, then checks filtering, sorting, the
open-ended and missing values, downloads, a place page, the Back button and a narrow screen.
"""
import functools
import http.server
import threading
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
UNLOCK = "try { window.sessionStorage.setItem('marin-census-unlocked', '1'); } catch (e) {}"


def require(condition, message):
    if not condition:
        raise SystemExit(f"ERROR: {message}")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    handler = functools.partial(Quiet, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}/"
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        # the login
        locked = browser.new_page()
        locked.goto(base)
        locked.wait_for_selector(".gate")
        require(locked.locator("main").is_hidden(), "the page shows behind the login")
        locked.close()

        context = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
        context.add_init_script(UNLOCK)
        page = context.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(base)
        page.wait_for_selector("#census-table tbody tr")
        rows = page.locator("#census-table tbody tr")

        require(page.locator("#census-count").inner_text() == "32 places", "default list should be 32 places")
        require(page.get_by_label("Census tract").is_checked() is False, "tracts should be off by default")
        require(rows.first.locator("th").inner_text() == "Marin County", "the county should come first")

        page.fill(".search-sidebar input[type=search]", "belvedere")
        expect(rows).to_have_count(1)
        require(rows.count() == 1, "search should narrow to one place")
        cells = rows.first.locator("td")
        require(cells.nth(5).inner_text() == "$250,000 or more", "open-ended income should read '$250,000 or more'")
        require(cells.nth(7).inner_text() == "$3,500 or more", "open-ended rent should read '$3,500 or more'")
        page.fill(".search-sidebar input[type=search]", "")

        page.get_by_label("Census tract").check()
        expect(rows).to_have_count(95)
        require(page.locator("#census-count").inner_text().startswith("95 places"), "all areas should be 95 places")
        page.get_by_role("button", name="Median household income").click()
        require(page.locator('th[data-key="median-household-income"]').get_attribute("aria-sort") == "ascending", "sort should be ascending")
        require(all("Not available" != c for c in [rows.first.locator("td").nth(5).inner_text()]), "missing values should sort last")
        page.get_by_role("button", name="Median household income").click()
        require(page.locator('th[data-key="median-household-income"]').get_attribute("aria-sort") == "descending", "sort should be descending")

        page.locator('button[aria-controls="download-panel"]').click()
        with page.expect_download() as download:
            page.locator('[data-download="csv"][data-scope="places"]').click()
        lines = Path(download.value.path()).read_text(encoding="utf-8-sig").splitlines()
        require(len(lines) == 95 * 14 + 1, f"CSV should have a row for each place and measure, has {len(lines) - 1}")

        page.fill(".search-sidebar input[type=search]", "marin city")
        expect(rows).to_have_count(1)
        page.get_by_role("link", name="Marin City").first.click()
        page.wait_for_selector("#place-table tbody tr")
        require("place=marin-city" in page.url, "a place has its own address")
        require(page.locator("#place-heading").inner_text() == "Marin City", "the place name is the heading")
        require(page.locator("#census-places").is_hidden(), "the list hides on a place's page")
        require("90%" in page.locator("#place-table thead").inner_text(), "the margin column names its confidence level")
        require("2020–2024" in page.locator("#place-source-heading ~ p").inner_text(), "the source names the period")
        # the place's table has the same table functions: sort the measures, Download, Fullscreen
        page.get_by_role("button", name="Measure").click()
        require(page.locator('#place-table th[data-key="name"]').get_attribute("aria-sort") == "ascending", "the measures should sort A to Z")
        require(page.locator("#place-table tbody tr").first.locator("th").inner_text() == "Disability rate", "A to Z should start with Disability rate")
        page.locator('button[aria-controls="place-download-panel"]').click()
        with page.expect_download() as place_download:
            page.locator('[data-download="csv"][data-scope="place"]').click()
        require(place_download.value.suggested_filename == "marin-census-marin-city.csv", "the place's CSV is named for the place")
        place_lines = Path(place_download.value.path()).read_text(encoding="utf-8-sig").splitlines()
        require(len(place_lines) == 15, f"the place's CSV should have 14 measures, has {len(place_lines) - 1}")
        page.locator('#place-table-region [data-fullscreen-target]').click()
        require(page.locator("#place-table-region.is-expanded").count() == 1, "the place's table opens fullscreen")
        page.keyboard.press("Escape")
        page.go_back()
        page.wait_for_timeout(400)
        require(page.locator("#census-places").is_visible(), "Back returns to the list")

        page.goto(base + "?place=nowhere")
        page.wait_for_timeout(800)
        require(page.locator("#census-error").is_visible(), "an unknown place says so")

        page.emulate_media(color_scheme="dark")
        page.set_viewport_size({"width": 390, "height": 800})
        page.goto(base)
        page.wait_for_selector("#census-table tbody tr")
        require(not page.evaluate("document.documentElement.scrollWidth > window.innerWidth"), "the page scrolls sideways on a phone")
        browser.close()
    server.shutdown()
    require(not errors, f"browser errors: {errors}")
    print("Places page and place page: PASS")


if __name__ == "__main__":
    main()
