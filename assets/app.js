// Marin Census: places as cards or a table, one page for each place, and a Data tab.
// vendor/marinos/marinos.js owns the shell, the filter column and the menus. assets/format.js shows the numbers.
// Every number comes from data/census.json (built from marin-data) exactly as published; nothing is calculated here.
//
// What goes where (marin-ui "Filter column" and "Results header"):
//   filter column  Search and Area types: what narrows which places show, and nothing else
//   toolbar        sort (cards), layout (cards or table), then Copy, Copy link, Download and, last, Fullscreen
//   address        keeps the filters (the column does), the layout and the sort
// The table has a fixed set of columns, the headline measures. Choosing other measures, and comparing places, is for
// the compare and reports tool; every measure is on a place's page and in the downloads.
(() => {
  'use strict';

  const F = window.MarinCensusFormat;
  const $ = (id) => document.getElementById(id);
  const DATA_URL = 'data/census.json';
  const DEFAULT_KINDS = ['County', 'City or town', 'Census-designated place'];
  const DEFAULT_SORT = { key: 'population-total', dir: -1 };

  // What the Reports tab (assets/reports.js) uses from this file, once the data has loaded.
  let resolveReady;
  window.marinCensus = { ready: new Promise((resolve) => { resolveReady = resolve; }) };

  const app = {
    data: null,
    column: null,
    byId: {},
    layout: 'cards', // 'cards' or 'table'
    sort: DEFAULT_SORT, // { key, dir }
    shown: [], // the measures the table has columns for
    filtered: [],
    place: null, // the place on show
    fullscreenGroup: null, // the Fullscreen button of the list, which only the table has
    measureSort: null, // { key, dir } on the Data tab's table
  };

  function el(tag, props = {}, ...children) {
    const node = Object.assign(document.createElement(tag), props);
    children.flat().forEach((child) => { if (child !== null && child !== undefined) node.append(child); });
    return node;
  }

  const svg = (paths) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('viewBox', '0 0 24 24');
    node.setAttribute('aria-hidden', 'true');
    node.innerHTML = paths;
    return node;
  };

  // ---- the address -------------------------------------------------------------------------------------------
  // The filter column keeps its own choices in the address (q, kind). This keeps the layout and the sort.

  function readAddress() {
    const params = new URLSearchParams(window.location.search);
    app.layout = params.get('view') === 'table' ? 'table' : 'cards';
    const sort = params.get('sort');
    if (sort) {
      const dir = sort.startsWith('-') ? -1 : 1;
      const key = sort.replace(/^-/, '');
      if (key === 'name' || key === 'kind' || app.byId[key]) app.sort = { key, dir };
    }
  }

  function writeAddress() {
    const params = new URLSearchParams(window.location.search);
    const set = (name, value) => (value === null ? params.delete(name) : params.set(name, value));
    set('view', app.layout === 'table' ? 'table' : null);
    const isDefaultSort = app.sort.key === DEFAULT_SORT.key && app.sort.dir === DEFAULT_SORT.dir;
    set('sort', isDefaultSort ? null : `${app.sort.dir < 0 ? '-' : ''}${app.sort.key}`);
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`; // keep the hash: the shell's tabs use it
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, '', next);
  }

  // ---- the source line ---------------------------------------------------------------------------------------

  function sourceLine() {
    return app.data.source.label;
  }

  function drawSource() {
    const { label, url } = app.data.source;
    document.querySelectorAll('[data-census-source]').forEach((p) => {
      p.replaceChildren(url ? el('a', { href: url, textContent: label }) : label);
    });
  }

  // ---- the buttons above a table or a place ------------------------------------------------------------------
  // Copy, Copy link and Download, then Fullscreen in a group of its own, as every table of a Marin app has them.
  //   spec.formats()   { text, html, markdown } of what is on screen
  //   spec.csv() / spec.json()   the file contents of Download
  //   spec.fileName    the name of the files
  //   spec.fullscreen  the selector of what opens fullscreen, or none

  let menuCount = 0;

  function menu(kind, label, items) {
    const id = `${kind}-panel-${++menuCount}`;
    const toggle = el('button', { type: 'button', className: 'action-button menu-toggle', title: label }, svg(kind === 'copy'
      ? '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'
      : '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>'));
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', id);
    toggle.setAttribute('aria-label', `${label}, choose a format`);
    const caret = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    caret.setAttribute('class', 'menu-toggle__caret');
    caret.setAttribute('viewBox', '0 0 16 16');
    caret.setAttribute('aria-hidden', 'true');
    caret.innerHTML = '<path d="M4 6l4 4 4-4"/>';
    toggle.append(caret);
    const panel = el('div', { id, className: 'menu-panel', hidden: true }, items.map(([name, attribute, value]) => {
      const button = el('button', { type: 'button', textContent: name });
      button.dataset.buttonKind = 'menu-item';
      button.setAttribute(attribute, value);
      return button;
    }));
    return el('div', { className: 'menu' }, toggle, panel);
  }

  function actionBar(host, spec) {
    const status = el('span', { className: 'doc-action-status', role: 'status' });
    status.setAttribute('aria-live', 'polite');
    const share = el('button', { type: 'button', className: 'action-button', title: 'Copy link' }, svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'));
    share.setAttribute('aria-label', 'Copy link');
    // The order of every table's buttons: Copy, Copy link, Download, then Fullscreen in a group of its own.
    const actions = el('div', { className: 'doc-actions' },
      menu('copy', 'Copy', [['Text', 'data-copy-format', 'text'], ['HTML', 'data-copy-format', 'html'], ['Markdown', 'data-copy-format', 'markdown']]),
      share,
      menu('download', 'Download', [['Text', 'data-download-format', 'text'], ['HTML', 'data-download-format', 'html'], ['Markdown', 'data-download-format', 'markdown'], ['JSON', 'data-download', 'json'], ['CSV', 'data-download', 'csv']]),
      status);
    actions.dataset.fileName = spec.fileName;
    share.addEventListener('click', async () => {
      status.textContent = (await window.marinCopyText(window.location.href)) ? 'Link copied' : "Couldn't copy: copy the address bar link instead";
    });
    window.marinFormatMenus(actions, () => spec.formats(), { fileName: spec.fileName, status });
    actions.addEventListener('click', (event) => {
      const button = event.target.closest('[data-download]');
      if (!button || !window.marinDownload) return;
      const name = actions.dataset.fileName;
      if (button.dataset.download === 'csv') window.marinDownload({ content: spec.csv(), name: `${name}.csv`, type: 'text/csv' });
      else window.marinDownload({ content: spec.json(), name: `${name}.json`, type: 'application/json' });
    });
    const parts = [actions];
    let fullscreen = null;
    if (spec.fullscreen) {
      const button = el('button', { type: 'button', className: 'action-button', title: 'Fullscreen' });
      button.dataset.icon = 'maximize';
      button.dataset.fullscreenTarget = spec.fullscreen;
      button.setAttribute('aria-label', 'Fullscreen');
      fullscreen = el('div', { className: 'action-group', role: 'group' }, button);
      fullscreen.setAttribute('aria-label', 'Fullscreen');
      parts.push(fullscreen);
    }
    host.replaceWith(...parts);
    return { actions, fullscreen };
  }

  // ---- what Copy and Download hold ---------------------------------------------------------------------------

  const withMargin = (e) => (e.margin ? `${e.text} ${e.margin}` : e.text);

  function listRows() {
    if (app.layout === 'table') {
      return {
        head: ['Place', 'Area type', ...app.shown.map((v) => v.name)],
        rows: app.filtered.map((p) => [p.name, p.kindLabel, ...app.shown.map((v) => withMargin(F.entry(v, p)))]),
      };
    }
    const population = app.byId['population-total'];
    return { head: ['Place', 'Population'], rows: app.filtered.map((p) => [p.name, F.entry(population, p).text]) };
  }

  function placeRows(place) {
    const level = F.confidence(app.data.source.confidenceLevel);
    const rows = [];
    app.data.measures.forEach((m) => {
      const v = app.byId[m.id];
      const e = F.entry(v, place);
      const denominator = v.denominator && app.byId[v.denominator];
      rows.push([m.topic, v.name, e.text, e.margin, denominator ? `${F.entry(denominator, place).text} ${denominator.name}` : '']);
    });
    return { head: ['Topic', 'Measure', 'Estimate', `Margin of error (${level})`, 'Out of'], rows };
  }

  function datasetFacts() {
    const s = app.data.source;
    const nouns = { county: ['county', 'county'], city: ['city or town', 'cities and towns'], cdp: ['Census-designated place', 'Census-designated places'], tract: ['census tract', 'census tracts'] };
    const counts = Object.keys(app.data.kinds).map((kind) => { const n = app.data.places.filter((p) => p.kind === kind).length; return `${n} ${nouns[kind][n === 1 ? 0 : 1]}`; });
    return [
      ['Dataset', s.name],
      ['Publisher', s.publisher],
      ['Period', s.period.replace('/', '–')],
      ['Margin of error', `${F.confidence(s.confidenceLevel)} confidence level`],
      ['Geography', s.geographyVintage],
      ['Retrieved', s.retrieved],
      ['Areas', `${app.data.places.length}: ${counts.join(', ')}`],
      ['Measures', String(app.data.measures.length)],
    ];
  }

  function measureRows() {
    return app.data.measures.map((m) => {
      const v = app.byId[m.id];
      return [v.name, m.topic, v.description, v.unit, v.censusTables.join(', ')];
    });
  }
  const MEASURE_HEAD = ['Measure', 'Topic', 'Definition', 'Unit', 'Census table'];

  // ---- sorting -----------------------------------------------------------------------------------------------

  function compare(a, b) {
    const { key, dir } = app.sort;
    if (key === 'name') return dir * a.name.localeCompare(b.name, 'en', { numeric: true });
    if (key === 'kind') return dir * (Object.keys(app.data.kinds).indexOf(a.kind) - Object.keys(app.data.kinds).indexOf(b.kind));
    const x = F.entry(app.byId[key], a).sort;
    const y = F.entry(app.byId[key], b).sort;
    if (x === null || y === null) return x === y ? 0 : (x === null ? 1 : -1); // no value is last, either way
    return dir * (x - y);
  }

  // The two sort buttons for cards: Population and Name. Pressing the pressed one reverses it.
  const SORTS = {
    'population-total': {
      down: { label: 'Population, high to low', icon: '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/>' },
      up: { label: 'Population, low to high', icon: '<path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="M11 12h4"/><path d="M11 16h7"/><path d="M11 20h10"/>' },
    },
    name: {
      up: { label: 'Name, A to Z', icon: '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M20 8h-5"/><path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"/><path d="M15 14h5l-5 6h5"/>' },
      down: { label: 'Name, Z to A', icon: '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M15 4h5l-5 6h5"/><path d="M15 20v-3.5a2.5 2.5 0 0 1 5 0V20"/><path d="M20 18h-5"/>' },
    },
  };

  function drawSortButtons() {
    document.querySelectorAll('#sort-group [data-sort]').forEach((button) => {
      const key = button.dataset.sort;
      const pressed = app.sort.key === key;
      // Not pressed: the button offers its natural order. Pressed: it shows the order now on, and pressing it reverses it.
      const natural = key === 'name' ? 1 : -1;
      const dir = pressed ? app.sort.dir : natural;
      const spec = SORTS[key][dir > 0 ? 'up' : 'down'];
      button.setAttribute('aria-pressed', String(pressed));
      button.setAttribute('aria-label', spec.label);
      button.title = spec.label;
      button.querySelector('svg').innerHTML = spec.icon;
    });
  }

  // ---- cards -------------------------------------------------------------------------------------------------

  function drawCards() {
    const population = app.byId['population-total'];
    const cards = app.filtered.map((place) => {
      const link = el('a', { href: `?place=${encodeURIComponent(place.id)}`, textContent: place.name });
      link.dataset.place = place.id;
      const figure = el('dl', { className: 'capital-figures' }, el('div', {}, el('dt', { textContent: 'Population' }), el('dd', { textContent: F.entry(population, place).text })));
      return el('li', { className: 'app-card mm-card' }, el('h3', { className: 'mm-card__title' }, link), figure);
    });
    $('census-cards').replaceChildren(...cards);
  }

  // ---- the table ---------------------------------------------------------------------------------------------

  // The table's columns are fixed: the headline measures, in the order of topics.json.
  function shownMeasures() {
    return app.data.measures.filter((m) => app.data.headlineMeasures.includes(m.id)).map((m) => app.byId[m.id]);
  }

  function columnsOfTable() {
    return [
      { key: 'name', label: 'Place' },
      { key: 'kind', label: 'Area type' },
      ...app.shown.map((v) => ({ key: v.id, label: v.name })),
    ];
  }

  function cell(variable, place) {
    const e = F.entry(variable, place);
    const node = el('td', { className: `census-cell census-cell--${e.kind}` }, el('span', { className: 'census-value', textContent: e.text }));
    if (e.margin) node.append(el('span', { className: 'census-margin', textContent: e.margin }));
    return node;
  }

  function drawHead() {
    const row = el('tr');
    columnsOfTable().forEach((col) => {
      const th = el('th', { scope: 'col' });
      th.dataset.key = col.key;
      th.setAttribute('aria-sort', app.sort.key === col.key ? (app.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
      th.append(el('button', { type: 'button', className: 'sort-button', textContent: col.label }));
      row.append(th);
    });
    $('census-table').tHead.replaceChildren(row);
  }

  function drawRows() {
    const rows = app.filtered.map((place) => {
      const tr = el('tr');
      const link = el('a', { href: `?place=${encodeURIComponent(place.id)}`, textContent: place.name });
      link.dataset.place = place.id;
      tr.append(el('th', { scope: 'row' }, link), el('td', { textContent: place.kindLabel }));
      app.shown.forEach((v) => tr.append(cell(v, place)));
      return tr;
    });
    $('census-table').tBodies[0].replaceChildren(...rows);
  }

  // ---- the line above the results ----------------------------------------------------------------------------

  // The count, then only the choices that narrow it beyond how the page opens.
  function resultsLine() {
    const state = app.column.filterState;
    const kinds = (state.groups && state.groups.kind) || [];
    const all = Object.values(app.data.kinds);
    const narrowed = kinds.length && kinds.length < all.length && !(kinds.length === DEFAULT_KINDS.length && DEFAULT_KINDS.every((k) => kinds.includes(k)));
    const filters = [];
    if (narrowed) filters.push(window.marinResultsLine.values(kinds, ' or '));
    if (state.search && state.search.trim()) filters.push(`“${state.search.trim()}”`);
    return window.marinResultsLine({ count: window.marinResultsLine.count(app.filtered.length, 'place', 'places'), filters });
  }

  // ---- put it on the page ------------------------------------------------------------------------------------

  function showLayout() {
    const table = app.layout === 'table';
    $('census-cards').hidden = table;
    $('census-table-scroll').hidden = !table;
    $('sort-group').hidden = table; // the table sorts from its headings
    if (app.fullscreenGroup) app.fullscreenGroup.hidden = !table;
    document.querySelectorAll('[data-layout]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.layout === app.layout)));
  }

  function update() {
    app.shown = shownMeasures();
    app.filtered = app.column.filter(app.data.places).slice().sort(compare);
    app.column.updateCounts(app.data.places);
    app.column.setResults(app.filtered.length, resultsLine());
    showLayout();
    drawSortButtons();
    if (app.layout === 'table') { drawHead(); drawRows(); } else { drawCards(); }
    writeAddress();
  }

  // A sort button of the cards starts at its natural order (name A to Z, population high to low); a table heading starts ascending.
  function setSort(key, first) {
    if (app.sort.key === key) app.sort = { key, dir: -app.sort.dir };
    else app.sort = { key, dir: first };
    update();
  }

  function setLayout(layout) {
    if (app.layout === layout) return;
    app.layout = layout;
    update();
  }

  // ---- one place ---------------------------------------------------------------------------------------------

  // One table for each topic, each with a heading and a caption, so a screen reader can move from table to table and
  // hear what each is. The rows are the measures in the order of topics.json: they are in different units (people,
  // dollars, percent), so there is nothing to sort.
  function drawPlace(place) {
    app.place = place;
    $('place-heading').textContent = place.name;
    document.title = `${place.name} | Marin Census`;
    const level = F.confidence(app.data.source.confidenceLevel);
    const tables = app.data.topics.map((topic) => {
      const head = el('tr', {}, ...['Measure', 'Estimate', `Margin of error (${level})`, 'Out of'].map((t) => el('th', { scope: 'col', textContent: t })));
      const body = el('tbody');
      app.data.measures.filter((m) => m.topic === topic.name).forEach((m) => {
        const v = app.byId[m.id];
        const e = F.entry(v, place);
        const estimate = el('td', { className: `census-cell census-cell--${e.kind}` }, el('span', { className: 'census-value', textContent: e.text }));
        if (e.kind === 'missing' && e.reason) estimate.append(el('span', { className: 'census-margin', textContent: e.reason }));
        const tr = el('tr', {}, el('th', { scope: 'row', textContent: v.name }), estimate, el('td', { textContent: e.margin }));
        const denominator = v.denominator && app.byId[v.denominator];
        const out = denominator ? F.entry(denominator, place) : null;
        tr.append(el('td', {}, out ? [el('span', { className: 'census-value', textContent: out.text }), el('span', { className: 'census-margin', textContent: denominator.name })] : null));
        body.append(tr);
      });
      const table = el('table', {}, el('caption', { className: 'visually-hidden', textContent: `${place.name}: ${topic.name}` }), el('thead', {}, head), body);
      return el('section', { className: 'place-topic' }, el('h3', { textContent: topic.name }), el('div', { className: 'table-scroll' }, table));
    });
    $('place-tables').replaceChildren(...tables);
  }

  // ---- the Data tab ------------------------------------------------------------------------------------------

  function drawData() {
    const facts = datasetFacts().map(([name, value]) => {
      const content = name === 'Dataset' && app.data.source.url ? el('a', { href: app.data.source.url, textContent: value }) : value;
      return [el('dt', { textContent: name }), el('dd', {}, content)];
    });
    $('dataset-facts').replaceChildren(el('dl', { className: 'details' }, facts.flat()));
    drawMeasureTable();
  }

  function drawMeasureTable() {
    const sortable = ['Topic', 'Unit', 'Census table']; // columns whose values repeat; a measure's name is its own
    const head = el('tr');
    MEASURE_HEAD.forEach((name, i) => {
      const th = el('th', { scope: 'col' });
      if (sortable.includes(name)) {
        th.dataset.column = String(i);
        th.setAttribute('aria-sort', app.measureSort && app.measureSort.key === i ? (app.measureSort.dir > 0 ? 'ascending' : 'descending') : 'none');
        th.append(el('button', { type: 'button', className: 'sort-button', textContent: name }));
      } else th.textContent = name;
      head.append(th);
    });
    $('measures-table').tHead.replaceChildren(head);
    let rows = measureRows();
    if (app.measureSort) rows = rows.slice().sort((a, b) => app.measureSort.dir * a[app.measureSort.key].localeCompare(b[app.measureSort.key], 'en'));
    $('measures-table').tBodies[0].replaceChildren(...rows.map((row) => el('tr', {}, el('th', { scope: 'row', textContent: row[0] }), row.slice(1).map((text) => el('td', { textContent: text })))));
  }

  // ---- the tabs ----------------------------------------------------------------------------------------------
  // The shell shows the section the hash names and marks its own navigation. This marks #page-tabs the same way.

  const TAB_TITLES = { start: 'Places', reports: 'Reports', data: 'Data' };
  const currentTab = () => ({ '#data': 'data', '#reports': 'reports' }[window.location.hash] || 'start');

  // The page title names the tab (WCAG 2.4.2); a place's own page names the place.
  function setPageTitle() {
    const tab = currentTab();
    const place = new URLSearchParams(window.location.search).get('place');
    if (tab === 'start' && place && app.place) document.title = `${app.place.name} | Marin Census`;
    else document.title = tab === 'start' ? 'Marin Census | County of Marin' : `${TAB_TITLES[tab]} | Marin Census`;
  }

  function syncPageTabs() {
    const current = currentTab();
    setPageTitle();
    document.querySelectorAll('#page-tabs a[data-tab]').forEach((link) => {
      if (link.dataset.tab === current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  // ---- which screen ------------------------------------------------------------------------------------------

  function route(focus) {
    const code = new URLSearchParams(window.location.search).get('place');
    const place = code && app.data.places.find((p) => p.id === code);
    $('census-error').hidden = !(code && !place);
    if (code && !place) $('census-error').textContent = 'Marin Census could not find that place.';
    $('census-place').hidden = !place;
    $('census-places').hidden = Boolean(place);
    if (place) {
      drawPlace(place);
      if (focus) $('place-heading').focus();
    } else {
      setPageTitle();
      if (app.column) update();
    }
  }

  function open(code) {
    window.history.pushState({}, '', `?place=${encodeURIComponent(code)}`);
    route(true);
    window.scrollTo(0, 0);
  }

  // ---- tables that scroll sideways ---------------------------------------------------------------------------
  // A box that scrolls must be reachable by keyboard (WCAG 2.1.1): when its table is wider than it, the box takes a tab
  // stop, a region role and the table's name. A box that does not scroll takes none, so there are no needless stops.

  function markScrollBox(box) {
    const table = box.querySelector('table');
    const caption = table && table.querySelector('caption');
    const name = ((caption && caption.textContent) || (table && table.getAttribute('aria-label')) || '').trim();
    if (name && box.scrollWidth > box.clientWidth + 1) {
      box.tabIndex = 0;
      box.setAttribute('role', 'region');
      box.setAttribute('aria-label', name);
    } else {
      box.removeAttribute('tabindex');
      box.removeAttribute('role');
      box.removeAttribute('aria-label');
    }
  }

  function watchScrollBoxes() {
    const seen = new WeakSet();
    const sizes = new ResizeObserver((entries) => entries.forEach((entry) => markScrollBox(entry.target.closest('.table-scroll') || entry.target)));
    const scan = () => document.querySelectorAll('.table-scroll').forEach((box) => {
      if (!seen.has(box)) {
        seen.add(box);
        sizes.observe(box);
        const table = box.querySelector('table');
        if (table) sizes.observe(table);
      }
      markScrollBox(box);
    });
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => { queued = false; scan(); });
    }).observe(document.body, { childList: true, subtree: true });
    scan();
  }

  // ---- start -------------------------------------------------------------------------------------------------

  function wireActionBars() {
    const find = (name) => document.querySelector(`[data-actions="${name}"]`);
    const placeJson = (places) => JSON.stringify({ source: app.data.source, variables: app.data.variables, places }, null, 1) + '\n';
    const listFormats = () => { const { head, rows } = listRows(); return F.formats('Marin places', head, rows, sourceLine()); };
    const places = find('places');
    const list = actionBar(places, {
      fileName: places.dataset.fileName,
      fullscreen: places.dataset.fullscreenTarget,
      formats: listFormats,
      csv: () => F.csv(app.data, app.filtered),
      json: () => placeJson(app.filtered),
    });
    app.fullscreenGroup = list.fullscreen;
    const place = find('place');
    const placeBar = actionBar(place, {
      fileName: 'marin-census-place',
      fullscreen: place.dataset.fullscreenTarget,
      formats: () => { const { head, rows } = placeRows(app.place); return F.formats(app.place.name, head, rows, sourceLine()); },
      csv: () => F.csv(app.data, [app.place]),
      json: () => placeJson([app.place]),
    });
    // The place's files are named for the place.
    placeBar.actions.addEventListener('click', () => { placeBar.actions.dataset.fileName = `marin-census-${app.place.id}`; }, true);
    actionBar(find('dataset'), {
      fileName: 'marin-census-all-places',
      formats: () => F.formats('Dataset', ['Item', 'Value'], datasetFacts(), sourceLine()),
      csv: () => F.csv(app.data, app.data.places),
      json: () => placeJson(app.data.places),
    });
    const measures = find('measures');
    actionBar(measures, {
      fileName: 'marin-census-measures',
      fullscreen: measures.dataset.fullscreenTarget,
      formats: () => F.formats('Measures', MEASURE_HEAD, measureRows()),
      csv: () => F.rowsCsv(MEASURE_HEAD, measureRows()),
      json: () => JSON.stringify(app.data.measures.map((m) => app.byId[m.id]), null, 1) + '\n',
    });
  }

  async function start() {
    const loading = $('census-loading');
    try {
      const response = await fetch(DATA_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      app.data = await response.json();
    } catch (error) {
      loading.hidden = true;
      $('census-error').hidden = false;
      return;
    }
    app.byId = Object.fromEntries(app.data.variables.map((v) => [v.id, v]));
    readAddress();
    drawSource();
    drawData();
    wireActionBars();
    Object.assign(window.marinCensus, { data: app.data, F, el, svg, actionBar });
    resolveReady(window.marinCensus);
    watchScrollBoxes();
    syncPageTabs();
    window.addEventListener('hashchange', syncPageTabs);
    // Places is home: a link to ./ (a fresh page, like the title), so it leaves a place's page and clears the filters.
    document.querySelector('#page-tabs').addEventListener('click', (event) => {
      if (event.target.closest("a[href^='#']")) window.scrollTo({ top: 0, behavior: 'instant' });
    });

    app.column = document.querySelector('[data-filter-column]');
    await new Promise((resolve) => {
      if (app.column.filter) resolve();
      else app.column.addEventListener('marin-filter-ready', resolve, { once: true });
    });
    app.column.addEventListener('marin-filter-change', update);

    document.querySelectorAll('#sort-group [data-sort]').forEach((button) => button.addEventListener('click', () => setSort(button.dataset.sort, button.dataset.sort === 'name' ? 1 : -1)));
    document.querySelectorAll('[data-layout]').forEach((button) => button.addEventListener('click', () => setLayout(button.dataset.layout)));
    $('census-table').tHead.addEventListener('click', (event) => {
      const th = event.target.closest('th[data-key]');
      if (!th) return;
      setSort(th.dataset.key, 1);
      const again = $('census-table').tHead.querySelector(`th[data-key="${CSS.escape(th.dataset.key)}"] button`);
      if (again) again.focus();
    });
    $('measures-table').tHead.addEventListener('click', (event) => {
      const th = event.target.closest('th[data-column]');
      if (!th) return;
      const key = Number(th.dataset.column);
      app.measureSort = { key, dir: app.measureSort && app.measureSort.key === key ? -app.measureSort.dir : 1 };
      drawMeasureTable();
      $('measures-table').tHead.querySelector(`th[data-column="${key}"] button`).focus();
    });
    const openPlace = (event) => {
      const link = event.target.closest('a[data-place]');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      open(link.dataset.place);
    };
    $('census-table').tBodies[0].addEventListener('click', openPlace);
    $('census-cards').addEventListener('click', openPlace);
    window.addEventListener('popstate', () => { readAddress(); route(true); });

    loading.hidden = true;
    $('census-places').hidden = false;
    update();
    route(false);
  }

  document.addEventListener('DOMContentLoaded', start);
})();
