#!/usr/bin/env python3
"""Accessibility test of the Reports tab and its sidebar. Run: python3 tests/a11y_reports.py

Always checks: names a screen reader hears are unique, focus is never hidden under another element (Tab and Shift+Tab),
targets are at least 24 px, a table that scrolls sideways can be reached by keyboard, changes are announced, the report
is a labeled region with a way to skip to it, and a removed section or a reset can be undone.
With AXE_CORE set to axe.min.js (npm pack axe-core, then package/axe.min.js) it also runs axe-core on a set of states
(WCAG 2.0 to 2.2 A and AA, and best practice); without it that part is skipped and says so.
"""
import functools
import http.server
import os
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
AXE = os.environ.get("AXE_CORE")
UNLOCK = "try { window.sessionStorage.setItem('marin-census-unlocked', '1'); } catch (e) {}"
TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]
problems = []


def check(condition, message):
    if not condition:
        problems.append(message)
        print(f"FAIL: {message}")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


# What a screen reader says for a control: the groups it sits in (fieldset legends, labeled groups), then its own name.
HEARD = """(e) => {
  const text = (x) => (x && x.textContent || '').trim().replace(/\\s+/g, ' ');
  const own = () => {
    let n = e.getAttribute('aria-label');
    if (!n && e.getAttribute('aria-labelledby')) n = e.getAttribute('aria-labelledby').split(' ').map((i) => text(document.getElementById(i))).join(' ');
    if (!n && e.labels && e.labels.length) n = [...e.labels].map(text).join(' ');
    return n || text(e) || e.title || '';
  };
  const groups = [];
  for (let p = e.parentElement; p; p = p.parentElement) {
    if (p.tagName === 'FIELDSET') { const l = p.querySelector(':scope > legend'); if (l) groups.unshift(text(l)); }
    else if (p.getAttribute && p.getAttribute('role') === 'group' && p.getAttribute('aria-labelledby')) groups.unshift(text(document.getElementById(p.getAttribute('aria-labelledby'))));
  }
  return groups.concat(own()).join(' > ');
}"""

OBSCURED = """() => {
  const e = document.activeElement; const r = e.getBoundingClientRect();
  if (!r.width || !r.height || e.closest('marin-app-feedback') || /^Skip to/.test((e.textContent || '').trim())) return false; // a skip link is shown by focus itself
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!top) return true;
  const same = e.contains(top) || top.contains(e) || (top.closest('label') && top.closest('label') === e.closest('label'));
  return !same && !top.closest('marin-app-feedback');
}"""


def axe_scan(page, label):
    if not AXE:
        return
    result = page.evaluate("async (tags) => { const r = await axe.run(document, { runOnly: { type: 'tag', values: tags } }); return r.violations.map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')); }", TAGS)
    for v in result:
        check(False, f"axe, {label}: {v}")


