/*
 * Shared helpers for the WIP validation tools.
 *
 * Loaded as a plain <script> in the browser (exposes `window.WIP`) and
 * require()-able from Node so the pure helpers can be unit tested.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WIP = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Collapse whitespace and case so "TD  Total cost" matches "TD Total Cost". */
  const normalizeHeader = header => String(header ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

  const toText = value => (value === null || value === undefined ? '' : String(value).trim());

  /**
   * Parse a spreadsheet cell into a number.
   * Returns null (not 0) when the cell is blank or non-numeric, so callers can
   * tell "genuinely zero" apart from "no data".
   */
  const toNumber = value => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const cleaned = String(value).replace(/[$,%\s]/g, '').replace(/^\((.*)\)$/, '-$1');
    if (cleaned === '' || cleaned === '-') return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  };

  /** Same as toNumber, but blanks become 0. Use where a missing value means zero. */
  const toNumberOr0 = value => toNumber(value) ?? 0;

  /**
   * Match the required column names against the sheet's real headers,
   * ignoring case and whitespace differences.
   *
   * Returns a map of { canonicalName: actualHeaderKey } so row lookups use the
   * exact key SheetJS produced. Throws listing every missing column at once.
   */
  const buildHeaderMap = (rows, required, reportName) => {
    if (!rows || !rows.length) throw new Error(`${reportName}: the first sheet has no data rows.`);

    const actualKeys = new Set();
    for (const row of rows.slice(0, 50)) Object.keys(row).forEach(k => actualKeys.add(k));

    const byNormalized = new Map();
    for (const key of actualKeys) {
      const norm = normalizeHeader(key);
      if (!byNormalized.has(norm)) byNormalized.set(norm, key);
    }

    const mapping = {};
    const missing = [];
    for (const name of required) {
      const actual = byNormalized.get(normalizeHeader(name));
      if (actual === undefined) missing.push(name);
      else mapping[name] = actual;
    }

    if (missing.length) {
      throw new Error(`${reportName}: missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
    }
    return mapping;
  };

  const fmtMoney = n => (n === null || n === undefined || !Number.isFinite(n) ? '—' : '$' + n.toFixed(4));
  const fmtNum = n => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(4));
  const fmtCell = v => (v === null || v === undefined ? '' : String(v));

  /* ---------- Browser-only helpers ---------- */

  const isBrowser = typeof document !== 'undefined';

  /** Read the first sheet of an .xlsx/.xls File into an array of row objects. */
  const readSheetRows = async file => {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
    const name = wb.SheetNames[0];
    if (!name) throw new Error(`${file.name}: the workbook has no sheets.`);
    return XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null });
  };

  const timestamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  const downloadCsv = (rows, baseName) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}-${timestamp()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadXlsx = (sheets, baseName) => {
    const wb = XLSX.utils.book_new();
    for (const [sheetName, rows] of Object.entries(sheets)) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName.slice(0, 31));
    }
    XLSX.writeFile(wb, `${baseName}-${timestamp()}.xlsx`);
  };

  /**
   * Wire a drop zone + hidden file input to a single callback.
   * The callback receives the chosen File, or an Error if it isn't a spreadsheet.
   */
  const wireDropZone = (zoneId, inputId, onFile) => {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    if (!zone || !input) throw new Error(`wireDropZone: missing #${zoneId} or #${inputId}`);

    const accept = file => {
      if (!file) return;
      if (!/\.(xlsx|xls)$/i.test(file.name)) {
        onFile(null, new Error(`"${file.name}" is not a .xlsx or .xls file.`));
        return;
      }
      onFile(file, null);
    };

    zone.addEventListener('dragover', event => {
      event.preventDefault();
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', event => {
      event.preventDefault();
      zone.classList.remove('dragover');
      accept(event.dataTransfer.files[0]);
    });
    input.addEventListener('change', event => accept(event.target.files[0]));
  };

  /** Build a <table> head + body from headers and row objects, safely (textContent). */
  const renderTable = (table, headers, rows, decorate) => {
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    thead.replaceChildren();
    tbody.replaceChildren();

    const headRow = document.createElement('tr');
    for (const header of headers) {
      const th = document.createElement('th');
      th.textContent = header;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);

    const frag = document.createDocumentFragment();
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const header of headers) {
        const td = document.createElement('td');
        td.textContent = fmtCell(row[header]);
        tr.appendChild(td);
      }
      if (decorate) decorate(tr, row);
      frag.appendChild(tr);
    }
    tbody.appendChild(frag);
  };

  return {
    normalizeHeader,
    toText,
    toNumber,
    toNumberOr0,
    buildHeaderMap,
    fmtMoney,
    fmtNum,
    fmtCell,
    isBrowser,
    readSheetRows,
    downloadCsv,
    downloadXlsx,
    wireDropZone,
    renderTable,
    timestamp
  };
});
