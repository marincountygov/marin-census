// Run with: node tests/format.test.js
const assert = require("node:assert/strict");
const f = require("../assets/format.js");
const test = (name, fn) => { fn(); console.log(`ok  ${name}`); };

const v = (id, unit) => ({ id, name: id, unit });
const place = (values, unavailable = {}) => ({ values, unavailable });

test("numbers by unit", () => {
  assert.equal(f.number("persons", 257969), "257,969");
  assert.equal(f.number("households", 1234.6), "1,235");
  assert.equal(f.number("USD", 149091), "$149,091");
  assert.equal(f.number("percent", 8.307604), "8.3%");
  assert.equal(f.number("years", 47.4), "47.4");
  assert.equal(f.number("persons per household", 2.4567), "2.46");
  assert.equal(f.number("housing units", 110000.4), "110,000");
});

test("an estimate with a margin", () => {
  const e = f.entry(v("income", "USD"), place({ income: { v: 149091, m: 4474 } }));
  assert.deepEqual([e.text, e.margin, e.kind, e.sort], ["$149,091", "± $4,474", "estimate", 149091]);
});

test("an estimate with no margin shows no margin", () => {
  const e = f.entry(v("pop", "persons"), place({ pop: { v: 257969 } }));
  assert.equal(e.text, "257,969");
  assert.equal(e.margin, "");
});

test("zero is a real value, not missing", () => {
  const e = f.entry(v("net", "percent"), place({ net: { v: 0, m: 1.58 } }));
  assert.equal(e.text, "0.0%");
  assert.equal(e.kind, "estimate");
});

test("an open-ended value reads 'or more' and is never an exact number", () => {
  const e = f.entry(v("income", "USD"), place({ income: { min: 250000 } }));
  assert.equal(e.text, "$250,000 or more");
  assert.equal(e.margin, "");
  assert.equal(e.kind, "bound");
  assert.equal(f.entry(v("x", "USD"), place({ x: { max: 500 } })).text, "$500 or less");
});

test("a missing value says so, keeps the reason, and is not zero", () => {
  const e = f.entry(v("rent", "USD"), place({}, { rent: "estimate is the code -666666666" }));
  assert.equal(e.text, "Not available");
  assert.equal(e.sort, null);
  assert.equal(e.reason, "estimate is the code -666666666");
});

test("confidence level", () => assert.equal(f.confidence(0.9), "90%"));

test("csv cells are quoted when needed", () => {
  assert.equal(f.csvCell('a "b", c'), '"a ""b"", c"');
  assert.equal(f.csvCell(0), "0");
  assert.equal(f.csvCell(undefined), "");
});

test("csv keeps the numbers as published and leaves the bound's estimate empty", () => {
  const data = {
    source: { period: "2020/2024", label: "Source" },
    variables: [v("income", "USD")],
  };
  const out = f.csv(data, [{ name: "Ross", kindLabel: "City or town", geoid: "0662980", values: { income: { min: 250000 } }, unavailable: {} }]);
  assert.equal(out.split("\r\n")[1], "Ross,City or town,0662980,income,,,250000,,USD,2020/2024,Source,");
});

test("a table as text, html and markdown, escaped and with the source after it", () => {
  const out = f.formats("Places", ["Place", "Population"], [["A | B", "1,000"], ["<C>", "2"]], "Source: x");
  assert.equal(out.html, "<h2>Places</h2><table><thead><tr><th>Place</th><th>Population</th></tr></thead><tbody><tr><td>A | B</td><td>1,000</td></tr><tr><td>&lt;C&gt;</td><td>2</td></tr></tbody></table><p>Source: x</p>");
  assert.ok(out.markdown.includes("| A \\| B | 1,000 |"));
  assert.ok(out.markdown.includes("| --- | --- |"));
  assert.ok(out.markdown.endsWith("Source: x\n"));
  assert.ok(out.text.startsWith("Places\n\nPlace\tPopulation\nA | B\t1,000"));
  assert.equal(f.formats("T", ["a"], [["b"]]).html.includes("<p>"), false);
});
