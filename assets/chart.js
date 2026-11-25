// A bar or column chart of one measure across places, drawn the way Marin Mentions draws its charts: Chart.js on a canvas
// in an app card, with the title as the card heading and the words for a screen reader on the canvas itself.
// `spec` is pure (Node tests run it): it picks the bars, orders them and writes the sentence that says what the chart
// shows. `render` draws a spec with Chart.js; `exportImage` makes the picture Download and Copy hold.
(() => {
  const MAX_BARS = 30; // the report core holds 30 labels in a chart
  const BAR = '#0777cf'; // the blue Marin Mentions uses for its bars

  // What to draw. `places` are place records of data/census.json, `variable` the measure, `F` the formatter.
  // A place with no exact value (not available, or only "or more") is not drawn and is counted.
  const UNIT_WORDS = { percent: 'percent', persons: 'people', households: 'households', 'housing units': 'housing units', USD: 'dollars', years: 'years', 'persons per household': 'people per household' };

  function spec(F, places, variable, options) {
    const opts = options || {};
    const margins = opts.margins !== false;
    const all = places.map((place) => {
      const value = place.values[variable.id];
      const exact = value && value.v !== undefined;
      const entry = F.entry(variable, place);
      const margin = exact && margins && value.m !== undefined ? value.m : 0;
      return { label: place.name, value: exact ? value.v : null, margin, text: entry.text, detail: margin && entry.margin ? `${entry.text} ${entry.margin}` : entry.text, id: place.id };
    });
    const exact = all.filter((bar) => bar.value !== null).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'en'));
    const bars = exact.slice(0, MAX_BARS);
    const notDrawn = all.length - exact.length;
    const title = `${variable.name} by place (${UNIT_WORDS[variable.unit] || variable.unit})`;
    const first = [];
    if (bars.length) {
      const top = bars[0];
      const bottom = bars[bars.length - 1];
      first.push(bars.length === 1 ? `${variable.name}: ${top.label}, ${top.text}.` : `${variable.name} for ${bars.length} places: highest ${top.label} (${top.text}), lowest ${bottom.label} (${bottom.text}).`);
    } else {
      first.push(`${variable.name}: no place has an exact value to draw.`);
    }
    const notes = [];
    if (exact.length > MAX_BARS) notes.push(`Showing the ${MAX_BARS} highest of ${exact.length}.`);
    if (notDrawn) notes.push(`${notDrawn} ${notDrawn === 1 ? 'place has' : 'places have'} no exact value and ${notDrawn === 1 ? 'is' : 'are'} not drawn.`);
    const level = opts.confidence ? `${Math.round(opts.confidence * 100)}% margin of error` : 'Margin of error';
    return {
      kind: opts.kind === 'columns' ? 'columns' : 'bars', variable: variable.id, unit: variable.unit, title,
      summary: first.concat(notes).join(' '), note: notes.join(' '),
      bars, notDrawn, margins, marginLabel: level,
      omitted: all.filter((bar) => bar.value === null).map((bar) => bar.id).concat(exact.slice(MAX_BARS).map((bar) => bar.id)).filter((id, i, list) => list.indexOf(id) === i),
      hasWhiskers: margins && bars.some((bar) => bar.margin > 0),
    };
  }

  // ---- drawing (needs the page and Chart.js) ------------------------------------------------------------------

  // Chart.js draws its own text and grid, so it is given the page's colors, as Mentions does.
  function applyTheme(card) {
    const style = getComputedStyle(card);
    window.Chart.defaults.color = style.color;
    window.Chart.defaults.borderColor = style.borderTopColor;
  }

  // The margin of error as a whisker on each bar, and each bar's value at its end.
  const whiskers = {
    id: 'censusWhiskers',
    afterDatasetsDraw(chart, args, options) {
      const meta = chart.getDatasetMeta(0);
      const ctx = chart.ctx;
      const horizontal = chart.options.indexAxis === 'y';
      const scale = chart.scales[horizontal ? 'x' : 'y'];
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle = window.Chart.defaults.color;
      ctx.lineWidth = 1.5;
      ctx.font = '12px system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      options.bars.forEach((bar, i) => {
        const element = meta.data[i];
        if (!element) return;
        const end = scale.getPixelForValue(bar.value + bar.margin);
        if (bar.margin) {
          const a = scale.getPixelForValue(Math.max(0, bar.value - bar.margin));
          ctx.beginPath();
          if (horizontal) { ctx.moveTo(a, element.y); ctx.lineTo(end, element.y); ctx.moveTo(a, element.y - 4); ctx.lineTo(a, element.y + 4); ctx.moveTo(end, element.y - 4); ctx.lineTo(end, element.y + 4); }
          else { ctx.moveTo(element.x, a); ctx.lineTo(element.x, end); ctx.moveTo(element.x - 4, a); ctx.lineTo(element.x + 4, a); ctx.moveTo(element.x - 4, end); ctx.lineTo(element.x + 4, end); }
          ctx.stroke();
        }
        if (horizontal) { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(bar.text, end + 6, element.y); }
        else { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(bar.text, element.x, end - 6); }
      });
      ctx.restore();
    },
  };

  // Draws the chart of `chartSpec` on `canvas` (inside its own box, which sets the height). Returns the Chart.js chart.
  function render(F, canvas, chartSpec) {
    const card = canvas.closest('.app-card') || canvas;
    applyTheme(card);
    const horizontal = chartSpec.kind === 'bars';
    const box = canvas.parentElement;
    box.style.position = 'relative';
    box.style.height = `${horizontal ? Math.max(200, chartSpec.bars.length * 28 + 90) : 380}px`;
    const text = window.Chart.defaults.color;
    const legend = [{ text: 'Estimate', fillStyle: BAR, strokeStyle: BAR, lineWidth: 0, pointStyle: 'rect', fontColor: text }];
    if (chartSpec.hasWhiskers) legend.push({ text: chartSpec.marginLabel, fillStyle: text, strokeStyle: text, lineWidth: 2, pointStyle: 'line', fontColor: text });
    const valueAxis = { beginAtZero: true, ticks: { callback: (v) => F.number(chartSpec.unit, v) }, suggestedMax: Math.max(0, ...chartSpec.bars.map((b) => b.value + b.margin)) * 1.12 };
    const nameAxis = { grid: { display: false } };
    return new window.Chart(canvas, {
      type: 'bar',
      data: { labels: chartSpec.bars.map((b) => b.label), datasets: [{ data: chartSpec.bars.map((b) => b.value), backgroundColor: BAR }] },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        animation: false, // drawn at once, so the picture for Copy and Download is ready
        plugins: {
          legend: { display: true, position: 'top', align: 'start', onClick: () => {}, labels: { usePointStyle: true, generateLabels: () => legend } },
          tooltip: { callbacks: { label: (item) => chartSpec.bars[item.dataIndex].detail } },
          censusWhiskers: { bars: chartSpec.bars },
        },
        scales: horizontal ? { x: valueAxis, y: nameAxis } : { x: nameAxis, y: valueAxis },
      },
      plugins: [whiskers],
    });
  }

  // The picture of a drawn chart for Download and Copy: the chart on its card's background with its title above it (as
  // Mentions, whose picture takes the card's background so light text stays readable), small enough for the report core.
  // Resolves to { canvas, image, width, height } (image is a PNG data address, empty when it cannot be made).
  function exportImage(canvas, title) {
    const card = canvas.closest('.app-card') || canvas;
    const style = getComputedStyle(card);
    const ratio = canvas.clientWidth ? canvas.width / canvas.clientWidth : 1;
    const head = Math.round(34 * ratio);
    let out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height + head;
    const context = out.getContext('2d');
    context.fillStyle = style.backgroundColor;
    context.fillRect(0, 0, out.width, out.height);
    context.fillStyle = style.color;
    context.font = `700 ${Math.round(15 * ratio)}px system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    context.textBaseline = 'middle';
    context.fillText(title, 8 * ratio, head / 2);
    context.drawImage(canvas, 0, head);
    const width = Math.round(out.width / ratio);
    const height = Math.round(out.height / ratio);
    let image = '';
    try { image = out.toDataURL('image/png'); } catch (error) { image = ''; }
    if (image.length > 390000) { // the report core keeps a picture up to 400000 characters: draw it smaller
      const small = document.createElement('canvas');
      small.width = Math.round(out.width / 2);
      small.height = Math.round(out.height / 2);
      small.getContext('2d').drawImage(out, 0, 0, small.width, small.height);
      try { image = small.toDataURL('image/png'); } catch (error) { image = ''; }
      if (image.length > 390000) image = '';
    }
    return { canvas: out, image, width, height };
  }

  const api = { MAX_BARS, spec, render, exportImage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.MarinCensusChart = api;
})();
