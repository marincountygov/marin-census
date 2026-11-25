// Run with: node tests/report-model.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../assets/format.js');
const M = require('../assets/report-model.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'census.json'), 'utf8'));
const test = (name, fn) => { fn(); console.log(`ok  ${name}`); };
const section = (over) => ({ ...M.newSection(data, ['san-rafael', 'novato']), ...over });

test('a new section starts on Marin County with the headline measures', () => {
  const s = M.newSection(data);
  assert.deepEqual(s.places, ['marin-county']);
  assert.equal(s.measures.length, 10);
  assert.equal(s.orientation, 'auto');
  assert.equal(s.margins, true);
});

test('clean drops what does not exist and keeps the data order, with no limit on how many', () => {
  const all = data.places.map((p) => p.id);
  const s = M.clean(data, { places: ['nowhere', ...all.slice().reverse()], measures: ['nope', ...data.measures.map((m) => m.id)], title: 'x'.repeat(300), orientation: 'sideways' });
  assert.deepEqual(s.places, all);
  assert.equal(s.measures.length, data.measures.length);
  assert.equal(s.orientation, 'auto');
  assert.equal(s.title.length, 200);
});

test('the longer of places and measures runs down: auto layout', () => {
  assert.equal(M.acrossOf(section()), 'places'); // 2 places, 10 measures: the measures run down
  assert.equal(M.acrossOf(section({ measures: ['population-total'] })), 'measures'); // 2 places, 1 measure: the places run down
  assert.equal(M.acrossOf({ places: data.places.map((p) => p.id), measures: ['population-total', 'median-age'], orientation: 'auto' }), 'measures');
  assert.equal(M.acrossOf(section({ orientation: 'places', measures: ['population-total'] })), 'places');
  assert.equal(M.acrossOf({ places: ['a'], measures: ['b'], orientation: 'measures' }), 'measures');
});

test('places across: a measure on each row, a place in each column, with margins', () => {
  const [t] = M.buildSection(data, F, section({ orientation: 'places', measures: ['population-total', 'median-household-income'] }));
  assert.deepEqual(t.head, ['Measure', 'Novato', 'San Rafael']); // the places keep the order of the data, not the order they were ticked
  assert.equal(t.rows.length, 2);
  assert.match(t.rows[1][1], /^\$[\d,]+ \u00b1 \$[\d,]+$/);
  assert.equal(t.title, 'Novato and San Rafael: 2 measures');
});

test('measures across: a place on each row', () => {
  const [t] = M.buildSection(data, F, section({ orientation: 'measures', measures: ['population-total', 'median-age'] }));
  assert.deepEqual(t.head, ['Place', 'Total population', 'Median age']);
  assert.equal(t.rows.length, 2);
});

test('every place and every measure fit: many across become several tables, with nothing left out', () => {
  const everything = { places: data.places.map((p) => p.id), measures: data.measures.map((m) => m.id), orientation: 'measures', margins: true, title: '' };
  const tables = M.buildSection(data, F, everything);
  assert.equal(tables.length, 4); // 41 measures across, 11 at a time
  assert.equal(M.tableCount(data, everything), 4);
  tables.forEach((t) => { assert.equal(t.rows.length, data.places.length); assert.ok(t.head.length <= 12); });
  assert.equal(tables.reduce((n, t) => n + t.head.length - 1, 0), data.measures.length);
  assert.match(tables[1].title, /\(part 2 of 4\)$/);
  const placesAcross = M.buildSection(data, F, { ...everything, orientation: 'places' });
  assert.equal(placesAcross.length, Math.ceil(data.places.length / 11));
  assert.equal(placesAcross.reduce((n, t) => n + t.head.length - 1, 0), data.places.length);
});

test('a report says how many tables it made, and keeps the first ten', () => {
  const big = { places: data.places.map((p) => p.id), measures: data.measures.map((m) => m.id), orientation: 'places', margins: true, title: '' };
  const r = M.buildReport(data, F, [big, big], {});
  assert.equal(r.tables, 2 * Math.ceil(data.places.length / 11));
  assert.equal(r.sections.length, M.LIMITS.tables);
});

test('the raw figures keep the estimate and margin together, and an open-ended value is a bound', () => {
  const [t] = M.buildSection(data, F, section({ orientation: 'places', places: ['belvedere', 'san-rafael'], measures: ['median-household-income'] }));
  assert.deepEqual(t.values[0][1], { min: 250000 }); // Belvedere comes first
  assert.equal(t.rows[0][1], '$250,000 or more');
  assert.equal(typeof t.values[0][2], 'object');
  assert.ok('value' in t.values[0][2] && 'margin' in t.values[0][2]);
});

test('a value the Census does not give is empty in the data and says so in the text, never zero', () => {
  const missing = data.places.find((p) => p.kind === 'tract' && Object.keys(p.unavailable).length);
  const vid = Object.keys(missing.unavailable)[0];
  const [t] = M.buildSection(data, F, { places: [missing.id], measures: [vid], orientation: 'places', margins: true });
  assert.equal(t.rows[0][1], 'Not available');
  assert.equal(t.values[0][1], '');
});

test('without margins the text and the raw figures have none', () => {
  const [t] = M.buildSection(data, F, section({ orientation: 'places', margins: false, measures: ['median-household-income'] }));
  assert.ok(!t.rows[0].join(' ').includes('\u00b1'));
  assert.equal(typeof t.values[0][1], 'number');
});

test('a section with no place or no measure makes no table', () => {
  assert.deepEqual(M.buildSection(data, F, section({ places: [] })), []);
  const r = M.buildReport(data, F, [section({ measures: [] }), section()], { title: ' ', prepared: '2026-11-24' });
  assert.equal(r.sections.length, 1);
  assert.equal(r.title, 'Marin Census report');
  assert.equal(r.prepared, '2026-11-24');
});

test('the report ends with the source and the confidence level', () => {
  const r = M.buildReport(data, F, [section()], {});
  assert.equal(r.sources.length, 1);
  assert.match(r.sources[0].label, /American Community Survey 5-year estimates, 2020\u20132024\. Margins of error are at the 90% confidence level\.$/);
  assert.match(r.sources[0].url, /^https:\/\//);
});

test('the address holds the sections and reads them back; everything is written as *', () => {
  const sections = [section({ title: 'A | B ~ C', orientation: 'measures', margins: false })];
  assert.deepEqual(M.decode(M.encode(data, sections), data), sections.map((s) => M.clean(data, s)));
  const all = [{ places: data.places.map((p) => p.id), measures: data.measures.map((m) => m.id), orientation: 'auto', margins: true, title: '' }];
  assert.equal(M.encode(data, all), '*|*|a|1|');
  assert.deepEqual(M.decode('*|*|a|1|', data), all);
  assert.deepEqual(M.decode('', data), []);
  assert.deepEqual(M.decode('nowhere|nope|p|1|', data), []);
  assert.equal(M.decode(Array(10).fill('san-rafael|population-total|p|1|').join('~'), data).length, M.LIMITS.sections);
});

test('a table never has more than 12 columns', () => {
  assert.ok(M.LIMITS.across + 1 <= 12);
});
