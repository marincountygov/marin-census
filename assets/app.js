// Marin Census: a table of places and their statistics, and one page for each place.
// vendor/marinos/marinos.js owns the shell, the filter column and the menus. assets/format.js shows the numbers.
// Every number comes from data/census.json (built from marin-data) exactly as published; nothing is calculated here.
(() => {
  'use strict';

  const F = window.MarinCensusFormat;
  const $ = (id) => document.getElementById(id);
  const DATA_URL = 'data/census.json';
  const DEFAULT_KINDS = ['County', 'City or town', 'Census-designated place'];

  const app = {
    data: null,
    column: null,
    indicators: [],
    byId: {},
    filtered: [],
    sort: null, // { key, dir } or null for the order in the file
    place: null, // the place on show
    placeSort: null, // { dir } by measure name, or null for the order in the file
  };

  function el(tag, props = {}, ...children) {
    const node = Object.assign(document.createElement(tag), props);
    children.flat().forEach((child) => { if (child !== null && child !== undefined) node.append(child); });
    return node;
  }

  // ---- the source line ---------------------------------------------------------------------------------------

  function drawSource() {
    const { label, url, confidenceLevel } = app.data.source;
    document.querySelectorAll('[data-census-source]').forEach((p) => {
      p.replaceChildren(url ? el('a', { href: url, textContent: label }) : label, `. Margins of error are at the ${F.confidence(confidenceLevel)} confidence level.`);
    });
  }

  // ---- a cell ------------------------------------------------------------------------------------------------

  function cell(variable, place, tag = 'td') {
    const e = F.entry(variable, place);
    const node = el(tag, { className: `census-cell census-cell--${e.kind}` }, el('span', { className: 'census-value', textContent: e.text }));
    if (e.margin) node.append(el('span', { className: 'census-margin', textContent: e.margin }));
    return node;
  }

  // ---- the table of places -----------------------------------------------------------------------------------

  function columns() {
    return [
      { key: 'name', label: 'Place' },
      { key: 'kind', label: 'Area type' },
      ...app.indicators.map((v) => ({ key: v.id, label: v.name })),
    ];
  }

  function compare(a, b) {
    const { key, dir } = app.sort;
    if (key === 'name') return dir * a.name.localeCompare(b.name, 'en', { numeric: true });
    if (key === 'kind') return dir * (Object.keys(app.data.kinds).indexOf(a.kind) - Object.keys(app.data.kinds).indexOf(b.kind));
    const x = F.entry(app.byId[key], a).sort;
    const y = F.entry(app.byId[key], b).sort;
    if (x === null || y === null) return x === y ? 0 : (x === null ? 1 : -1); // no value is last, either way
    return dir * (x - y);
  }

  function drawHead() {
    const row = el('tr');
    columns().forEach((col) => {
      const th = el('th', { scope: 'col' });
      th.dataset.key = col.key;
      th.setAttribute('aria-sort', app.sort && app.sort.key === col.key ? (app.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
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
      app.indicators.forEach((v) => tr.append(cell(v, place)));
      return tr;
    });
    $('census-table').tBodies[0].replaceChildren(...rows);
  }

  // The line above the results: the count, then only the choices that narrow it beyond how the page opens.
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

  function update() {
    app.filtered = app.column.filter(app.data.places);
    if (app.sort) app.filtered = app.filtered.slice().sort(compare);
    app.column.updateCounts(app.data.places);
    app.column.setResults(app.filtered.length, resultsLine());
    drawHead();
    drawRows();
  }

  function sortBy(key) {
    if (app.sort && app.sort.key === key) app.sort = { key, dir: -app.sort.dir };
    else app.sort = { key, dir: 1 };
    update();
    const th = $('census-table').tHead.querySelector(`th[data-key="${CSS.escape(key)}"] button`);
    if (th) th.focus();
  }

  // ---- downloads ---------------------------------------------------------------------------------------------

  function download(kind, scope) {
    if (!window.marinDownload) return;
    const places = scope === 'place' && app.place ? [app.place] : app.filtered;
    const name = scope === 'place' && app.place ? `marin-census-${app.place.id}` : 'marin-census-places';
    if (kind === 'csv') {
      window.marinDownload({ content: F.csv(app.data, places), name: `${name}.csv`, type: 'text/csv' });
      return;
    }
    const content = JSON.stringify({ source: app.data.source, variables: app.data.variables, places }, null, 1) + '\n';
    window.marinDownload({ content, name: `${name}.json`, type: 'application/json' });
  }

  // ---- one place ---------------------------------------------------------------------------------------------

  function drawPlace(place) {
    app.place = place;
    $('place-heading').textContent = place.name;
    document.title = `${place.name} | Marin Census`;
    const level = F.confidence(app.data.source.confidenceLevel);
    const measure = el('th', { scope: 'col' }, el('button', { type: 'button', className: 'sort-button', textContent: 'Measure' }));
    measure.dataset.key = 'name';
    measure.setAttribute('aria-sort', app.placeSort ? (app.placeSort.dir > 0 ? 'ascending' : 'descending') : 'none');
    const head = el('tr', {}, measure, ...['Estimate', `Margin of error (${level})`, 'Out of'].map((t) => el('th', { scope: 'col', textContent: t })));
    $('place-table').tHead.replaceChildren(head);
    // Only the measure name sorts: the estimates are in different units (people, dollars, percent), so ordering them together would mean nothing.
    const measures = app.placeSort
      ? app.indicators.slice().sort((a, b) => app.placeSort.dir * a.name.localeCompare(b.name, 'en'))
      : app.indicators;
    const rows = measures.map((v) => {
      const e = F.entry(v, place);
      const estimate = el('td', { className: `census-cell census-cell--${e.kind}` }, el('span', { className: 'census-value', textContent: e.text }));
      if (e.kind === 'missing' && e.reason) estimate.append(el('span', { className: 'census-margin', textContent: e.reason }));
      const tr = el('tr', {}, el('th', { scope: 'row', textContent: v.name }), estimate, el('td', { textContent: e.margin }));
      const denominator = v.denominator && app.byId[v.denominator];
      const out = denominator ? F.entry(denominator, place) : null;
      tr.append(el('td', {}, out ? [el('span', { className: 'census-value', textContent: out.text }), el('span', { className: 'census-margin', textContent: denominator.name })] : null));
      return tr;
    });
    $('place-table').tBodies[0].replaceChildren(...rows);
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
      if (!app.place || app.place.id !== place.id) app.placeSort = null;
      drawPlace(place);
      if (focus) $('place-heading').focus();
    } else {
      document.title = 'Marin Census | County of Marin';
      if (app.column) update();
    }
  }

  function open(code) {
    window.history.pushState({}, '', `?place=${encodeURIComponent(code)}`);
    route(true);
    window.scrollTo(0, 0);
  }

  // ---- start -------------------------------------------------------------------------------------------------

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
    app.indicators = app.data.variables.filter((v) => v.role === 'indicator');
    drawSource();

    app.column = document.querySelector('[data-filter-column]');
    await new Promise((resolve) => {
      if (app.column.filter) resolve();
      else app.column.addEventListener('marin-filter-ready', resolve, { once: true });
    });
    app.column.addEventListener('marin-filter-change', update);

    $('census-table').tHead.addEventListener('click', (event) => {
      const th = event.target.closest('th[data-key]');
      if (th) sortBy(th.dataset.key);
    });
    $('census-table').tBodies[0].addEventListener('click', (event) => {
      const link = event.target.closest('a[data-place]');
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      open(link.dataset.place);
    });
    $('place-table').tHead.addEventListener('click', (event) => {
      if (!event.target.closest('th[data-key]')) return;
      app.placeSort = { dir: app.placeSort ? -app.placeSort.dir : 1 };
      drawPlace(app.place);
      $('place-table').tHead.querySelector('button').focus();
    });
    document.querySelectorAll('[data-download]').forEach((button) => button.addEventListener('click', () => download(button.dataset.download, button.dataset.scope)));
    window.addEventListener('popstate', () => route(true));

    loading.hidden = true;
    $('census-places').hidden = false;
    update();
    route(false);
  }

  document.addEventListener('DOMContentLoaded', start);
})();
