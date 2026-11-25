// The Reports tab: build a report from sections (each a table of chosen places and measures), see it as a document, and
// copy, download or save it. One feature for comparing places, for a place's profile and for everything at once: the
// same section. The report itself is made by the shell's core (window.marinReports); assets/report-model.js turns the
// sections into the object it takes. This file is the screens and the address.
(() => {
  'use strict';

  const M = window.MarinCensusReportModel;
  const $ = (id) => document.getElementById(id);
  const DEFAULT_KINDS = ['county', 'city', 'cdp'];
  const state = { title: '', sections: [], opened: null, data: null };
  let ctx = null; // window.marinCensus once the data has loaded
  let nextUid = 1;

  const say = (text) => { $('report-status').textContent = text; };

  // A polite status for changes the preview makes. It waits for a pause, so typing is not read out key by key.
  let announceTimer = null;
  function announce(text, delay = 700) {
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      const live = $('report-announce');
      live.textContent = '';
      window.setTimeout(() => { live.textContent = text; }, 50); // a changed text is what gets read
    }, delay);
  }

  // Undo for a removed section or a reset: the report as it was, kept until the next change.
  let undo = null;
  const snapshot = () => JSON.stringify({ title: state.title, sections: state.sections, opened: state.opened });
  function offerUndo(before) {
    undo = before;
    $('undo-report').hidden = false;
  }
  function clearUndo() {
    undo = null;
    $('undo-report').hidden = true;
  }
  function restore() {
    if (!undo) return;
    const before = JSON.parse(undo);
    state.title = before.title;
    state.opened = before.opened;
    state.sections = before.sections;
    clearUndo();
    $('report-title').value = state.title;
    drawSections();
    preview();
    writeAddress();
    say('Restored.');
    announce('Restored.', 0);
    const first = $('report-sections').querySelector('summary');
    if (first) first.focus();
  }

  // ---- the address -------------------------------------------------------------------------------------------

  function readAddress() {
    const params = new URLSearchParams(window.location.search);
    state.title = params.get('rt') || '';
    const sections = M.decode(params.get('report') || '', state.data);
    if (sections.length) state.sections = sections;
  }

  function writeAddress() {
    const params = new URLSearchParams(window.location.search);
    const kept = state.sections.map((s) => M.clean(state.data, s)).filter((s) => s.places.length && s.measures.length);
    const encoded = M.encode(state.data, kept);
    // The report as it opens (one section on Marin County with the headline measures) needs no address.
    const isDefault = encoded === M.encode(state.data, [M.clean(state.data, M.newSection(state.data))]);
    if (encoded && !isDefault) params.set('report', encoded); else params.delete('report');
    if (state.title.trim()) params.set('rt', state.title.trim()); else params.delete('rt');
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, '', next);
  }

  // ---- the report --------------------------------------------------------------------------------------------

  let built = null; // the report object last made from the sections

  function currentReport() {
    if (state.opened) return state.opened;
    built = M.buildReport(state.data, ctx.F, state.sections, { title: state.title, prepared: window.marinReports.pacificToday() });
    const made = window.marinReports.create(built);
    return made.errors.length ? null : made.report;
  }

  // The preview is the report core's own HTML. Its inline styles are for pasting into Word; the page's policy does not
  // allow inline styles, so the preview drops them and the stylesheet aligns the numbers.
  function preview() {
    const report = currentReport();
    const region = $('report-preview');
    const note = $('report-note');
    note.hidden = true;
    region.removeAttribute('aria-labelledby');
    region.setAttribute('aria-label', 'Report');
    if (!report) {
      region.replaceChildren(ctx.el('p', { className: 'report-empty', textContent: 'Choose at least one place and one measure to see the report.' }));
      return;
    }
    if (!state.opened && built && built.tables > M.LIMITS.tables) {
      note.textContent = `A report holds ${M.LIMITS.tables} tables and this one needs ${built.tables}, so the last ${built.tables - M.LIMITS.tables} are left out. Choose fewer places or measures, or remove a section.`;
      note.hidden = false;
    }
    // The core's HTML is made to paste into Word: inline styles and the border, cellpadding and cellspacing attributes. The
    // page's policy forbids inline styles, and the attributes would draw a dark border unlike every other table, so the
    // preview drops them and puts each table in the same scrolling box and border style as the rest of the app.
    region.innerHTML = window.marinReports.renderHtml(report, { titleLevel: 2 }).replace(/ (style|border|cellpadding|cellspacing)="[^"]*"/g, '');
    region.querySelectorAll('table').forEach((table) => {
      const box = ctx.el('div', { className: 'table-scroll' });
      table.replaceWith(box);
      box.append(table);
    });
    // The report is a region named by its own title, so a screen reader can jump to it.
    const heading = region.querySelector('h2');
    if (heading) {
      heading.id = 'report-preview-title';
      region.removeAttribute('aria-label');
      region.setAttribute('aria-labelledby', 'report-preview-title');
    }
  }

  function changed() {
    state.opened = null;
    clearUndo();
    preview();
    writeAddress();
    const report = currentReport();
    if (!report) { announce('The report is empty. Choose at least one place and one measure.'); return; }
    const tables = report.sections.length;
    const rows = report.sections.reduce((n, section) => n + section.rows.length, 0);
    const left = built && built.tables > M.LIMITS.tables ? ` ${built.tables - M.LIMITS.tables} left out.` : '';
    announce(`Report updated: ${tables} ${tables === 1 ? 'table' : 'tables'}, ${rows} ${rows === 1 ? 'row' : 'rows'}.${left}`);
  }

  const csvText = (rows) => rows.map((row) => row.map(ctx.F.csvCell).join(',')).join('\r\n') + '\r\n';

  // ---- one section's form ------------------------------------------------------------------------------------

  function field(labelText, control, id) {
    return ctx.el('div', { className: 'app-field' }, ctx.el('label', { htmlFor: id, textContent: labelText }), control);
  }

  function checkbox(name, value, text, checked) {
    const input = ctx.el('input', { type: 'checkbox', checked });
    input.dataset[name] = value;
    return ctx.el('li', {}, ctx.el('label', {}, input, ` ${text}`));
  }

  // A "Select all" box: checked when everything it covers is, and mixed when some are.
  function selectAll(name, text) {
    const input = ctx.el('input', { type: 'checkbox' });
    input.dataset.all = name;
    input.setAttribute('aria-label', `${text} ${name}`); // "Select all places": the visible words stay in the name
    return ctx.el('label', { className: 'report-select-all' }, input, ` ${text}`);
  }

  // The area types a section's place list shows: the three the list opens with, and any other type that holds a chosen place.
  function openKinds(section) {
    const kinds = new Set(DEFAULT_KINDS);
    section.places.forEach((id) => kinds.add(state.data.places.find((p) => p.id === id).kind));
    return kinds;
  }

  // A group is described by its count, so entering "Places" says how many of the 95 are chosen.
  const describedBy = (group, countId) => { group.setAttribute('aria-describedby', countId); return group; };

  function sectionForm(section, index) {
    const data = state.data;
    const id = (name) => `report-s${section.uid}-${name}`;
    const li = ctx.el('li', { className: 'report-section' });
    li.dataset.uid = String(section.uid);
    const details = ctx.el('details', { className: 'drill' });
    details.open = section.open !== false;
    const summary = ctx.el('summary', { id: id('summary'), textContent: section.title.trim() || `Section ${index + 1}` });
    summary.dataset.summary = 'section';

    const title = ctx.el('input', { type: 'text', id: id('title'), maxLength: 200, value: section.title });
    title.dataset.field = 'title';
    const layout = ctx.el('select', { id: id('layout') }, [['auto', 'Automatic'], ['places', 'Places across the top'], ['measures', 'Measures across the top']].map(([value, text]) => ctx.el('option', { value, textContent: text, selected: section.orientation === value })));
    layout.dataset.field = 'orientation';
    layout.setAttribute('aria-describedby', 'report-layout-hint');
    const margins = ctx.el('input', { type: 'checkbox', checked: section.margins });
    margins.dataset.field = 'margins';

    // places: area types and a search narrow the list, as the list's filter column does; Select all takes what is shown
    const shownKinds = openKinds(section);
    const kindBoxes = Object.entries(data.kinds).map(([kind, label]) => {
      const input = ctx.el('input', { type: 'checkbox', checked: shownKinds.has(kind) });
      input.dataset.kind = kind;
      const count = data.places.filter((p) => p.kind === kind).length;
      return ctx.el('li', {}, ctx.el('label', {}, input, ` ${label} `, ctx.el('span', { className: 'report-muted', textContent: `(${count})` })));
    });
    const search = ctx.el('input', { type: 'search', id: id('place-search'), autocomplete: 'off' });
    search.dataset.field = 'place-search';
    const placeList = ctx.el('ul', { className: 'report-checks report-checks--places' }, data.places.map((p) => {
      const item = checkbox('place', p.id, p.name, section.places.includes(p.id));
      item.dataset.kind = p.kind;
      return item;
    }));
    const placeCount = ctx.el('p', { id: id('places-count'), className: 'report-count' });
    placeCount.dataset.count = 'places';

    // measures: all of them, or by topic. The topics are labels, not accordions: a section has one accordion, its own.
    const topics = data.topics.map((topic) => {
      const items = data.measures.filter((m) => m.topic === topic.name).map((m) => checkbox('measure', m.id, m.name, section.measures.includes(m.id)));
      return ctx.el('fieldset', { className: 'report-topic' }, ctx.el('legend', { className: 'report-topic-name', textContent: topic.name }), ctx.el('ul', { className: 'report-checks' }, items));
    });
    const measureCount = ctx.el('p', { id: id('measures-count'), className: 'report-count' });
    measureCount.dataset.count = 'measures';

    const actions = ctx.el('div', { className: 'report-section-actions' });
    [['up', 'Move up', 'arrow-up'], ['down', 'Move down', 'arrow-down'], ['remove', 'Remove section', 'trash']].forEach(([act, label, icon]) => {
      const button = ctx.el('button', { type: 'button', className: `action-button${act === 'remove' ? ' is-danger' : ''}`, title: label });
      button.dataset.act = act;
      button.dataset.icon = icon;
      button.setAttribute('aria-label', `${label}, section ${index + 1}`);
      actions.append(button);
    });

    const legend = ctx.el('legend', { textContent: section.title.trim() ? `Section ${index + 1}: ${section.title.trim()}` : `Section ${index + 1}` });
    legend.dataset.legend = 'section';
    details.append(summary,
      ctx.el('fieldset', { className: 'app-form-grid report-fields' }, legend,
        field('Title', title, id('title')),
        field('Layout', layout, id('layout')),
        ctx.el('div', { className: 'app-field' }, ctx.el('label', {}, margins, ' Show margins of error')),
        describedBy(ctx.el('fieldset', { className: 'app-field report-group' },
          ctx.el('legend', { textContent: 'Places' }),
          ctx.el('fieldset', { className: 'app-field report-kinds' }, ctx.el('legend', { textContent: 'Area types' }), ctx.el('ul', { className: 'report-checks' }, kindBoxes)),
          ctx.el('div', { className: 'search-input-field' }, ctx.el('label', { htmlFor: id('place-search'), textContent: 'Search' }), search),
          selectAll('places', 'Select all'), placeList, placeCount), id('places-count')),
        describedBy(ctx.el('fieldset', { className: 'app-field report-group' },
          ctx.el('legend', { textContent: 'Measures' }),
          selectAll('measures', 'Select all'), topics, measureCount), id('measures-count'))),
      actions);
    li.append(details);
    return li;
  }

  // Counts, the placeholder title, which places show, and the Select all boxes.
  function refresh(li, section) {
    const data = state.data;
    const total = { places: data.places.length, measures: data.measures.length };
    li.querySelector('[data-count="places"]').textContent = `${section.places.length} of ${total.places} places`;
    li.querySelector('[data-count="measures"]').textContent = `${section.measures.length} of ${total.measures} measures`;
    const title = li.querySelector('[data-field="title"]');
    const auto = section.places.length && section.measures.length ? M.autoTitle(data, M.clean(data, section)) : '';
    title.placeholder = auto;
    // The accordion's heading is the title typed in the Title field, or "Section N" until there is one. The group's name
    // for a screen reader always keeps the number, so two sections with the same title are still told apart.
    const number = state.sections.indexOf(section) + 1;
    const typed = section.title.trim();
    li.querySelector('[data-summary="section"]').textContent = typed || `Section ${number}`;
    li.querySelector('[data-legend="section"]').textContent = typed ? `Section ${number}: ${typed}` : `Section ${number}`;
    const names = { up: 'Move up', down: 'Move down', remove: 'Remove section' };
    li.querySelectorAll('[data-act]').forEach((button) => button.setAttribute('aria-label', `${names[button.dataset.act]}, section ${number}`));

    const kinds = new Set([...li.querySelectorAll('input[data-kind]')].filter((box) => box.checked).map((box) => box.dataset.kind));
    const words = li.querySelector('[data-field="place-search"]').value.trim().toLowerCase();
    let shown = 0;
    let shownChosen = 0;
    li.querySelectorAll('.report-checks--places li').forEach((item) => {
      const visible = kinds.has(item.dataset.kind) && (!words || item.textContent.toLowerCase().includes(words));
      item.hidden = !visible;
      if (visible) {
        shown += 1;
        if (item.querySelector('input').checked) shownChosen += 1;
      }
    });
    li.dataset.shown = String(shown);
    const mixed = (box, chosen, of) => { box.checked = of > 0 && chosen === of; box.indeterminate = chosen > 0 && chosen < of; };
    mixed(li.querySelector('[data-all="places"]'), shownChosen, shown);
    mixed(li.querySelector('[data-all="measures"]'), section.measures.length, total.measures);
  }

  // How many places the list shows after the area types or the search narrow it.
  function announceShown(li) {
    const n = Number(li.dataset.shown);
    announce(n === 0 ? 'No places match.' : `${n} ${n === 1 ? 'place' : 'places'} shown.`);
  }

  function drawSections() {
    const list = $('report-sections');
    list.replaceChildren(...state.sections.map((s, i) => {
      const li = sectionForm(s, i);
      refresh(li, s);
      return li;
    }));
    $('add-section').hidden = state.sections.length >= M.LIMITS.sections;
  }

  const byUid = (uid) => state.sections.find((s) => String(s.uid) === String(uid));

  // ---- events ------------------------------------------------------------------------------------------------

  function onChange(event) {
    const li = event.target.closest('.report-section');
    if (!li) return;
    const section = byUid(li.dataset.uid);
    const t = event.target;
    say('');
    if (t.dataset.place !== undefined) {
      section.places = t.checked ? [...section.places, t.dataset.place] : section.places.filter((x) => x !== t.dataset.place);
    } else if (t.dataset.measure !== undefined) {
      section.measures = t.checked ? [...section.measures, t.dataset.measure] : section.measures.filter((x) => x !== t.dataset.measure);
    } else if (t.dataset.all === 'places') {
      // Select all takes the places the list shows now (the area types and the search), and clearing leaves them out.
      const shown = [...li.querySelectorAll('.report-checks--places li')].filter((item) => !item.hidden).map((item) => item.querySelector('input').dataset.place);
      section.places = t.checked ? [...new Set([...section.places, ...shown])] : section.places.filter((id) => !shown.includes(id));
      li.querySelectorAll('.report-checks--places li').forEach((item) => { const box = item.querySelector('input'); box.checked = section.places.includes(box.dataset.place); });
    } else if (t.dataset.all === 'measures') {
      section.measures = t.checked ? state.data.measures.map((m) => m.id) : [];
      li.querySelectorAll('[data-measure]').forEach((box) => { box.checked = t.checked; });
    } else if (t.dataset.kind !== undefined) {
      refresh(li, section);
      announceShown(li);
      return; // the area types only narrow the list; the report is the same
    } else if (t.dataset.field === 'orientation') {
      section.orientation = t.value;
    } else if (t.dataset.field === 'margins') {
      section.margins = t.checked;
    } else return;
    refresh(li, section);
    changed();
  }

  function onInput(event) {
    const t = event.target;
    const li = t.closest('.report-section');
    if (!li) return;
    if (t.dataset.field === 'title') {
      const section = byUid(li.dataset.uid);
      section.title = t.value;
      refresh(li, section);
      changed();
    } else if (t.dataset.field === 'place-search') {
      refresh(li, byUid(li.dataset.uid));
      announceShown(li);
    }
  }

  function onClick(event) {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const li = button.closest('.report-section');
    const index = state.sections.findIndex((s) => String(s.uid) === li.dataset.uid);
    const move = { up: -1, down: 1 }[button.dataset.act];
    const before = snapshot();
    let said = '';
    if (button.dataset.act === 'remove') {
      state.sections.splice(index, 1);
      said = `Section ${index + 1} removed.`;
    } else if (move && state.sections[index + move]) {
      [state.sections[index], state.sections[index + move]] = [state.sections[index + move], state.sections[index]];
      said = `Section ${index + 1} moved ${move < 0 ? 'up' : 'down'}.`;
    } else return;
    drawSections();
    changed();
    say(said);
    if (button.dataset.act === 'remove') offerUndo(before);
    const target = $('report-sections').children[Math.min(index + (move || 0), state.sections.length - 1)];
    const focus = (target && target.querySelector(`[data-act="${button.dataset.act}"]`)) || $('add-section');
    if (focus) focus.focus();
  }

  function addSection() {
    if (state.sections.length >= M.LIMITS.sections) { say(`A report holds at most ${M.LIMITS.sections} sections.`); return; }
    state.sections.push({ uid: nextUid++, ...M.newSection(state.data) });
    state.opened = null;
    drawSections();
    preview();
    writeAddress();
    say(`Section ${state.sections.length} added.`);
    clearUndo();
    $('report-sections').lastElementChild.querySelector('input[type="text"]').focus();
  }

  // Reset puts the report back as it opens: one section on Marin County with the headline measures, no title, no saved
  // file open, and the address clear. Focus stays on the Reset button.
  function resetReport() {
    const before = snapshot();
    state.title = '';
    state.opened = null;
    state.sections = [{ ...M.newSection(state.data), uid: nextUid++ }];
    $('report-title').value = '';
    drawSections();
    preview();
    writeAddress();
    say('Report reset.');
    offerUndo(before);
    $('reset-report').focus();
  }

  // ---- a saved report file -----------------------------------------------------------------------------------

  async function openFile(file) {
    const { text } = await window.marinReadText(file);
    const made = window.marinReports.parseJson(text);
    if (!made.report) { say(made.errors[0] || 'That file could not be opened.'); return; }
    clearUndo();
    state.opened = made.report;
    state.title = made.report.title;
    $('report-title').value = state.title;
    preview();
    say(`Opened ${file.name}. Change a section to build a new report.`);
  }

  // ---- start -------------------------------------------------------------------------------------------------

  async function start() {
    ctx = await window.marinCensus.ready;
    state.data = ctx.data;
    state.sections = [M.newSection(state.data)];
    readAddress();
    state.sections = state.sections.map((s) => ({ ...s, uid: nextUid++ }));
    $('report-title').value = state.title;
    drawSections();
    preview();

    $('report-title').addEventListener('input', (event) => { state.title = event.target.value; changed(); });
    const list = $('report-sections');
    list.addEventListener('change', onChange);
    list.addEventListener('input', onInput);
    list.addEventListener('click', onClick);
    // toggle does not bubble: listen in the capture phase for a section opening or closing
    list.addEventListener('toggle', (event) => {
      const li = event.target.closest && event.target.closest('.report-section');
      if (li && event.target.parentElement === li) byUid(li.dataset.uid).open = event.target.open;
    }, true);
    $('reset-report').addEventListener('click', resetReport);
    $('undo-report').addEventListener('click', restore);
    $('skip-to-report').addEventListener('click', () => { const region = $('report-preview'); region.scrollIntoView({ block: 'start' }); region.focus(); });
    $('add-section').addEventListener('click', addSection);

    window.marinUpload({ button: $('open-report'), input: $('report-file'), accept: ['.json'], maxBytes: 4000000, overlay: false, onFile: openFile, onMessage: say });
    ctx.actionBar(document.querySelector('[data-actions="report"]'), {
      fileName: 'marin-census-report',
      fullscreen: '#report-preview-region',
      formats: () => {
        const report = currentReport();
        if (!report) return { text: '', html: '', markdown: '' };
        return { text: window.marinReports.toText(report), html: window.marinReports.renderHtml(report), markdown: window.marinReports.toMarkdown(report) };
      },
      csv: () => csvText(window.marinReports.csvRows(currentReport() || { sections: [] })),
      json: () => window.marinReports.toJson(currentReport() || window.marinReports.create({}).report),
    });
  }

  start();
})();
