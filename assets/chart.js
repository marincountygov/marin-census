// A bar or column chart of one measure across places, with the margin of error as a whisker on each bar.
// `spec` is pure (Node tests run it): it picks the bars, orders them and writes the sentence that says what the chart
// shows. `svg` draws a spec with DOM calls that set text and numbers, never markup. In 'page' mode it is styled by the
// stylesheet (so it follows light and dark); in 'image' mode every color is an attribute, for the PNG a report holds.
(() => {
  const MAX_BARS = 30; // the report core holds 30 labels in a chart
  const IMAGE = { bar: '#1a56a0', whisker: '#1f1f1f', text: '#1f1f1f', grid: '#c9ced6', background: '#ffffff' };
  const FONT = 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  // The largest "nice" number at or above max, and four steps up to it.
  function scale(max) {
    if (!(max > 0)) return { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
    const exponent = Math.pow(10, Math.floor(Math.log10(max)));
    const f = max / exponent;
    const nice = ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((step) => f <= step)) * exponent;
    return { max: nice, ticks: [0, 1, 2, 3, 4].map((i) => (nice * i) / 4) };
  }

  // What to draw. `places` are place records of data/census.json, `variable` the measure, `F` the formatter.
  // A place with no exact value (not available, or only "or more") is not drawn and is counted.
  const UNIT_WORDS = { percent: 'percent', persons: 'people', households: 'households', 'housing units': 'housing units', USD: 'dollars', years: 'years', 'persons per household': 'people per household' };

  function spec(F, places, variable, options) {
    const opts = options || {};
    const margins = opts.margins !== false;
    const all = places.map((place) => {
      const value = place.values[variable.id];
      const exact = value && value.v !== undefined;
      return { label: place.name, value: exact ? value.v : null, margin: exact && margins && value.m !== undefined ? value.m : 0, text: F.entry(variable, place).text, id: place.id };
    });
    const exact = all.filter((bar) => bar.value !== null).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'en'));
    const bars = exact.slice(0, MAX_BARS);
    const notDrawn = all.length - exact.length;
    const axis = scale(Math.max(0, ...bars.map((bar) => bar.value + bar.margin)));
    const title = `${variable.name} by place (${UNIT_WORDS[variable.unit] || variable.unit})`;
    const parts = [];
    if (bars.length) {
      const top = bars[0];
      const bottom = bars[bars.length - 1];
      parts.push(bars.length === 1 ? `${variable.name}: ${top.label}, ${top.text}.` : `${variable.name} for ${bars.length} ${bars.length === 1 ? 'place' : 'places'}: highest ${top.label} (${top.text}), lowest ${bottom.label} (${bottom.text}).`);
    } else {
      parts.push(`${variable.name}: no place has an exact value to draw.`);
    }
    if (exact.length > MAX_BARS) parts.push(`Showing the ${MAX_BARS} highest of ${exact.length}.`);
    if (notDrawn) parts.push(`${notDrawn} ${notDrawn === 1 ? 'place has' : 'places have'} no exact value and ${notDrawn === 1 ? 'is' : 'are'} not drawn.`);
    const level = opts.confidence ? `${Math.round(opts.confidence * 100)}% margin of error` : 'Margin of error';
    return {
      kind: opts.kind === 'columns' ? 'columns' : 'bars', variable: variable.id, unit: variable.unit, title, summary: parts.join(' '),
      bars, notDrawn, axis, margins, marginLabel: level,
      omitted: all.filter((bar) => bar.value === null).map((bar) => bar.id).concat(exact.slice(MAX_BARS).map((bar) => bar.id)).filter((id, i, list) => list.indexOf(id) === i),
      hasWhiskers: margins && bars.some((bar) => bar.margin > 0),
    };
  }

  // ---- drawing (needs the page) -------------------------------------------------------------------------------

  const NS = 'http://www.w3.org/2000/svg';

  function draw(F, chartSpec, mode) {
    const image = mode === 'image';
    const el = (name, attrs, ...kids) => {
      const node = document.createElementNS(NS, name);
      Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
      kids.forEach((kid) => node.append(kid));
      return node;
    };
    // page: a class the stylesheet colors; image: the same look as attributes
    const look = (cls, attrs) => (image ? attrs : { class: cls });
    const textLook = (extra) => ({ ...(image ? { fill: IMAGE.text, 'font-family': FONT, 'font-size': 12 } : { class: 'chart-text' }), ...extra });

    const { bars, axis } = chartSpec;
    const horizontal = chartSpec.kind === 'bars';
    const tick = (value) => F.number(chartSpec.unit, value);
    const labelWidth = horizontal ? Math.min(220, Math.max(80, 7 * Math.max(0, ...bars.map((bar) => bar.label.length)))) : 0;
    const W = horizontal ? 760 : Math.max(420, 70 + bars.length * 46);
    const rowH = 26;
    const top = 62; // room for the title and the legend above the plot
    const plot = horizontal
      ? { x: labelWidth + 12, y: top, w: W - labelWidth - 64, h: bars.length * rowH }
      : { x: 70, y: top + 8, w: W - 86, h: 280 };
    const labelBand = horizontal ? 0 : Math.min(150, 24 + 6.2 * Math.max(0, ...bars.map((bar) => bar.label.length))); // room under the columns for turned names
    const H = plot.y + plot.h + (horizontal ? 36 : labelBand);
    const root = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img' });
    if (image) root.append(el('rect', { x: 0, y: 0, width: W, height: H, fill: IMAGE.background }));

    // the visible title, and a legend that says what the bar and the whisker are
    const heading = el('text', image ? { x: 8, y: 22, fill: IMAGE.text, 'font-family': FONT, 'font-size': 15, 'font-weight': 700 } : { x: 8, y: 22, class: 'chart-heading' });
    heading.textContent = chartSpec.title;
    root.append(heading);
    let legendX = 8;
    root.append(el('rect', { x: legendX, y: 36, width: 14, height: 14, ...look('chart-bar', { fill: IMAGE.bar }) }));
    const estimate = el('text', textLook({ x: legendX + 20, y: 48 }));
    estimate.textContent = 'Estimate';
    root.append(estimate);
    legendX += 20 + 7 * 'Estimate'.length + 18;
    if (chartSpec.hasWhiskers) {
      root.append(el('path', { d: `M${legendX} 43H${legendX + 22}M${legendX} 38V48M${legendX + 22} 38V48`, fill: 'none', ...look('chart-whisker', { stroke: IMAGE.whisker, 'stroke-width': 1.5 }) }));
      const margin = el('text', textLook({ x: legendX + 28, y: 48 }));
      margin.textContent = chartSpec.marginLabel;
      root.append(margin);
    }
    const along = (value) => (horizontal ? plot.x + (value / axis.max) * plot.w : plot.y + plot.h - (value / axis.max) * plot.h);

    // grid and axis labels
    axis.ticks.forEach((value) => {
      const p = along(value);
      root.append(horizontal
        ? el('line', { x1: p, y1: plot.y, x2: p, y2: plot.y + plot.h, ...look('chart-grid', { stroke: IMAGE.grid, 'stroke-width': 1 }) })
        : el('line', { x1: plot.x, y1: p, x2: plot.x + plot.w, y2: p, ...look('chart-grid', { stroke: IMAGE.grid, 'stroke-width': 1 }) }));
      const label = el('text', textLook(horizontal ? { x: p, y: plot.y + plot.h + 20, 'text-anchor': 'middle' } : { x: plot.x - 8, y: p + 4, 'text-anchor': 'end' }));
      label.textContent = tick(value);
      root.append(label);
    });

    // bars, whiskers, names
    const step = horizontal ? rowH : plot.w / Math.max(1, bars.length);
    bars.forEach((bar, i) => {
      const band = (horizontal ? plot.y : plot.x) + i * step;
      const size = Math.max(10, step * 0.62);
      const offset = band + (step - size) / 2;
      const length = (bar.value / axis.max) * (horizontal ? plot.w : plot.h);
      root.append(horizontal
        ? el('rect', { x: plot.x, y: offset, width: length, height: size, ...look('chart-bar', { fill: IMAGE.bar }) })
        : el('rect', { x: offset, y: plot.y + plot.h - length, width: size, height: length, ...look('chart-bar', { fill: IMAGE.bar }) }));
      if (bar.margin) {
        const low = Math.max(0, bar.value - bar.margin);
        const high = bar.value + bar.margin;
        const mid = offset + size / 2;
        const whisker = look('chart-whisker', { stroke: IMAGE.whisker, 'stroke-width': 1.5 });
        const a = along(low);
        const b = along(high);
        root.append(horizontal
          ? el('path', { d: `M${a} ${mid}H${b}M${a} ${mid - 4}V${mid + 4}M${b} ${mid - 4}V${mid + 4}`, fill: 'none', ...whisker })
          : el('path', { d: `M${mid} ${a}V${b}M${mid - 4} ${a}H${mid + 4}M${mid - 4} ${b}H${mid + 4}`, fill: 'none', ...whisker }));
      }
      const name = el('text', textLook(horizontal
        ? { x: plot.x - 8, y: offset + size / 2 + 4, 'text-anchor': 'end' }
        : { x: offset + size / 2, y: plot.y + plot.h + 16, 'text-anchor': 'end', transform: `rotate(-45 ${offset + size / 2} ${plot.y + plot.h + 16})` }));
      name.textContent = bar.label;
      root.append(name);
      const value = el('text', textLook(horizontal
        ? { x: Math.max(along(bar.value), along(bar.value + bar.margin)) + 6, y: offset + size / 2 + 4, 'text-anchor': 'start' }
        : { x: offset + size / 2, y: Math.min(along(bar.value), along(bar.value + bar.margin)) - 6, 'text-anchor': 'middle' }));
      value.textContent = bar.text;
      root.append(value);
    });

    // the axis line
    root.append(horizontal
      ? el('line', { x1: plot.x, y1: plot.y, x2: plot.x, y2: plot.y + plot.h, ...look('chart-axis', { stroke: IMAGE.text, 'stroke-width': 1 }) })
      : el('line', { x1: plot.x, y1: plot.y + plot.h, x2: plot.x + plot.w, y2: plot.y + plot.h, ...look('chart-axis', { stroke: IMAGE.text, 'stroke-width': 1 }) }));

    // the name and description a screen reader reads for the picture
    const titleId = `chart-title-${++drawn}`; // one for each picture drawn, so two charts never share an id
    root.insertBefore(el('desc', { id: `${titleId}-desc` }, document.createTextNode(chartSpec.summary)), root.firstChild);
    root.insertBefore(el('title', { id: titleId }, document.createTextNode(chartSpec.title)), root.firstChild);
    root.setAttribute('aria-labelledby', titleId);
    root.setAttribute('aria-describedby', `${titleId}-desc`);
    return { node: root, width: W, height: H };
  }

  let drawn = 0;

  // The picture a report holds: the chart in image mode, drawn onto a canvas, as a PNG data address. Resolves with
  // { image, width, height }, or with an empty image when it cannot be made (the sentence still goes in the report).
  function png(F, chartSpec) {
    return new Promise((resolve) => {
      try {
        const { node, width, height } = draw(F, chartSpec, 'image');
        const source = new XMLSerializer().serializeToString(node);
        const picture = new Image();
        picture.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(picture, 0, 0, width, height);
          let data = '';
          try { data = canvas.toDataURL('image/png'); } catch (error) { data = ''; }
          resolve({ image: data, width, height });
        };
        picture.onerror = () => resolve({ image: '', width, height });
        picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
      } catch (error) {
        resolve({ image: '', width: 0, height: 0 });
      }
    });
  }

  const api = { MAX_BARS, scale, spec, draw, png };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.MarinCensusChart = api;
})();
