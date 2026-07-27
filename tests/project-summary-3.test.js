const test = require('node:test');
const assert = require('node:assert/strict');
const PS3 = require('../assets/project-summary-3-logic.js');

/** Build a full Project Summary 3 row; every value column defaults to 0. */
const row = (projectId, overrides = {}) => {
  const out = { ProjectId: projectId };
  for (const col of PS3.VALUE_COLUMNS) out[col] = 0;
  return Object.assign(out, overrides);
};

test('identical reports produce no differences', () => {
  const rows = [row('P1', { 'TD Total Cost': 100 }), row('P2', { 'TD Total Cost': 200 })];
  const { overview, diffRows } = PS3.buildDiff(rows, rows.map(r => ({ ...r })));

  assert.equal(overview.matchingKeys, 2);
  assert.equal(overview.rowsWithDiffs, 0);
  assert.equal(overview.allKeysFoundInBoth, true);
  assert.equal(overview.columnStats['TD Total Cost'].diffCount, 0);
  assert.ok(diffRows.every(r => r['Diff Found'] === 'No'));
});

test('numeric differences are counted with net delta and largest change', () => {
  const oldRows = [row('P1', { 'TD Total Cost': 100 }), row('P2', { 'TD Total Cost': 500 })];
  const newRows = [row('P1', { 'TD Total Cost': 150 }), row('P2', { 'TD Total Cost': 480 })];
  const { overview, diffRows } = PS3.buildDiff(oldRows, newRows);

  const stats = overview.columnStats['TD Total Cost'];
  assert.equal(stats.diffCount, 2);
  assert.equal(stats.netDelta, 30); // +50 and -20
  assert.equal(stats.maxAbsDelta, 50);
  assert.equal(overview.rowsWithDiffs, 2);
  assert.equal(diffRows[0]['TD Total Cost (Diff)'], 50);
  assert.equal(diffRows[1]['TD Total Cost (Diff)'], -20);
});

test('floating point noise is not reported as a difference', () => {
  const oldRows = [row('P1', { 'TD Total Cost': 0.1 + 0.2 })];
  const newRows = [row('P1', { 'TD Total Cost': 0.3 })];
  const { overview } = PS3.buildDiff(oldRows, newRows);

  assert.equal(overview.columnStats['TD Total Cost'].diffCount, 0);
});

test('tolerance suppresses sub-threshold differences', () => {
  const oldRows = [row('P1', { 'TD Total Cost': 100 })];
  const newRows = [row('P1', { 'TD Total Cost': 100.004 })];

  assert.equal(PS3.buildDiff(oldRows, newRows).overview.columnStats['TD Total Cost'].diffCount, 1);
  assert.equal(
    PS3.buildDiff(oldRows, newRows, { tolerance: 0.005 }).overview.columnStats['TD Total Cost'].diffCount,
    0
  );
});

test('ProjectIds missing from either side land in presence rows, not the diff', () => {
  const oldRows = [row('P1'), row('P2')];
  const newRows = [row('P2'), row('P3')];
  const { overview, presenceRows, diffRows } = PS3.buildDiff(oldRows, newRows);

  assert.equal(overview.matchingKeys, 1);
  assert.equal(overview.missingInNew, 1);
  assert.equal(overview.missingInOld, 1);
  assert.equal(overview.allKeysFoundInBoth, false);
  assert.equal(diffRows.length, 1);
  assert.deepEqual(
    presenceRows.map(r => [r.ProjectId, r.Presence]),
    [['P1', 'Missing in New Report'], ['P3', 'Missing in Old Report']]
  );
});

test('duplicate ProjectIds are surfaced instead of silently dropped', () => {
  const oldRows = [row('P1', { 'TD Total Cost': 10 }), row('P1', { 'TD Total Cost': 20 })];
  const newRows = [row('P1', { 'TD Total Cost': 20 })];
  const { duplicateKeys, overview } = PS3.buildDiff(oldRows, newRows);

  assert.equal(duplicateKeys.length, 1);
  assert.deepEqual(duplicateKeys[0], { ProjectId: 'P1', Report: 'Old', Occurrences: 2 });
  // Last row wins, so P1 compares clean — the warning is the only signal.
  assert.equal(overview.rowsWithDiffs, 0);
});

test('blank ProjectIds are skipped', () => {
  const rows = [row('P1'), row(''), row(null)];
  const { overview } = PS3.buildDiff(rows, rows.map(r => ({ ...r })));
  assert.equal(overview.matchingKeys, 1);
});

test('non-numeric changes are shown as a transition and counted separately', () => {
  const oldRows = [row('P1', { 'TD Total Cost': null })];
  const newRows = [row('P1', { 'TD Total Cost': 100 })];
  const { diffRows, overview } = PS3.buildDiff(oldRows, newRows);

  assert.equal(diffRows[0]['TD Total Cost (Diff)'], '(blank) → 100');
  assert.equal(overview.columnStats['TD Total Cost'].nonNumericDiffs, 1);
  assert.equal(overview.columnStats['TD Total Cost'].diffCount, 1);
});

test('headers are matched case- and whitespace-insensitively', () => {
  const messy = PS3.REQUIRED_COLUMNS.reduce((acc, col) => {
    acc[col.toUpperCase().replace(/ /g, '  ')] = col === 'ProjectId' ? 'P1' : 0;
    return acc;
  }, {});
  assert.doesNotThrow(() => PS3.buildDiff([messy], [{ ...messy }]));
});

test('a missing required column names the offending report', () => {
  const good = row('P1');
  const bad = { ...good };
  delete bad['TD Burden Cost'];

  assert.throws(() => PS3.buildDiff([good], [bad]), /New report: missing required column: TD Burden Cost/);
  assert.throws(() => PS3.buildDiff([bad], [good]), /Old report: missing required column: TD Burden Cost/);
});

test('export headers cover old, new and diff for every value column', () => {
  const rows = [row('P1')];
  const { exportHeaders } = PS3.buildDiff(rows, rows.map(r => ({ ...r })));

  assert.equal(exportHeaders.length, 1 + PS3.VALUE_COLUMNS.length * 3 + 1);
  assert.equal(exportHeaders[0], 'ProjectId');
  assert.equal(exportHeaders.at(-1), 'Diff Found');
  for (const col of PS3.VALUE_COLUMNS) {
    for (const suffix of ['(Old)', '(New)', '(Diff)']) {
      assert.ok(exportHeaders.includes(`${col} ${suffix}`), `missing ${col} ${suffix}`);
    }
  }
});