def main():
    handler = functools.partial(Quiet, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}/"
    with sync_playwright() as p:
        browser = p.chromium.launch()

        def open_reports(width=1440, height=700, scheme="light", forced=None):
            kwargs = {"viewport": {"width": width, "height": height}, "color_scheme": scheme}
            if forced:
                kwargs["forced_colors"] = forced
            context = browser.new_context(**kwargs)
            context.add_init_script(UNLOCK)
            if AXE:
                context.add_init_script(path=AXE)
            page = context.new_page()
            page.goto(base + "#reports")
            page.wait_for_selector(".report-section", state="attached")
            page.wait_for_timeout(500)
            return context, page

        # ---- the page with two sections -------------------------------------------------------------------------
        context, page = open_reports()
        page.locator("#add-section").click()
        page.wait_for_timeout(300)

        # names: what a screen reader hears is unique across the whole sidebar, so the second section is not the first
        page.locator('button[data-filter-toggle="report"]').focus()
        heard = []
        for _ in range(140):
            page.keyboard.press("Tab")
            if not page.evaluate("!!document.activeElement.closest('#report-panel')"):
                break
            heard.append(page.evaluate(f"({HEARD})(document.activeElement)"))
        repeated = sorted({h for h in heard if heard.count(h) > 1})
        check(not repeated, f"a screen reader hears the same name twice: {repeated[:6]}")
        check(len(heard) > 20, "the walk should cover the sidebar")

        # focus is never hidden under another element, going forward and back
        for key in ("Tab", "Shift+Tab"):
            page.locator('.report-section [data-measure="unemployment-rate"]').last.focus()
            hidden = []
            for i in range(70):
                page.keyboard.press(key)
                if page.evaluate(OBSCURED):
                    hidden.append(page.evaluate(f"({HEARD})(document.activeElement)"))
            check(not hidden, f"{key}: focus is hidden under another element at {len(hidden)} stops, e.g. {hidden[:2]}")

        # targets are at least 24 px (a checkbox is 24 px, as in the filter column)
        small = page.evaluate("""() => [...document.querySelectorAll('#reports input, #reports select, #reports button, #reports summary, #reports a')]
            .filter((e) => e.getClientRects().length && e.type !== 'file' && !e.classList.contains('skip-to-report')) // a skip link is measured when it has focus, below.map((e) => { const r = e.getBoundingClientRect(); return [e.tagName + (e.type ? '[' + e.type + ']' : ''), Math.round(r.width), Math.round(r.height), (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24)]; })
            .filter((x) => x[1] < 24 || x[2] < 24)""")
        check(not small, f"targets under 24 px: {small[:4]}")
        page.locator("#skip-to-report").focus()
        skip = page.evaluate("(() => { const r = document.querySelector('#skip-to-report').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()")
        check(skip[0] >= 24 and skip[1] >= 24, f"the skip link, shown by focus, is at least 24 px: {skip}")
        page.locator("#skip-to-report").press("Enter")
        check(page.evaluate("document.activeElement.id") == "report-preview", "the skip link moves focus to the report")

        # a group is described by its count; the report title shows its default; the page title names the tab
        check(page.locator("fieldset.report-group[aria-describedby]").count() == 4, "Places and Measures are described by their counts")
        check(page.locator("#report-title").get_attribute("placeholder") == "Marin Census report", "the report title shows the default as its placeholder")
        check(page.evaluate("document.title") == "Reports | Marin Census", f"the page title names the tab: {page.evaluate('document.title')!r}")

        # a menu closes with Escape and gives focus back
        toggle = page.locator('#reports button[aria-label="Copy, choose a format"]')
        toggle.click()
        check(toggle.get_attribute("aria-expanded") == "true", "a menu opens")
        page.keyboard.press("Escape")
        check(toggle.get_attribute("aria-expanded") == "false" and page.evaluate("document.activeElement.getAttribute('aria-label')") == "Copy, choose a format", "Escape closes a menu and returns focus to its button")

        # sections and the report are named
        check(page.locator(".report-section fieldset.report-fields").count() == 2, "each section's fields are a group named for the section")
        check(page.locator("#report-preview[role=region][aria-labelledby]").count() == 1, "the report is a labeled region")
        check(page.locator("#report-layout-hint").count() == 1 and page.locator(".report-section select").first.get_attribute("aria-describedby") is not None, "the layout choice has a description for assistive technology")
        check(page.locator("#skip-to-report").count() == 1, "there is a way to skip to the report")

        # changes are announced (a polite, visually hidden status), after a pause so typing is not read key by key
        live = page.locator("#report-announce")
        check(live.count() == 1 and live.get_attribute("aria-live") == "polite", "a polite status announces changes")
        if live.count():
            first = page.locator(".report-section").first
            first.locator(".report-checks--places label", has_text="Novato").first.locator("input").check()
            page.wait_for_timeout(900)
            check("Report updated" in live.inner_text() and "table" in live.inner_text(), f"ticking a place is announced: {live.inner_text()!r}")
            first.locator("input[data-field=place-search]").fill("san")
            page.wait_for_timeout(900)
            check("shown" in live.inner_text(), f"a search says how many places show: {live.inner_text()!r}")
            first.locator("input[data-field=place-search]").fill("zzzz")
            page.wait_for_timeout(900)
            check("No places match" in live.inner_text(), f"an empty search says so: {live.inner_text()!r}")
            first.locator("input[data-field=place-search]").fill("")
            page.locator(".report-section").last.locator('button[data-act="up"]').click()
            check("moved up" in page.locator("#report-status").inner_text(), "moving a section says so")

        # undo: a removed section and a reset can be brought back
        count = page.locator(".report-section").count()
        page.locator(".report-section").last.locator('button[data-act="remove"]').click()
        undo = page.locator("#undo-report")
        check(undo.count() == 1 and undo.is_visible(), "removing a section offers Undo")
        if undo.count() and undo.is_visible():
            undo.click()
            check(page.locator(".report-section").count() == count, "Undo brings the section back")
        page.locator("#reset-report").click()
        if page.locator("#undo-report").count() and page.locator("#undo-report").is_visible():
            page.locator("#undo-report").click()
            check(page.locator(".report-section").count() == count, "Undo after Reset brings the report back")
        else:
            check(False, "Reset offers Undo")

        # tables that scroll sideways are reachable by keyboard: many places across makes a wide table
        page.locator('.report-section').first.locator('[data-field="orientation"]').select_option("measures")
        page.locator('.report-section').first.locator('[data-all="measures"]').check()
        page.wait_for_timeout(400)
        boxes = page.evaluate("""() => [...document.querySelectorAll('.table-scroll')].filter((b) => b.getClientRects().length && b.scrollWidth > b.clientWidth + 1)
            .map((b) => [b.getAttribute('tabindex'), b.getAttribute('role'), b.getAttribute('aria-label')])""")
        check(boxes and all(t == "0" and r == "region" and n for t, r, n in boxes), f"every table that scrolls sideways is a focusable, named region: {boxes[:3]}")
        axe_scan(page, "two sections, all measures")
        context.close()

        # ---- text spacing (WCAG 1.4.12) and text size: nothing is cut off and the page does not scroll sideways ----
        spacing = "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }"
        for label, width, css in (("text spacing", 1440, spacing), ("200% text", 1440, "html { font-size: 200%; }"), ("200% text on a narrow screen", 640, "html { font-size: 200%; }")):
            context, page = open_reports(width=width)
            page.evaluate("(css) => { const sheet = new CSSStyleSheet(); sheet.replaceSync(css); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; }", css)  # a constructed sheet: the page's policy forbids a style tag
            page.wait_for_timeout(300)
            if width < 851:
                page.locator('button[data-filter-toggle="report"]').click()
                page.wait_for_timeout(300)
            check(not page.evaluate("document.documentElement.scrollWidth > innerWidth + 1"), f"{label}: the page does not scroll sideways")
            clipped = page.evaluate("""() => [...document.querySelectorAll('#report-panel label, #report-panel legend, #report-panel summary, #report-panel button, #report-panel select, #report-panel .app-field')]
                .filter((e) => e.getClientRects().length && e.clientWidth > 1 && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX !== 'visible') // a visually hidden legend or skip link is 1 px on purpose.map((e) => (e.textContent || '').trim().slice(0, 20))""")
            check(not clipped, f"{label}: text is cut off in {clipped[:3]}")
            context.close()

        # ---- axe on the other states ----------------------------------------------------------------------------
        for label, kwargs in (("default, light", {}), ("default, dark", {"scheme": "dark"}), ("320 px", {"width": 320})):
            context, page = open_reports(**kwargs)
            if kwargs.get("width") == 320:
                page.locator('button[data-filter-toggle="report"]').click()
                page.wait_for_timeout(300)
                check(not page.evaluate("document.documentElement.scrollWidth > innerWidth"), "320 px: the page does not scroll sideways")
            axe_scan(page, label)
            context.close()

        # ---- forced colors: a checked box shows a mark (the shell's 2.4.0 base draws the browser's own box there) ------
        context, page = open_reports(forced="active")
        # Is a checked box drawn with a mark? Look for dark pixels inside the box, away from its border (needs Pillow).
        try:
            from PIL import Image
            import io
            boxes = page.locator(".report-checks--places input[type=checkbox]")
            for i in range(boxes.count()):
                if boxes.nth(i).is_visible() and boxes.nth(i).is_checked():
                    picture = Image.open(io.BytesIO(boxes.nth(i).screenshot())).convert("L")
                    w, h = picture.size
                    inner = [picture.getpixel((x, y)) for x in range(w // 4 + 2, w - w // 4 - 2) for y in range(h // 4 + 2, h - h // 4 - 2)]
                    if not any(v < 100 for v in inner):
                        check(False, "in forced colors a checked checkbox has no mark, so it looks unchecked")
                    break
        except ImportError:
            print("SKIP: forced-colors checkbox look (needs Pillow).")
        context.close()
        browser.close()
    server.shutdown()
    if not AXE:
        print("SKIP: axe-core scan (set AXE_CORE to axe.min.js).")
    if problems:
        raise SystemExit(f"{len(problems)} accessibility problem(s)")
    print("Reports accessibility: PASS")


if __name__ == "__main__":
    main()
