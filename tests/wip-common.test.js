const test = require('node:test');
const assert = require('node:assert/strict');
const WIP = require('../assets/wip-common.js');

test('toNumber distinguishes blank from zero', () => {
  assert.equal(WIP.toNumber(null), null);
  assert.equal(WIP.toNumber(undefined), null);
  assert.equal(WIP.toNumber(''), null);
  assert.equal(WIP.toNumber('   '), null);
  assert.equal(WIP.toNumber(0), 0);
  assert.equal(WIP.toNumber('0'), 0);
});

test('toNumber strips currency, thousands separators and percent signs', () => {
  assert.equal(WIP.toNumber('$1,234.56'), 1234.56);
  assert.equal(WIP.toNumber('12.5%'), 12.5);
  assert.equal(WIP.toNumber(' 42 '), 42);
});

test('toNumber reads accounting-style negatives', () => {
  assert.equal(WIP.toNumber('(500.25)'), -500.25);
  assert.equal(WIP.toNumber('($1,000)'), -1000);
});

test('toNumber returns null for text and non-finite values', () => {
  assert.equal(WIP.toNumber('N/A'), null);
  assert.equal(WIP.toNumber('abc'), null);
  assert.equal(WIP.toNumber(NaN), null);
  assert.equal(WIP.toNumber(Infinity), null);
});

test('toNumberOr0 treats blanks as zero but still parses real values', () => {
  assert.equal(WIP.toNumberOr0(''), 0);
  assert.equal(WIP.toNumberOr0('N/A'), 0);
  assert.equal(WIP.toNumberOr0('$3.50'), 3.5);
});

test('buildHeaderMap matches headers regardless of case and whitespace', () => {
  const rows = [{ 'sku  NAME': 'A', ' Quantity ': 1 }];
  const map = WIP.buildHeaderMap(rows, ['SKU Name', 'Quantity'], 'Test');
  assert.equal(map['SKU Name'], 'sku  NAME');
  assert.equal(map['Quantity'], ' Quantity ');
  // The mapping must resolve back to the real cell values.
  assert.equal(rows[0][map['SKU Name']], 'A');
});

test('buildHeaderMap reports every missing column at once', () => {
  const rows = [{ 'SKU Name': 'A' }];
  assert.throws(
    () => WIP.buildHeaderMap(rows, ['SKU Name', 'WAC', 'Subtotal'], 'WIP Drilldown'),
    /WIP Drilldown: missing required columns: WAC, Subtotal/
  );
});

test('buildHeaderMap rejects an empty sheet', () => {
  assert.throws(() => WIP.buildHeaderMap([], ['A'], 'Bills'), /Bills: the first sheet has no data rows/);
});

test('buildHeaderMap finds columns absent from the first row object', () => {
  const rows = [{ A: 1 }, { A: 2, B: 3 }];
  const map = WIP.buildHeaderMap(rows, ['A', 'B'], 'Test');
  assert.equal(map.B, 'B');
});

test('formatters render em dashes for missing numbers', () => {
  assert.equal(WIP.fmtMoney(null), '—');
  assert.equal(WIP.fmtNum(null), '—');
  assert.equal(WIP.fmtMoney(1.5), '$1.5000');
  assert.equal(WIP.fmtNum(2), '2.0000');
});
