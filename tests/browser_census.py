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
        page.wait_for_selector("#census-cards li")
        cards = page.locator("#census-cards li")

        # cards are the default: a name and the population, sorted by population
        require(page.locator("#census-table").is_hidden(), "cards should be the default view")
        require(page.locator("#census-count").inner_text() == "32 places", "default list should be 32 places")
        require(page.get_by_label("Census tract").is_checked() is False, "tracts should be off by default")
        require(cards.first.inner_text().replace("\n", " ") == "Marin County Population 257,969", "the first card is the county with its population")
        require(page.locator("#census-places .census-source").count() == 0, "the source is not on the list page")
        require(page.locator("#page-tabs a[aria-current=page]").inner_text() == "Places", "the Places tab is current")
        require(page.locator(".search-sidebar fieldset").count() == 1, "the filter column has Area types and nothing that changes the columns")
        page.get_by_role("button", name="Name, A to Z").click()
        require(cards.first.locator("h3").inner_text() == "Alto", "Name, A to Z starts with Alto")
        require("sort=name" in page.url, "the sort is in the address")
        page.get_by_role("button", name="Name, A to Z").click()
        require(page.locator("#sort-group [data-sort=name]").get_attribute("aria-label") == "Name, Z to A", "pressing the sort again reverses it")
        page.get_by_role("button", name="Population, high to low").click()
        require(cards.first.locator("h3").inner_text() == "Marin County", "Population, high to low starts with the county")

        # the table
        page.get_by_role("button", name="Table").click()
        page.wait_for_selector("#census-table tbody tr")
        rows = page.locator("#census-table tbody tr")
        require("view=table" in page.url, "the layout is in the address")
        require(page.locator("#sort-group").is_hidden(), "the table sorts from its headings, so the sort buttons hide")
        require(rows.first.locator("th").inner_text() == "Marin County", "the county should come first")

        page.fill(".search-sidebar input[type=search]", "belvedere")
        expect(rows).to_have_count(1)
        headers = page.locator("#census-table thead th").all_inner_texts()
        cells = rows.first.locator("th, td")
        income = cells.nth(next(i for i, h in enumerate(headers) if h.startswith("Median household income")))
        rent = cells.nth(next(i for i, h in enumerate(headers) if h.startswith("Median gross rent")))
        require(income.inner_text() == "$250,000 or more", "open-ended income should read '$250,000 or more'")
        require(rent.inner_text() == "$3,500 or more", "open-ended rent should read '$3,500 or more'")
        require(len(headers) == 12, f"the table opens with 10 measures, has {len(headers) - 2}")
        page.fill(".search-sidebar input[type=search]", "")

        require(page.locator("#census-table thead th").count() == 12, "the table has the ten headline measures")

        page.get_by_label("Census tract").check()
        expect(rows).to_have_count(95)
        require(page.locator("#census-count").inner_text().startswith("95 places"), "all areas should be 95 places")
        page.get_by_role("button", name="Median household income").click()
        require(page.locator('th[data-key="median-household-income"]').get_attribute("aria-sort") == "ascending", "sort should be ascending")
        page.get_by_role("button", name="Median household income").click()
        require(page.locator('th[data-key="median-household-income"]').get_attribute("aria-sort") == "descending", "sort should be descending")

        page.locator('#census-toolbar button[aria-label="Download, choose a format"]').click()
        with page.expect_download() as download:
            page.locator('#census-toolbar [data-download="csv"]').click()
        lines = Path(download.value.path()).read_text(encoding="utf-8-sig").splitlines()
        require(len(lines) == 95 * 49 + 1, f"CSV should have a row for each place and measure, has {len(lines) - 1}")

        page.fill(".search-sidebar input[type=search]", "marin city")
        expect(rows).to_have_count(1)
        page.get_by_role("link", name="Marin City").first.click()
        page.wait_for_selector("#place-table tbody tr")
        require("place=marin-city" in page.url, "a place has its own address")
        require(page.locator("#place-heading").inner_text() == "Marin City", "the place name is the heading")
        require(page.locator("#census-places").is_hidden(), "the list hides on a place's page")
        require("90%" in page.locator("#place-table thead").inner_text(), "the margin column names its confidence level")
        require("2020\u20132024" in page.locator("#place-source-heading ~ p").inner_text(), "the source names the period")
        # the place's table has the same table functions: sort the measures, Download, Fullscreen
        page.get_by_role("button", name="Measure").click()
        require(page.locator('#place-table th[data-key="name"]').get_attribute("aria-sort") == "ascending", "the measures should sort A to Z")
        require(page.locator("#place-table tbody tr.census-topic").count() == 8, "the place page has a section for each topic")
        require(page.locator("#place-table tbody").first.locator("tr").nth(1).locator("th").inner_text() == "Average household size", "A to Z inside Population and households starts with Average household size")
        # Copy link, Copy and Download sit apart from Fullscreen, each with its own border
        buttons = page.locator("#census-place .action-toolbar button[aria-label]").evaluate_all("els => els.map(e => e.getAttribute('aria-label'))")
        require(buttons == ["Copy link", "Copy, choose a format", "Download, choose a format", "Fullscreen"], f"the place's buttons are {buttons}")
        page.locator('#census-place button[aria-label="Copy, choose a format"]').click()
        page.locator("#census-place").get_by_role("button", name="Markdown").first.click()
        page.locator('#census-place button[aria-label="Download, choose a format"]').click()
        with page.expect_download() as place_download:
            page.locator('#census-place [data-download="csv"]').click()
        require(place_download.value.suggested_filename == "marin-census-marin-city.csv", "the place's CSV is named for the place")
        place_lines = Path(place_download.value.path()).read_text(encoding="utf-8-sig").splitlines()
        require(len(place_lines) == 49 + 1, f"the place's CSV should have all 49 variables, has {len(place_lines) - 1}")
        page.locator('#place-table-region [data-fullscreen-target]').click()
        require(page.locator("#place-table-region.is-expanded").count() == 1, "the place's table opens fullscreen")
        page.keyboard.press("Escape")
        page.go_back()
        page.wait_for_timeout(400)
        require(page.locator("#census-places").is_visible(), "Back returns to the list")

        # the Places tab is home: from a place's page it returns to the list, with the filters cleared
        page.goto(base + "?place=marin-city")
        page.wait_for_selector("#place-table tbody tr")
        page.locator('#page-tabs a[data-tab="start"]').click()
        page.wait_for_selector("#census-cards li")
        require(page.locator("#census-places").is_visible() and page.locator("#census-place").is_hidden(), "the Places tab returns to the list")
        require("place=" not in page.url, "home has no place in the address")

        # the Data tab
        page.goto(base + "#data")
        page.wait_for_selector("#measures-table tbody tr")
        require(page.locator("#page-tabs a[aria-current=page]").inner_text() == "Data", "the Data tab is current")
        require(page.locator("#measures-table tbody tr").count() == 33, "the Data tab lists the 33 measures")
        require("American Community Survey" in page.locator("#dataset-facts").inner_text(), "the Data tab names the dataset")
        require(page.locator("#data .action-toolbar button[aria-label]").count() >= 6, "the Data tab's tables have their buttons")
        page.locator('#page-tabs a[data-tab="start"]').click()
        page.wait_for_selector("#census-cards li")
        require(page.locator("#page-tabs a[aria-current=page]").inner_text() == "Places", "the Places tab brings back the list from the Data tab")

        page.goto(base + "?place=nowhere")
        page.wait_for_timeout(800)
        require(page.locator("#census-error").is_visible(), "an unknown place says so")

        page.emulate_media(color_scheme="dark")
        page.set_viewport_size({"width": 390, "height": 800})
        page.goto(base)
        page.wait_for_selector("#census-cards li")
        require(not page.evaluate("document.documentElement.scrollWidth > window.innerWidth"), "the page scrolls sideways on a phone")
        browser.close()
    server.shutdown()
    require(not errors, f"browser errors: {errors}")
    print("Places page and place page: PASS")


if __name__ == "__main__":
    main()
