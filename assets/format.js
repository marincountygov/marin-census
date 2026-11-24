// How a statistic is shown. Pure functions, no page access, so tests can run them in Node.
// The numbers in data/census.json are exactly what the Census published; rounding happens only here, for display.
(() => {
  const group = (n) => Math.round(n).toLocaleString("en-US");
  const fixed = (n, digits) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

  // One number in the unit of its variable: 257,969 · 47.4 years · $149,091 · 8.3%
  function number(unit, n) {
    if (unit === "USD") return `$${group(n)}`;
    if (unit === "percent") return `${fixed(n, 1)}%`;
    if (unit === "years") return fixed(n, 1);
    if (unit === "persons per household") return fixed(n, 2);
    return group(n);
  }

  // What a place's value for one variable looks like: { text, margin, sort, kind }.
  //   an estimate         { text: "$149,091", margin: "± $4,474", kind: "estimate" }
  //   an open-ended value { text: "$250,000 or more", margin: "", kind: "bound" }  (never the bound as an exact number)
  //   no value            { text: "Not available", margin: "", kind: "missing", reason }
  function entry(variable, place) {
    const value = place.values[variable.id];
    if (!value) return { text: "Not available", margin: "", sort: null, kind: "missing", reason: place.unavailable[variable.id] || "" };
    if (value.v !== undefined) {
      const margin = value.m !== undefined ? `± ${number(variable.unit, value.m)}` : "";
      return { text: number(variable.unit, value.v), margin, sort: value.v, kind: "estimate" };
    }
    if (value.min !== undefined) return { text: `${number(variable.unit, value.min)} or more`, margin: "", sort: value.min, kind: "bound" };
    return { text: `${number(variable.unit, value.max)} or less`, margin: "", sort: value.max, kind: "bound" };
  }

  // "90%" from a confidence level of 0.9
  const confidence = (level) => `${Math.round(level * 100)}%`;

  // One CSV cell: quoted when it holds a comma, a quote or a line break.
  const csvCell = (value) => {
    const text = value === undefined || value === null ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  // The places as long-form CSV, one row for each place and measure, with the numbers exactly as published.
  function csv(data, places) {
    const header = ["place", "area_type", "census_geoid", "measure", "estimate", "margin_of_error", "lower_bound", "upper_bound", "unit", "period", "source", "not_available_reason"];
    const rows = [header];
    places.forEach((place) => {
      data.variables.forEach((variable) => {
        const value = place.values[variable.id] || {};
        rows.push([
          place.name, place.kindLabel, place.geoid, variable.name,
          value.v, value.m, value.min, value.max,
          variable.unit, data.source.period, data.source.label,
          place.values[variable.id] ? "" : place.unavailable[variable.id] || "",
        ]);
      });
    });
    return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  }

  const escapeHtml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const mdCell = (value) => String(value).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

  // A table as the three formats every Copy and Download menu offers (Text, HTML, Markdown). `rows` are arrays of text.
  // `source` is a line of text (or empty) that follows the table. No classes or styles: it pastes cleanly into a CMS or Word.
  function formats(title, head, rows, source = "") {
    const html = `<h2>${escapeHtml(title)}</h2>` +
      `<table><thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>` +
      `<tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>` +
      (source ? `<p>${escapeHtml(source)}</p>` : "");
    const markdown = `## ${title}\n\n| ${head.map(mdCell).join(" | ")} |\n| ${head.map(() => "---").join(" | ")} |\n` +
      rows.map((row) => `| ${row.map(mdCell).join(" | ")} |`).join("\n") + (source ? `\n\n${source}` : "") + "\n";
    const text = `${title}\n\n${[head, ...rows].map((row) => row.join("\t")).join("\n")}` + (source ? `\n\n${source}` : "") + "\n";
    return { text, html, markdown };
  }

  // Any table as CSV, for the tables that are not places (the measures, the dataset).
  const rowsCsv = (head, rows) => [head, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";

  const api = { number, entry, confidence, csvCell, csv, formats, rowsCsv };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.MarinCensusFormat = api;
})();
