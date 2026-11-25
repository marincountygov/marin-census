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

test('clean drops what does not exist and keeps the places A to Z, with no limit on how many', () => {
  const all = data.places.map((p) => p.id);
  const s = M.clean(data, { places: ['nowhere', ...all.slice().reverse()], measures: ['nope', ...data.measures.map((m) => m.id)], title: 'x'.repeat(300), orientation: 'sideways' });
  assert.deepEqual(s.places, M.byName(data));
  assert.deepEqual(M.byName(data).slice(0, 3), ['alto', 'belvedere', 'black-point-green-point-cdp']);
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

test('the report ends with the source and nothing else', () => {
  const r = M.buildReport(data, F, [section()], {});
  assert.equal(r.sources.length, 1);
  assert.match(r.sources[0].label, /^U\.S\. Census Bureau, American Community Survey 5-year estimates, 2020\u20132024$/);
  assert.ok(!/margin|confidence/i.test(r.sources[0].label));
  assert.match(r.sources[0].url, /^https:\/\//);
});

test('the address holds the sections and reads them back; everything is written as *', () => {
  const sections = [section({ title: 'A | B ~ C', orientation: 'measures', margins: false })];
  assert.deepEqual(M.decode(M.encode(data, sections), data), sections.map((s) => M.clean(data, s)));
  const all = [{ places: M.byName(data), measures: data.measures.map((m) => m.id), orientation: 'auto', margins: true, title: '', chart: 'none', chartMeasures: [] }];
  assert.equal(M.encode(data, all), '*|*|a|1|');
  assert.deepEqual(M.decode('*|*|a|1|', data), all);
  assert.deepEqual(M.decode('', data), []);
  assert.deepEqual(M.decode('nowhere|nope|p|1|', data), []);
  assert.equal(M.decode(Array(10).fill('san-rafael|population-total|p|1|').join('~'), data).length, M.LIMITS.sections);
});

test('each charted measure follows the section as a chart with a table of its own', () => {
  const sec = section({ chart: 'bars', chartMeasures: ['median-age', 'population-total'], measures: ['population-total', 'median-age'] });
  const tables = M.buildSection(data, F, sec, () => ({ image: 'data:image/png;base64,AAAA', width: 700, height: 200 }));
  assert.equal(tables.length, 1 + 2, 'the section table and two charts');
  assert.equal(M.tableCount(data, sec), 3);
  const [main, first, second] = tables;
  assert.ok(!main.chart && !main._chartSpec, 'the section table has no chart');
  // charts follow in the order of the data, each with its table of the same places
  assert.equal(first.chart.series[0].name, 'Total population');
  assert.equal(second.chart.series[0].name, 'Median age');
  assert.equal(first.title, '', 'the chart has the title, so its table has none');
  assert.match(first.chart.title, /^Total population by place \(people\)$/);
  assert.deepEqual(first.head, ['Place', 'Total population']);
  assert.equal(first.rows.length, 2);
  assert.equal(first.chart.image, 'data:image/png;base64,AAAA');
  assert.match(first.chart.summary, /^Total population for 2 places: highest /);
  assert.deepEqual(M.decode(M.encode(data, [sec]), data), [M.clean(data, sec)]);
  assert.ok(!M.encode(data, [section()]).includes('|b|'), 'a section with no chart keeps the short form');
});

test('a chart table lists every place in the chart order, with the places the chart leaves out last', () => {
  const sec = { places: ['belvedere', 'novato', 'san-rafael'], measures: ['median-household-income'], orientation: 'auto', margins: true, title: '', chart: 'bars', chartMeasures: ['median-household-income'] };
  const [, chart] = M.buildSection(data, F, sec);
  assert.deepEqual(chart.rows.map((r) => r[0]), ['San Rafael', 'Novato', 'Belvedere']); // Belvedere is "250,000 or more": not drawn, so last
  assert.equal(chart.rows[2][1], '$250,000 or more');
  assert.equal(chart.chart.labels.length, 2);
});

test('charts need measures of the section; a list can be empty; with no list the first is charted; an older single measure is read', () => {
  const base = { places: ['novato'], measures: ['median-age', 'poverty-rate'], chart: 'bars' };
  assert.deepEqual(M.clean(data, { ...base, chartMeasures: ['population-total'] }).chartMeasures, [], 'a measure that is not in the section is dropped');
  assert.deepEqual(M.clean(data, { ...base, chartMeasures: ['poverty-rate', 'median-age'] }).chartMeasures, ['median-age', 'poverty-rate']);
  assert.deepEqual(M.clean(data, { ...base, chartMeasure: 'poverty-rate' }).chartMeasures, ['poverty-rate']);
  assert.deepEqual(M.clean(data, { ...base, chart: 'none', chartMeasures: ['median-age'] }).chartMeasures, []);
  assert.deepEqual(M.clean(data, { ...base, chartMeasures: [] }).chartMeasures, [], 'an empty list stays empty');
  assert.deepEqual(M.clean(data, { ...base }).chartMeasures, ['median-age'], 'no list: the first measure');
  assert.equal(M.clean(data, { ...base, chart: 'pie' }).chart, 'none');
  assert.deepEqual(M.decode('novato|median-age.poverty-rate|a|1||b|poverty-rate', data)[0].chartMeasures, ['poverty-rate']);
});

test('the charts count toward the report\'s ten tables', () => {
  const big = { places: ['novato'], measures: data.measures.map((m) => m.id), orientation: 'places', margins: true, title: '', chart: 'bars', chartMeasures: data.measures.slice(0, 12).map((m) => m.id) };
  const r = M.buildReport(data, F, [big], {});
  assert.equal(r.tables, 1 + 12);
  assert.equal(r.sections.length, M.LIMITS.tables);
});

test('a table never has more than 12 columns', () => {
  assert.ok(M.LIMITS.across + 1 <= 12);
});
