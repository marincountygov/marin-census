#!/usr/bin/env python3
"""Exercise the Places page and a place's page in a real browser. Run: python3 tests/browser_census.py

Serves the repository over local HTTP, opens the login for the tab, then checks filtering, sorting, the
open-ended and missing values, downloads, a place page, the Back button and a narrow screen.
"""
import functools
import http.server
import tempfile
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

        context = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True, permissions=["clipboard-read", "clipboard-write"])
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
        require(page.locator("#census-places .search-sidebar").get_by_label("Census tract").is_checked() is False, "tracts should be off by default")
        require(cards.first.inner_text().replace("\n", " ") == "Marin County Population 257,969", "the first card is the county with its population")
        require(page.locator("#census-places .census-source").count() == 0, "the source is not on the list page")
        require(page.locator("#page-tabs a[aria-current=page]").inner_text() == "Places", "the Places tab is current")
        require(page.locator("#census-places .search-sidebar fieldset").count() == 1, "the filter column has Area types and nothing that changes the columns")
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

        page.fill("#census-places .search-sidebar input[type=search]", "belvedere")
        expect(rows).to_have_count(1)
        headers = page.locator("#census-table thead th").all_inner_texts()
        cells = rows.first.locator("th, td")
        income = cells.nth(next(i for i, h in enumerate(headers) if h.startswith("Median household income")))
        rent = cells.nth(next(i for i, h in enumerate(headers) if h.startswith("Median gross rent")))
        require(income.inner_text() == "$250,000 or more", "open-ended income should read '$250,000 or more'")
        require(rent.inner_text() == "$3,500 or more", "open-ended rent should read '$3,500 or more'")
        require(len(headers) == 12, f"the table opens with 10 measures, has {len(headers) - 2}")
        page.fill("#census-places .search-sidebar input[type=search]", "")

        require(page.locator("#census-table thead th").count() == 12, "the table has the ten headline measures")

        page.locator("#census-places .search-sidebar").get_by_label("Census tract").check()
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

        page.fill("#census-places .search-sidebar input[type=search]", "marin city")
        expect(rows).to_have_count(1)
        page.get_by_role("link", name="Marin City").first.click()
        page.wait_for_selector("#place-tables tbody tr")
        require("place=marin-city" in page.url, "a place has its own address")
        require(page.locator("#place-heading").inner_text() == "Marin City", "the place name is the heading")
        require(page.locator("#census-places").is_hidden(), "the list hides on a place's page")
        require("90%" in page.locator("#place-tables thead").first.inner_text(), "the margin column names its confidence level")
        require("2020\u20132024" in page.locator("#place-source-heading ~ p").inner_text(), "the source names the period")
        # the place's table has the same table functions: sort the measures, Download, Fullscreen
        # one table for each topic, each with a heading and a caption, and nothing to sort: the rows have different units
        require(page.locator("#place-tables table").count() == 8, "the place page has a table for each topic")
        require(page.locator("#place-tables h3").count() == 8, "each table has a heading")
        require(page.locator("#place-tables caption").first.inner_text() == "Marin City: Population and households", "each table has a caption")
        require(page.locator("#place-tables .sort-button").count() == 0, "the place's tables do not sort")
        require(page.locator("#place-tables tbody tr").count() == 33, "every measure has a row")
        require(page.locator('#place-tables th[scope="colgroup"]').count() == 0, "no heading row is squeezed into a table")
        # Copy, Copy link and Download sit apart from Fullscreen, each with its own border
        buttons = page.locator("#census-place .action-toolbar button[aria-label]").evaluate_all("els => els.map(e => e.getAttribute('aria-label'))")
        require(buttons == ["Copy, choose a format", "Copy link", "Download, choose a format", "Fullscreen"], f"the place's buttons are {buttons}")
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
        page.wait_for_selector("#place-tables tbody tr")
        page.locator('#page-tabs a[data-tab="start"]').click()
        page.wait_for_selector("#census-cards li")
        require(page.locator("#census-places").is_visible() and page.locator("#census-place").is_hidden(), "the Places tab returns to the list")
        require("place=" not in page.url, "home has no place in the address")

        # the list is a directory: no ticks and no Compare
        page.goto(base)
        page.wait_for_selector("#census-cards li")
        require(page.locator("#census-cards input[type=checkbox]").count() == 0, "the list has no ticks")
        require(page.locator("#compare-button").count() == 0, "the list has no Compare button")

        # Data is always the last tab
        require(page.locator("#page-tabs a").all_inner_texts() == ["Places", "Reports", "Data"], "the tabs are Places, Reports, Data: Data is last")
        # tables have a border on every cell, as Budget's do
        require(page.evaluate("getComputedStyle(document.querySelector('#census-table, #measures-table')).borderTopWidth") == "1px", "a table has a border")

        # Reports: one tool for comparing, a profile, or everything
        page.locator('#page-tabs a[data-tab="reports"]').click()
        page.wait_for_selector(".report-section")
        require(page.locator("#page-tabs a[aria-current=page]").inner_text() == "Reports", "the Reports tab is current")
        section = page.locator(".report-section").first
        preview = page.locator("#report-preview")
        require(section.locator('[data-count="places"]').inner_text() == "1 of 95 places", "the report starts on Marin County")
        require(section.locator(".report-checks--places li:visible").count() == 32, "the place list opens on the same three area types as the list")
        require(section.locator(".report-group").count() == 2, "places and measures are in bordered groups")
        require(page.locator("#reports details").count() == 1, "a section has one accordion: its own, with no accordions inside")
        require(section.locator(".report-topic").count() == 8, "the measures run in topics")
        stacked = page.evaluate("""() => { const t = document.querySelector('.report-topic'); const l = t.querySelector('legend').getBoundingClientRect(); const u = t.querySelector('ul').getBoundingClientRect(); return u.top >= l.bottom - 1; }""")
        require(stacked, "a topic's name is above its choices, not beside them")
        require(page.evaluate("(() => { const p = document.querySelector('#report-panel'); return getComputedStyle(p).overflowY !== 'auto' && p.scrollHeight <= p.clientHeight + 1; })()"), "the builder does not scroll inside the page")
        require(page.evaluate("getComputedStyle(document.querySelector('.report-section summary')).color") == page.evaluate("getComputedStyle(document.body).color"), "the section heading is the text color, not muted")
        require(page.evaluate("document.querySelector('#report-panel').getBoundingClientRect().width") >= 320, "the builder sidebar is wide enough for its form")
        require(section.locator("ul.report-checks").evaluate_all("els => els.every(e => getComputedStyle(e).overflowY !== 'auto' && getComputedStyle(e).overflowY !== 'scroll')"), "no list scrolls")
        require("Census-designated" not in section.locator(".report-checks--places").inner_text(), "a place row shows only its name")
        section.locator('[data-kind="tract"]').first.check()
        require(section.locator(".report-checks--places li:visible").count() == 95, "the Census tract type adds the tracts")

        section.locator(".report-checks--places label", has_text="San Rafael").first.locator("input").check()
        section.locator(".report-checks--places label", has_text="Novato").first.locator("input").check()
        require("report=" in page.url and page.url.endswith("#reports"), "the report is in the address")
        head = preview.locator("thead th").all_inner_texts()
        require(head == ["Measure", "Marin County", "Novato", "San Rafael"], f"places across the top: {head}")
        require("\u00b1" in preview.locator("tbody tr").first.inner_text(), "the report shows margins of error")
        require("American Community Survey" in preview.inner_text(), "the report ends with the source")

        # the report title shows its default; the page title names each tab
        require(page.locator("#report-title").get_attribute("placeholder") == "Marin Census report", "the report title's placeholder is the default title")
        require(page.title() == "Reports | Marin Census", f"the Reports tab is titled: {page.title()!r}")

        # the report's tables look like every other table in the app
        same = page.evaluate("""() => {
            const look = (el) => { const c = getComputedStyle(el); return [c.borderTopColor, c.borderTopWidth, c.borderBottomColor, c.borderBottomWidth, c.borderLeftColor, c.borderRightColor]; };
            const reference = document.querySelector('#measures-table');
            const table = document.querySelector('#report-preview table');
            return JSON.stringify([look(table), look(table.querySelector('td'))]) === JSON.stringify([look(reference), look(reference.querySelector('td'))]);
        }""")
        require(same, "the report's tables have the same border as the other tables")
        require(preview.locator(".table-scroll table").count() == preview.locator("table").count(), "each report table is in the scrolling box")

        # Select all takes what is shown, and everything fits
        section.locator('[data-all="places"]').check()
        require(section.locator('[data-count="places"]').inner_text() == "95 of 95 places", "Select all takes every place shown")
        section.locator('[data-all="measures"]').check()
        require(section.locator('[data-count="measures"]').inner_text() == "33 of 33 measures", "Select all takes every measure")
        require(preview.locator("table").count() == 3, "95 places and 33 measures make three tables")
        require(preview.locator("tbody tr").count() == 95 * 3, "every place has a row in each table")
        require("part 1 of 3" in preview.inner_text(), "the tables are numbered")
        require("left out" not in page.locator("#report-note").inner_text(), "nothing is left out")
        section.locator('[data-all="places"]').uncheck()
        require(section.locator('[data-count="places"]').inner_text() == "0 of 95 places", "clearing Select all clears the shown places")
        section.locator('[data-kind="tract"]').first.uncheck()
        section.locator('[data-kind="county"]').first.uncheck()
        section.locator('[data-kind="cdp"]').first.uncheck()
        require(section.locator(".report-checks--places li:visible").count() == 11, "area types narrow the list to the cities and towns")
        section.locator('[data-all="places"]').check()
        require(section.locator('[data-count="places"]').inner_text() == "11 of 95 places", "Select all takes only what the area types show")

        # a section: another measure, no margins, measures across
        section.locator('[data-all="measures"]').uncheck()
        section.locator('[data-measure="homeownership-rate"]').check()
        section.locator('[data-measure="vacancy-rate"]').check()
        require(preview.locator("thead th").all_inner_texts() == ["Place", "Homeownership rate", "Vacancy rate"], "auto puts the longer of places and measures down")
        section.locator('[data-field="margins"]').uncheck()
        require("\u00b1" not in preview.inner_text(), "without margins none show")
        section.locator('[data-field="orientation"]').select_option("places")
        require(preview.locator("thead th").first.inner_text() == "Measure", "places across the top puts a measure on each row")
        require(preview.locator("table").count() == 1, "11 places across fit in one table")
        section.locator('[data-field="orientation"]').select_option("auto")
        section.locator('[data-field="margins"]').check()

        # a section opens and closes, and a closed one still says what it holds
        summary = section.locator('summary[data-summary="section"]')
        require(summary.inner_text() == "Section 1", f"the summary is just the section number: {summary.inner_text()}")
        require(section.locator("details").first.evaluate("e => e.open"), "a section opens open")
        summary.click()
        require(not section.locator("details").first.evaluate("e => e.open"), "pressing the summary closes the section")
        require(section.locator(".app-form-grid").is_hidden(), "a closed section hides its form")
        require(summary.inner_text() == "Section 1", "a closed section keeps its number")
        summary.click()
        require(section.locator(".app-form-grid").is_visible(), "pressing it again opens the section")

        # the heading follows the Title field, and goes back to the number when it is empty
        section.locator('[data-field="title"]').fill("Cities compared")
        require(summary.inner_text() == "Cities compared", f"the heading is the title typed: {summary.inner_text()}")
        require("Section 1: Cities compared" in section.locator("[data-legend=section]").inner_text(), "the group name keeps the number and adds the title")
        section.locator('[data-field="title"]').fill("")
        require(summary.inner_text() == "Section 1", "an empty title goes back to the section number")

        # the section's box is as wide as the sidebar
        widths = page.evaluate("[document.querySelector('#report-panel').getBoundingClientRect().width, document.querySelector('.report-section > details').getBoundingClientRect().width]")
        require(abs(widths[0] - widths[1]) <= 1, f"a section is the full width of the sidebar: {widths}")

        # the sidebar collapses, and Reset puts the report back
        toggle = page.locator('button[data-filter-toggle="report"]')
        require(toggle.get_attribute("aria-expanded") == "true", "the sidebar opens open")
        toggle.click()
        require(page.locator("#report-panel").is_hidden(), "the sidebar collapses")
        require(page.locator("#report-preview").is_visible(), "the report stays")
        toggle.click()
        require(page.locator("#report-panel").is_visible(), "the sidebar opens again")
        page.locator("#add-section").click()
        require(page.locator(".report-section").count() == 2, "Add section adds a section")
        page.locator("#report-title").fill("My report")
        page.locator("#reset-report").click()
        require(page.locator(".report-section").count() == 1, "Reset leaves one section")
        require(page.locator('[data-count="places"]').inner_text() == "1 of 95 places", "Reset puts the report back on Marin County")
        require(page.locator("#report-title").input_value() == "", "Reset clears the title")
        require("report=" not in page.url and "rt=" not in page.url, "Reset clears the address")
        require("Report reset" in page.locator("#report-status").inner_text(), "Reset says so")
        require(page.evaluate("document.activeElement.id") == "reset-report", "focus stays on Reset")
        # a few steps again so the rest of the flow has its report
        section = page.locator(".report-section").first
        section.locator('[data-all="places"]').check()
        section.locator('[data-all="measures"]').check()
        section.locator('[data-all="measures"]').uncheck()
        section.locator('[data-measure="homeownership-rate"]').check()
        section.locator('[data-measure="vacancy-rate"]').check()

        # outputs: Copy, Download CSV and the report file
        page.locator('#reports button[aria-label="Copy, choose a format"]').click()
        page.locator("#reports").get_by_role("button", name="Markdown").first.click()
        require("| Place |" in page.evaluate("navigator.clipboard.readText()"), "Copy Markdown holds the table")
        page.locator('#reports button[aria-label="Download, choose a format"]').click()
        with page.expect_download() as csv_download:
            page.locator('#reports [data-download="csv"]').click()
        csv_text = Path(csv_download.value.path()).read_text(encoding="utf-8-sig")
        require("margin of error" in csv_text.splitlines()[0], f"the CSV has a margin column: {csv_text.splitlines()[0]}")
        page.locator('#reports button[aria-label="Download, choose a format"]').click()
        with page.expect_download() as file_download:
            page.locator('#reports [data-download="json"]').click()
        saved = Path(file_download.value.path()).read_text(encoding="utf-8")
        require('"schema": "1.0"' in saved, "the report file is a report")

        # a link to the report opens it again
        page.reload()
        page.wait_for_selector(".report-section")
        require(page.locator('[data-count="places"]').inner_text() == "32 of 95 places", "the address brings the report back")

        # open the saved file
        with tempfile.TemporaryDirectory() as folder:
            report_path = Path(folder) / "saved-report.json"
            report_path.write_text(saved, encoding="utf-8")
            page.locator("#report-file").set_input_files(str(report_path))
            page.wait_for_timeout(600)
        require("Opened" in page.locator("#report-status").inner_text(), "a saved report file opens")

        # a report file is untrusted: markup in it is shown as text and never runs
        evil = '{"schema":"1.0","title":"<img src=x onerror=window.__xss=1>","sections":[{"type":"table","title":"<script>window.__xss=1</script>","head":["<b>Measure</b>","V"],"rows":[["<iframe src=javascript:window.__xss=1></iframe>","<a href=javascript:window.__xss=1>x</a>"]]}],"sources":[{"label":"Source <i>x</i>","url":"javascript:window.__xss=1"}]}'
        page.goto(base + "#reports")
        page.wait_for_selector(".report-section")
        with tempfile.TemporaryDirectory() as folder:
            evil_path = Path(folder) / "evil.json"
            evil_path.write_text(evil, encoding="utf-8")
            page.locator("#report-file").set_input_files(str(evil_path))
            page.wait_for_timeout(600)
        shown = page.locator("#report-preview")
        require(page.evaluate("window.__xss") is None, "markup in a report file does not run")
        require(shown.locator("img, script, iframe, b, i").count() == 0, "markup in a report file is not made into elements")
        require("<img src=x" in shown.inner_text() and "<b>Measure</b>" in shown.inner_text(), "markup in a report file is shown as text")
        require(shown.locator("a[href^=javascript]").count() == 0, "a javascript link is not kept")
        require(shown.locator("table th[scope=col]").count() >= 2, "the table keeps its headings")

        # the Data tab
        page.goto(base + "#data")
        page.wait_for_selector("#measures-table tbody tr")
        require(page.locator("#page-tabs a[aria-current=page]").inner_text() == "Data", "the Data tab is current")
        require(page.locator("#measures-table tbody tr").count() == 33, "the Data tab lists the 33 measures")
        require(page.locator("#measures-table .sort-button").count() == 3, "only the columns whose values repeat sort: Topic, Unit and Census table")
        require("American Community Survey" in page.locator("#dataset-facts").inner_text(), "the Data tab names the dataset")
        require(page.title() == "Data | Marin Census", f"the Data tab is titled: {page.title()!r}")
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
