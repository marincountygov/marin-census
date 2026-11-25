#!/usr/bin/env python3
"""Tests for data/census.json, the file the page reads. Run: python3 tests/test_build_data.py"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_data  # noqa: E402

DATA = json.loads((ROOT / "data" / "census.json").read_text(encoding="utf-8"))
PLACES = {p["id"]: p for p in DATA["places"]}


class CensusData(unittest.TestCase):
    def test_file_is_current(self):
        self.assertEqual((ROOT / "data" / "census.json").read_text(encoding="utf-8"), build_data.text(build_data.build()))

    def test_search_index_is_current_and_lists_every_place_and_measure(self):
        index = json.loads((ROOT / "search-index.json").read_text(encoding="utf-8"))
        self.assertEqual((ROOT / "search-index.json").read_text(encoding="utf-8"), build_data.text(build_data.search_index(DATA)))
        self.assertEqual(index["base"], "https://marincountygov.github.io/marin-census/")
        self.assertEqual(len(index["entries"]), len(DATA["places"]) + len(DATA["measures"]))
        novato = [e for e in index["entries"] if e["n"] == "Novato"]
        self.assertEqual(novato, [{"k": "Statistic", "n": "Novato", "d": "City or town", "h": "?place=novato"}])
        self.assertTrue(all(e["h"].startswith("?place=") or e["h"] == "#data" for e in index["entries"]))

    def test_areas_by_kind(self):
        kinds = [p["kind"] for p in DATA["places"]]
        self.assertEqual({k: kinds.count(k) for k in set(kinds)}, {"county": 1, "city": 11, "cdp": 20, "tract": 63})

    def test_marin_places_keep_their_names_and_codes(self):
        self.assertEqual(PLACES["marin-city"]["geoid"], "0645820")
        self.assertEqual(PLACES["marin-county"]["kind"], "county")
        self.assertEqual(PLACES["marin-county"]["name"], "Marin County")

    def test_every_value_is_a_known_variable_and_a_place_has_a_value_or_a_reason(self):
        ids = {v["id"] for v in DATA["variables"]}
        for place in DATA["places"]:
            self.assertLessEqual(set(place["values"]), ids)
            for vid in ids:
                self.assertTrue((vid in place["values"]) != (vid in place["unavailable"]), f"{place['id']} {vid}")

    def test_an_open_ended_median_is_a_bound_with_no_value_and_no_margin(self):
        for place in ("belvedere", "ross"):
            income = PLACES[place]["values"]["median-household-income"]
            self.assertEqual(income, {"min": 250000})

    def test_a_missing_value_is_listed_not_zero(self):
        unavailable = [(p["id"], v) for p in DATA["places"] for v in p["unavailable"]]
        self.assertTrue(unavailable)
        for pid, vid in unavailable:
            self.assertNotIn(vid, PLACES[pid]["values"])

    def test_the_county_total_has_no_margin_and_the_others_keep_theirs(self):
        self.assertEqual(PLACES["marin-county"]["values"]["population-total"], {"v": 257969})
        self.assertIn("m", PLACES["marin-county"]["values"]["median-age"])

    def test_numbers_are_not_rounded(self):
        self.assertEqual(PLACES["marin-county"]["values"]["poverty-rate"]["v"], 8.307604)

    def test_measures_follow_topics_json_and_denominators_stay_hidden(self):
        measures = [m["id"] for m in DATA["measures"]]
        indicators = {v["id"] for v in DATA["variables"] if v["role"] == "indicator"}
        self.assertEqual(set(measures), indicators)
        self.assertEqual(len(measures), 41)
        self.assertIn("population-total", measures)  # a measure even though it is also a denominator
        self.assertNotIn("occupied-housing-units", measures)
        self.assertEqual(len(DATA["headlineMeasures"]), 10)
        self.assertLessEqual(set(DATA["headlineMeasures"]), set(measures))
        self.assertEqual({m["topic"] for m in DATA["measures"]}, {t["name"] for t in DATA["topics"]})

    def test_home_values_at_the_top_code_are_bounds(self):
        value = PLACES["belvedere"]["values"]["median-home-value"]
        self.assertEqual(value, {"min": 2000000})

    def test_a_mean_keeps_two_places(self):
        self.assertEqual(PLACES["marin-county"]["values"]["average-household-size"]["v"], 2.44)

    def test_source_label_and_confidence(self):
        self.assertEqual(DATA["source"]["label"], "U.S. Census Bureau, American Community Survey 5-year estimates, 2020–2024")
        self.assertEqual(DATA["source"]["confidenceLevel"], 0.9)
        self.assertEqual(DATA["source"]["period"], "2020/2024")


if __name__ == "__main__":
    unittest.main()
