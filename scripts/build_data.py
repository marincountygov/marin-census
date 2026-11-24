#!/usr/bin/env python3
"""Build data/census.json, the one file the page reads, from the files copied from marin-data.

  python3 scripts/build_data.py          write data/census.json
  python3 scripts/build_data.py --check  fail if data/census.json is not what the build would write

The copies in data/source/ come from marin-data (never edit them; run
`python3 ../marin-data/scripts/sync_copies.py .`). This script only reshapes them for the page:
nothing is rounded, filled in or calculated here, and a value that marin-data left out stays out.

A value in a place's `values` is one of:
  {"v": 149091, "m": 4474}   an estimate and its margin of error
  {"v": 257969}              an estimate with no published margin
  {"min": 250000}            an open-ended value, "250,000 or more" (the value is not known)
A variable a place has no value for is listed in `unavailable` with the reason marin-data recorded.
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "data" / "source"
OUT = ROOT / "data" / "census.json"
GS_LOCAL, GEOID = "gs:local", "census-geoid"
KINDS = {
    "county": "County",
    "city": "City or town",
    "cdp": "Census-designated place",
    "tract": "Census tract",
}


TOPICS = ROOT / "topics.json"


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def ident(record, scheme):
    return [i["value"] for i in record.get("identifier", []) if i.get("propertyID") == scheme]


def tail(iri):
    return iri.rstrip("/").rsplit("/", 1)[-1]


def kind_of(record):
    """What kind of area a record is, from its schemaGov type, never from its name."""
    if record.get("areaType") == "statistical-area":
        return "tract"
    if record.get("areaType") == "designated-place":
        return "cdp"
    if record.get("@type") == "City":
        return "city"
    if record["@id"].endswith("/id/jurisdiction/us-ca-marin"):
        return "county"
    return "cdp"  # a Marin community that is also a Census-designated place


def census_tables(variable):
    """The Census tables a variable is made from (B19013, B25070 ...), in order, from its cells in the mapping."""
    calc = variable["calculation"]
    if calc["type"] == "direct":
        cells = [calc["cell"]]
    elif calc["type"] == "sum":
        cells = calc["cells"] + calc.get("subtract", [])
    else:
        cells = calc["numerator"]["cells"]
    found = []
    for cell in cells:
        table = cell.split("_")[0]
        if table not in found:
            found.append(table)
    return found


def source_label(dataset):
    name = re.sub(r"(\d{4})-(\d{4})", "\\1\u2013\\2", dataset["name"])
    return f"{dataset['publisher']['name']}, {name}"


def measurement(observation):
    value = {}
    if "value" in observation:
        value["v"] = observation["value"]
    for bound in ("minValue", "maxValue"):
        if bound in observation:
            value["min" if bound == "minValue" else "max"] = observation[bound]
    margin = observation.get("marginOfError")
    if margin:
        value["m"] = margin["value"]
    return value


def build():
    variables_ld = load(SOURCE / "variables.jsonld")["@graph"]
    dataset = load(SOURCE / "datasets.jsonld")["@graph"][0]
    juris = load(SOURCE / "jurisdictions.jsonld")["@graph"]
    areas = load(SOURCE / "areas.jsonld")["@graph"]
    omitted = load(SOURCE / "omitted-values.json")["omitted"]
    mapping = load(SOURCE / "acs-mapping.json")
    manifest = load(SOURCE / "manifest.json")

    variables = []
    for v in variables_ld:
        variables.append({
            "id": tail(v["@id"]), "name": v["name"], "description": v.get("description", ""),
            "statType": v["statType"],
            "denominator": tail(v["measurementDenominator"]["@id"]) if "measurementDenominator" in v else None,
        })
    tables = {m["id"]: census_tables(m) for m in mapping["variables"]}
    for v in variables:
        v["censusTables"] = tables[v["id"]]
    ids = [v["id"] for v in variables]
    # Which variables are measures, and how they are grouped, comes from topics.json (presentation, kept here).
    topics = load(TOPICS)
    topic_of = {m: t["name"] for t in topics["topics"] for m in t["measures"]}
    listed = [m for t in topics["topics"] for m in t["measures"]]
    if len(listed) != len(set(listed)):
        sys.exit("topics.json lists a measure twice")
    unknown = sorted(set(listed) - set(ids))
    if unknown:
        sys.exit(f"topics.json lists measures that are not in marin-data: {unknown}")
    bad_default = sorted(set(topics["headlineMeasures"]) - set(listed))
    if bad_default:
        sys.exit(f"headlineMeasures are not listed in a topic: {bad_default}")
    denominators = {v["denominator"] for v in variables if v["denominator"]}
    for v in variables:
        v["role"] = "indicator" if v["id"] in topic_of else "denominator"
        if v["id"] in topic_of:
            v["topic"] = topic_of[v["id"]]
        elif v["id"] not in denominators:
            sys.exit(f"{v['id']} is neither a measure in topics.json nor the denominator of one")

    places, by_iri = [], {}
    for record in juris + areas:
        geoid = ident(record, GEOID)
        if not geoid:
            continue  # a Marin place with no Census area has no statistics
        name = re.sub(r" CDP$", "", re.sub(r", Marin County$", "", record["name"]))
        place = {"id": ident(record, GS_LOCAL)[0], "name": name, "kind": kind_of(record), "kindLabel": KINDS[kind_of(record)], "geoid": geoid[0], "values": {}, "unavailable": {}}
        places.append(place)
        by_iri[record["@id"]] = place

    units = {}
    observations = sorted((SOURCE / "observations").glob("*/*.jsonld"))
    for path in observations:
        for o in load(path)["@graph"]:
            place = by_iri[o["observationAbout"]["@id"]]
            vid = tail(o["variableMeasured"]["@id"])
            place["values"][vid] = measurement(o)
            units[vid] = o["unitText"]
    for item in omitted:
        by_iri[item["area"]]["unavailable"][item["variable"]] = item["reason"]
    for v in variables:
        v["unit"] = units[v["id"]]

    order = list(KINDS)
    places.sort(key=lambda p: (order.index(p["kind"]), p["geoid"] if p["kind"] == "tract" else p["name"].lower()))
    for p in places:
        p["values"] = {vid: p["values"][vid] for vid in ids if vid in p["values"]}
        p["unavailable"] = {vid: p["unavailable"][vid] for vid in ids if vid in p["unavailable"]}

    confidence = {
        m["additionalProperty"][0]["value"]
        for path in observations for o in load(path)["@graph"]
        for m in [o.get("marginOfError")] if m
    }
    if len(confidence) != 1:
        sys.exit(f"expected one confidence level, found {sorted(confidence)}")
    by_id = {v["id"]: v for v in variables}
    first = next(o for p in observations for o in load(p)["@graph"])
    return {
        "source": {
            "label": source_label(dataset),
            "period": first["observationPeriod"],
            "confidenceLevel": confidence.pop(),
            "url": dataset.get("url"),
            "publisher": dataset["publisher"]["name"],
            "name": re.sub(r"(\d{4})-(\d{4})", "\\1\u2013\\2", dataset["name"]),
            "license": dataset.get("license"),
            "geographyVintage": mapping["source"]["geographyVintage"],
            "retrieved": manifest["retrieved"],
        },
        "kinds": KINDS,
        "topics": [{"id": t["id"], "name": t["name"]} for t in topics["topics"]],
        "measures": [{"id": m, "name": by_id[m]["name"], "topic": t["name"]} for t in topics["topics"] for m in t["measures"]],
        "headlineMeasures": topics["headlineMeasures"],
        "variables": variables,
        "places": places,
    }


def text(data):
    return json.dumps(data, indent=1, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    out = text(build())
    if args.check:
        if not OUT.is_file() or OUT.read_text(encoding="utf-8") != out:
            sys.exit("data/census.json is out of date. Run: python3 scripts/build_data.py")
        print("ok: data/census.json is current")
    else:
        OUT.write_text(out, encoding="utf-8")
        data = json.loads(out)
        print(f"wrote data/census.json: {len(data['places'])} places, {len(data['variables'])} variables, {OUT.stat().st_size:,} bytes")
