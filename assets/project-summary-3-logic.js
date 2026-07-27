/*
 * Pure diff logic for the Project Summary 3 WIP report.
 * No DOM access — exported for the browser (window.PS3) and for Node tests.
 */
(function (root, factory) {
  const common = typeof module === 'object' && module.exports ? require('./wip-common.js') : root.WIP;
  const api = factory(common);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PS3 = api;
})(typeof self !== 'undefined' ? self : this, function (WIP) {
  'use strict';

  const KEY_COLUMN = 'ProjectId';

  const VALUE_COLUMNS = [
    'TD Total Cost',
    'TD Vendor Bill Cost',
    'TD Labor Cost',
    'TD Burden Cost',
    'TD Invoice Equipment Cost',
    'TD Invoice Material Cost',
    'TD Payroll Adjustments',
    'TD Vendor Return',
    'TD Invoice Billed',
    'TD Invoice Revenue',
    'TD Earned Revenue',
    'TD % Complete Cost',
    'TD Est. Total Cost',
    'TD Contract Value'
  ];

  const REQUIRED_COLUMNS = [KEY_COLUMN, ...VALUE_COLUMNS];

  /* Guards against float noise like 1e-13 showing up as a "difference". */
  const FLOAT_EPSILON = 1e-9;

  /**
   * Index rows by ProjectId. Later rows win (matching the previous behaviour),
   * but duplicates are reported so silently-dropped rows are visible.
   */
  const indexByKey = (rows, mapping) => {
    const byKey = new Map();
    const duplicates = new Map();

    for (const row of rows) {
      const key = WIP.toText(row[mapping[KEY_COLUMN]]);
      if (key === '') continue;
      if (byKey.has(key)) duplicates.set(key, (duplicates.get(key) ?? 1) + 1);
      byKey.set(key, row);
    }
    return { byKey, duplicates };
  };

  /**
   * Compare two Project Summary 3 exports.
   *
   * @param {object[]} oldRows  rows from the old workbook
   * @param {object[]} newRows  rows from the new workbook
   * @param {{tolerance?: number}} options
   *        tolerance — absolute difference at or below which values count as equal.
   *        Defaults to 0 (exact), i.e. every real difference is reported.
   */
  const buildDiff = (oldRows, newRows, options = {}) => {
    const tolerance = Math.max(Number(options.tolerance) || 0, FLOAT_EPSILON);

    const oldMap = WIP.buildHeaderMap(oldRows, REQUIRED_COLUMNS, 'Old report');
    const newMap = WIP.buildHeaderMap(newRows, REQUIRED_COLUMNS, 'New report');

    const oldSide = indexByKey(oldRows, oldMap);
    const newSide = indexByKey(newRows, newMap);

    const allKeys = [...new Set([...oldSide.byKey.keys(), ...newSide.byKey.keys()])]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const columnStats = Object.fromEntries(
      VALUE_COLUMNS.map(col => [col, { diffCount: 0, netDelta: 0, maxAbsDelta: 0, nonNumericDiffs: 0 }])
    );

    const diffRows = [];
    const presenceRows = [];
    let matchingKeys = 0;
    let missingInOld = 0;
    let missingInNew = 0;
    let rowsWithDiffs = 0;

    for (const key of allKeys) {
      const oldRow = oldSide.byKey.get(key);
      const newRow = newSide.byKey.get(key);

      if (!oldRow || !newRow) {
        if (!oldRow) {
          missingInOld += 1;
          presenceRows.push({ [KEY_COLUMN]: key, Presence: 'Missing in Old Report' });
        } else {
          missingInNew += 1;
          presenceRows.push({ [KEY_COLUMN]: key, Presence: 'Missing in New Report' });
        }
        continue;
      }

      matchingKeys += 1;

      const out = { [KEY_COLUMN]: key };
      let rowHasDiff = false;

      for (const col of VALUE_COLUMNS) {
        const oldVal = oldRow[oldMap[col]];
        const newVal = newRow[newMap[col]];
        const oldNum = WIP.toNumber(oldVal);
        const newNum = WIP.toNumber(newVal);

        out[`${col} (Old)`] = WIP.fmtCell(oldVal);
        out[`${col} (New)`] = WIP.fmtCell(newVal);

        let diffValue = '';
        let hasDiff = false;

        if (oldNum !== null && newNum !== null) {
          const delta = newNum - oldNum;
          hasDiff = Math.abs(delta) > tolerance;
          if (hasDiff) {
            diffValue = delta;
            columnStats[col].netDelta += delta;
            columnStats[col].maxAbsDelta = Math.max(columnStats[col].maxAbsDelta, Math.abs(delta));
          }
        } else if (WIP.fmtCell(oldVal) !== WIP.fmtCell(newVal)) {
          // One or both sides are blank or non-numeric — show the transition.
          hasDiff = true;
          diffValue = `${WIP.fmtCell(oldVal) || '(blank)'} → ${WIP.fmtCell(newVal) || '(blank)'}`;
          columnStats[col].nonNumericDiffs += 1;
        }

        out[`${col} (Diff)`] = diffValue;
        if (hasDiff) {
          columnStats[col].diffCount += 1;
          rowHasDiff = true;
        }
      }

      out['Diff Found'] = rowHasDiff ? 'Yes' : 'No';
      if (rowHasDiff) rowsWithDiffs += 1;
      diffRows.push(out);
    }

    const duplicateKeys = [
      ...[...oldSide.duplicates.keys()].map(k => ({ [KEY_COLUMN]: k, Report: 'Old', Occurrences: oldSide.duplicates.get(k) })),
      ...[...newSide.duplicates.keys()].map(k => ({ [KEY_COLUMN]: k, Report: 'New', Occurrences: newSide.duplicates.get(k) }))
    ];

    const exportHeaders = [
      KEY_COLUMN,
      ...VALUE_COLUMNS.flatMap(col => [`${col} (Old)`, `${col} (New)`, `${col} (Diff)`]),
      'Diff Found'
    ];

    return {
      diffRows,
      presenceRows,
      duplicateKeys,
      exportHeaders,
      tolerance,
      overview: {
        oldRowCount: oldRows.length,
        newRowCount: newRows.length,
        matchingKeys,
        missingInOld,
        missingInNew,
        rowsWithDiffs,
        allKeysFoundInBoth: missingInOld === 0 && missingInNew === 0,
        columnStats
      }
    };
  };

  return { KEY_COLUMN, VALUE_COLUMNS, REQUIRED_COLUMNS, FLOAT_EPSILON, buildDiff };
});
