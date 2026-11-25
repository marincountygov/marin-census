// The report a person builds in Marin Census, as data. No page access, so Node tests run it.
// A section is a table of chosen places and chosen measures: one place with many measures is a profile, several places
// are a comparison. `buildReport` turns the sections into the object the shell's report core (window.marinReports)
// makes every output from: the preview, Copy, Download and the report file.
(() => {
  const C = typeof module !== 'undefined' && module.exports ? require('./chart.js') : window.MarinCensusChart;

  // A table in a report has at most 12 columns (the shell's core), so at most 11 across after the label column. A section
  // with more across is made as several tables (part 1 of 3, ...), so nothing has to be left out. The report core holds
  // 10 tables, and a section is 4 at most.
  const LIMITS = { across: 11, sections: 4, tables: 10 };
  const CHARTS = ['none', 'bars', 'columns']; // a chart of one measure across the section's places
  const ORIENTATIONS = ['auto', 'places', 'measures']; // which of the two runs across the top; auto puts the longer one down

  // A new section. With no places given it starts on Marin County, so the preview is never empty.
  function newSection(data, places) {
    const chosen = places && places.length ? places : [data.places[0].id];
    return { title: '', places: chosen, measures: data.headlineMeasures.slice(), orientation: 'auto', margins: true, chart: 'none', chartMeasures: [] };
  }

  // Keeps only places and measures that exist, in the order of the data.
  function clean(data, s) {
    const places = data.places.map((p) => p.id).filter((id) => (s.places || []).includes(id));
    const measures = data.measures.map((m) => m.id).filter((id) => (s.measures || []).includes(id));
    return {
      title: String(s.title || '').slice(0, 200),
      places,
      measures,
      orientation: ORIENTATIONS.includes(s.orientation) ? s.orientation : 'auto',
      margins: s.margins !== false,
      chart: CHARTS.includes(s.chart) ? s.chart : 'none',
      chartMeasures: chartMeasures(s, measures),
    };
  }

  // The measures that get a chart: some of the section's own, in the order of the data. A list is kept as it is (it can be
  // empty); an older link with one `chartMeasure`, or a chart with no list at all, charts the one or the first.
  function chartMeasures(s, measures) {
    if (!s.chart || s.chart === 'none') return [];
    const wanted = Array.isArray(s.chartMeasures) ? s.chartMeasures : (s.chartMeasure ? [s.chartMeasure] : measures.slice(0, 1));
    return measures.filter((id) => wanted.includes(id));
  }

  const placeOf = (data, id) => data.places.find((p) => p.id === id);
  const variableOf = (data, id) => data.variables.find((v) => v.id === id);

  function list(names) {
    if (names.length <= 1) return names.join('');
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    if (names.length <= 3) return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
    return `${names.length} places`;
  }

  // A title for a section with none of its own.
  function autoTitle(data, s) {
    const names = s.places.map((id) => placeOf(data, id).name);
    if (s.places.length === 1) return `${names[0]}: ${s.measures.length === 1 ? variableOf(data, s.measures[0]).name : `${s.measures.length} measures`}`;
    return `${list(names)}: ${s.measures.length === 1 ? variableOf(data, s.measures[0]).name : `${s.measures.length} measures`}`;
  }

  // The text of a cell: the estimate, and its margin of error when the section shows margins.
  function cellText(F, variable, place, margins) {
    const e = F.entry(variable, place);
    return margins && e.margin ? `${e.text} ${e.margin}` : e.text;
  }

  // The raw figure of a cell for the CSV: a number, or { value, margin }, or a one-sided bound { min } / { max }. A value the
  // Census does not give is empty text, never zero.
  function cellValue(variable, place, margins) {
    const value = place.values[variable.id];
    if (!value) return '';
    if (value.v !== undefined) return margins && value.m !== undefined ? { value: value.v, margin: value.m } : value.v;
    const bound = {};
    if (value.min !== undefined) bound.min = value.min;
    if (value.max !== undefined) bound.max = value.max;
    return bound;
  }

  // Which of places and measures runs across the top. Auto puts the longer one down, so a comparison of many places
  // has a row for each place and a column for each measure.
  function acrossOf(s) {
    if (s.orientation === 'places' || s.orientation === 'measures') return s.orientation;
    return s.measures.length < s.places.length ? 'measures' : 'places';
  }

  const chunks = (list) => {
    const out = [];
    for (let i = 0; i < list.length; i += LIMITS.across) out.push(list.slice(i, i + LIMITS.across));
    return out.length ? out : [[]];
  };

  // The key a chart's picture is kept under: what it draws, so a changed chart gets a new picture.
  const chartKey = (spec) => JSON.stringify([spec.kind, spec.variable, spec.margins, spec.bars.map((b) => [b.id, b.value, b.margin])]);

  // A chart and its table. The table has the same places, in the chart's order (the places the chart leaves out come last),
  // and no title of its own: the chart has the title. A chart with no bar to draw is its sentence and the table.
  function chartTable(data, F, s, places, variable, chartImage) {
    const spec = C.spec(F, places, variable, { kind: s.chart, margins: s.margins, confidence: data.source.confidenceLevel });
    spec.key = chartKey(spec);
    const order = spec.bars.map((b) => b.id).concat(spec.omitted);
    const rowsOf = order.map((id) => placeOf(data, id));
    const table = {
      type: 'table', title: '', head: ['Place', variable.name],
      rows: rowsOf.map((p) => [p.name, cellText(F, variable, p, s.margins)]),
      values: rowsOf.map((p) => [p.name, cellValue(variable, p, s.margins)]),
      _chartSpec: spec, // for the page's own preview; the report core ignores it
    };
    if (spec.bars.length) {
      const picture = (chartImage && chartImage(spec.key)) || { image: '', width: 0, height: 0 };
      table.chart = {
        kind: spec.kind, title: spec.title, summary: spec.summary, labels: spec.bars.map((b) => b.label),
        series: [{ name: variable.name, values: spec.bars.map((b) => b.value) }],
        image: picture.image, width: picture.width, height: picture.height,
      };
    }
    return table;
  }

  // How many tables a section makes.
  function tableCount(data, raw) {
    const s = clean(data, raw);
    if (!s.places.length || !s.measures.length) return 0;
    return chunks(acrossOf(s) === 'places' ? s.places : s.measures).length + s.chartMeasures.length;
  }

  // The tables of one section for the report core: one, or several when more than 11 run across. Empty for a section
  // with nothing chosen.
  function buildSection(data, F, raw, chartImage) {
    const s = clean(data, raw);
    if (!s.places.length || !s.measures.length) return [];
    const places = s.places.map((id) => placeOf(data, id));
    const variables = s.measures.map((id) => variableOf(data, id));
    const acrossPlaces = acrossOf(s) === 'places';
    const text = (v, p) => cellText(F, v, p, s.margins);
    const rawValue = (v, p) => cellValue(v, p, s.margins);
    const title = s.title || autoTitle(data, s);
    const parts = chunks(acrossPlaces ? places : variables);
    const tables = parts.map((part, i) => {
      const name = parts.length > 1 ? `${title} (part ${i + 1} of ${parts.length})` : title;
      if (acrossPlaces) {
        return {
          type: 'table', title: name,
          head: ['Measure', ...part.map((p) => p.name)],
          rows: variables.map((v) => [v.name, ...part.map((p) => text(v, p))]),
          values: variables.map((v) => [v.name, ...part.map((p) => rawValue(v, p))]),
        };
      }
      return {
        type: 'table', title: name,
        head: ['Place', ...part.map((v) => v.name)],
        rows: places.map((p) => [p.name, ...part.map((v) => text(v, p))]),
        values: places.map((p) => [p.name, ...part.map((v) => rawValue(v, p))]),
      };
    });
    // Each charted measure follows as a chart with a table of its own: the same numbers, so the chart has its table.
    s.chartMeasures.forEach((id) => tables.push(chartTable(data, F, s, places, variableOf(data, id), chartImage)));
    return tables;
  }

  // The source line that closes every report: the dataset, and nothing else.
  function sourceOf(data) {
    const { label, url } = data.source;
    return { label, url: url || '' };
  }

  function buildReport(data, F, sections, options) {
    const opts = options || {};
    const built = sections.flatMap((s) => buildSection(data, F, s, opts.chartImage));
    return {
      title: String(opts.title || '').trim() || 'Marin Census report',
      prepared: opts.prepared || '',
      filters: '',
      sections: built.slice(0, LIMITS.tables),
      tables: built.length, // how many were made; the core holds the first LIMITS.tables
      sources: [sourceOf(data)],
    };
  }

  // The sections in the address, so Copy link shares the report: places | measures | layout | margins | title, one per
  // section, joined by ~. A list that holds every place (or every measure) is written as *.
  const title = (s) => encodeURIComponent(s.title || '').replace(/~/g, '%7E'); // encodeURIComponent leaves ~ alone, and ~ joins the sections
  const LAYOUT = { auto: 'a', places: 'p', measures: 'm' };
  const CHART_CODE = { none: 'n', bars: 'b', columns: 'c' };

  function encode(data, sections) {
    const list = (ids, all) => (ids.length === all.length ? '*' : ids.join('.'));
    return sections.map((s) => {
      const fields = [list(s.places, data.places), list(s.measures, data.measures), LAYOUT[s.orientation] || 'a', s.margins === false ? '0' : '1', title(s)];
      if (s.chart && s.chart !== 'none') fields.push(CHART_CODE[s.chart], (s.chartMeasures || []).join('.')); // a section with no chart keeps the shorter, older form
      return fields.join('|');
    }).join('~');
  }

  function decode(text, data) {
    if (!text) return [];
    const ids = (part, all) => (part === '*' ? all.map((x) => x.id) : (part || '').split('.').filter(Boolean));
    return text.split('~').slice(0, LIMITS.sections).map((part) => {
      const [places, measures, layout, margins, title_, chart, chartMeasure] = part.split('|');
      return clean(data, {
        places: ids(places, data.places),
        measures: ids(measures, data.measures),
        orientation: { a: 'auto', p: 'places', m: 'measures' }[layout] || 'auto',
        margins: margins !== '0',
        chart: { b: 'bars', c: 'columns' }[chart] || 'none',
        chartMeasures: (chartMeasure || '').split('.').filter(Boolean),
        title: (() => { try { return decodeURIComponent(title_ || ''); } catch (e) { return ''; } })(),
      });
    }).filter((s) => s.places.length && s.measures.length);
  }

  const api = { LIMITS, CHARTS, newSection, clean, autoTitle, acrossOf, tableCount, chartKey, buildSection, buildReport, sourceOf, encode, decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.MarinCensusReportModel = api;
})();
