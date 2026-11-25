// Run with: node tests/chart.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../assets/format.js');
const C = require('../assets/chart.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'census.json'), 'utf8'));
const test = (name, fn) => { fn(); console.log(`ok  ${name}`); };
const variable = (id) => data.variables.find((v) => v.id === id);
const places = (ids) => ids.map((id) => data.places.find((p) => p.id === id));

test('bars run from the highest to the lowest, with ties by name', () => {
  const s = C.spec(F, places(['san-rafael', 'novato', 'mill-valley', 'belvedere']), variable('population-total'));
  assert.deepEqual(s.bars.map((b) => b.label), ['San Rafael', 'Novato', 'Mill Valley', 'Belvedere']);
  assert.ok(s.bars.every((b, i) => i === 0 || s.bars[i - 1].value >= b.value));
});

test('the margin of error is a whisker, and none when margins are off', () => {
  const on = C.spec(F, places(['novato']), variable('median-household-income'));
  assert.ok(on.bars[0].margin > 0);
  const off = C.spec(F, places(['novato']), variable('median-household-income'), { margins: false });
  assert.equal(off.bars[0].margin, 0);
});

test('a place with no exact value is not drawn, and the sentence says so', () => {
  const s = C.spec(F, places(['belvedere', 'novato', 'san-rafael']), variable('median-household-income')); // Belvedere is "250,000 or more"
  assert.deepEqual(s.bars.map((b) => b.label).sort(), ['Novato', 'San Rafael']);
  assert.equal(s.notDrawn, 1);
  assert.match(s.summary, /1 place has no exact value and is not drawn\./);
  assert.ok(!s.bars.some((b) => b.value === 250000));
});

test('no place with a value gives a sentence and no bars, never a zero bar', () => {
  const s = C.spec(F, places(['belvedere']), variable('median-household-income'));
  assert.equal(s.bars.length, 0);
  assert.match(s.summary, /no place has an exact value to draw/);
});

test('more than 30 places show the 30 highest and say so', () => {
  const s = C.spec(F, data.places.filter((p) => p.kind === 'tract'), variable('population-total'));
  assert.equal(s.bars.length, 30);
  assert.match(s.summary, /Showing the 30 highest of 63\./);
});

test('the sentence names the highest and the lowest with their values', () => {
  const s = C.spec(F, places(['san-rafael', 'novato', 'belvedere']), variable('population-total'));
  assert.match(s.summary, /^Total population for 3 places: highest San Rafael \(60,433\), lowest Belvedere \(2,345\)\.$/);
  assert.equal(s.title, 'Total population by place (people)');
});

test('each bar has the words for its tooltip: the estimate and its margin of error', () => {
  const s = C.spec(F, places(['novato']), variable('median-age'));
  assert.match(s.bars[0].detail, /^[\d.]+ ± [\d.]+$/);
  assert.equal(C.spec(F, places(['novato']), variable('median-age'), { margins: false }).bars[0].detail, s.bars[0].text);
});

test('the visible note is only what a person needs to know about places left out', () => {
  assert.equal(C.spec(F, places(['novato']), variable('population-total')).note, '');
  assert.equal(C.spec(F, places(['belvedere', 'novato']), variable('median-household-income')).note, '1 place has no exact value and is not drawn.');
});

test('columns are the other direction of the same bars', () => {
  assert.equal(C.spec(F, places(['novato']), variable('median-age'), { kind: 'columns' }).kind, 'columns');
  assert.equal(C.spec(F, places(['novato']), variable('median-age'), { kind: 'anything' }).kind, 'bars');
});

test('the title says the unit, and the legend words come from the confidence level', () => {
  assert.equal(C.spec(F, places(['novato']), variable('poverty-rate')).title, 'Poverty rate by place (percent)');
  assert.equal(C.spec(F, places(['novato']), variable('median-household-income')).title, 'Median household income by place (dollars)');
  assert.equal(C.spec(F, places(['novato']), variable('median-age'), { confidence: 0.9 }).marginLabel, '90% margin of error');
  assert.equal(C.spec(F, places(['novato']), variable('median-age')).marginLabel, 'Margin of error');
  assert.equal(C.spec(F, places(['novato']), variable('median-age')).hasWhiskers, true);
  assert.equal(C.spec(F, places(['novato']), variable('median-age'), { margins: false }).hasWhiskers, false);
});

test('the places a chart leaves out are listed, so its table can list them last', () => {
  const s = C.spec(F, places(['belvedere', 'novato']), variable('median-household-income'));
  assert.deepEqual(s.omitted, ['belvedere']);
  const many = C.spec(F, data.places.filter((p) => p.kind === 'tract'), variable('population-total'));
  assert.equal(many.omitted.length, 63 - 30);
});
