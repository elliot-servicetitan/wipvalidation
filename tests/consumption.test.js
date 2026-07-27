const test = require('node:test');
const assert = require('node:assert/strict');
const Consumption = require('../assets/consumption-logic.js');

const wipRow = o => ({
  'SKU Name': o.sku,
  'Quantity': o.qty ?? 0,
  'Unit Cost': o.unitCost ?? 0,
  'Subtotal': o.subtotal ?? 0,
  'Consumed Quantity': o.consumedQty ?? 0,
  'WAC': o.wac ?? 0,
  'Consumed Subtotal Cost': o.consumedCost ?? 0
});

const billRow = o => ({
  'Item Code': o.sku,
  'Item Total': o.total ?? 0,
  'Item Unit Cost': o.unitCost ?? 0,
  'Quantity Billed': o.qty ?? 0
});

const invoiceRow = o => ({ 'Code': o.sku, 'Quantity': o.qty ?? 0 });

const validate = (wip, bills, invoice) => Consumption.runValidation(
  Consumption.parseWip(wip.map(wipRow)),
  Consumption.parseBills(bills.map(billRow)),
  Consumption.parseInvoice(invoice.map(invoiceRow))
);

test('a consistent SKU passes validation', () => {
  const result = validate(
    [{ sku: 'A', qty: 10, subtotal: 50, consumedQty: 4, wac: 5, consumedCost: 20 }],
    [{ sku: 'A', total: 50, qty: 10 }],
    [{ sku: 'A', qty: 4 }]
  );

  assert.equal(result.overallStatus, 'pass');
  assert.equal(result.matchCount, 1);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.wipTotal, 20);
  assert.equal(result.calculatedTotal, 20);
  assert.equal(result.skuValidations[0].issues.length, 0);
});

test('a consumed cost that disagrees with WAC x qty fails', () => {
  const result = validate(
    [{ sku: 'A', qty: 10, subtotal: 50, consumedQty: 4, wac: 5, consumedCost: 25 }],
    [{ sku: 'A', total: 50, qty: 10 }],
    [{ sku: 'A', qty: 4 }]
  );

  assert.equal(result.overallStatus, 'fail');
  assert.equal(result.mismatchCount, 1);
  assert.equal(result.skuValidations[0].costDifference, 5);
  assert.match(result.skuValidations[0].issues[0], /Consumed cost mismatch/);
});

test('sub-half-cent rounding is tolerated', () => {
  const result = validate(
    [{ sku: 'A', qty: 10, subtotal: 50, consumedQty: 4, wac: 5, consumedCost: 20.004 }],
    [{ sku: 'A', total: 50, qty: 10 }],
    [{ sku: 'A', qty: 4 }]
  );

  assert.equal(result.overallStatus, 'pass');
  assert.equal(result.matchCount, 1);
});

test('multiple WIP rows for one SKU are aggregated before comparison', () => {
  const result = validate(
    [
      { sku: 'A', qty: 6, subtotal: 30, consumedQty: 2, wac: 5, consumedCost: 10 },
      { sku: 'A', qty: 4, subtotal: 20, consumedQty: 2, wac: 5, consumedCost: 10 }
    ],
    [{ sku: 'A', total: 50, qty: 10 }],
    [{ sku: 'A', qty: 4 }]
  );

  assert.equal(result.overallStatus, 'pass');
  assert.equal(result.skuValidations[0].wipRowCount, 2);
  assert.equal(result.skuValidations[0].wipConsumedCost, 20);
  assert.equal(result.skuValidations[0].wipWac, 5); // 50 / 10
});

test('differing WAC values across WIP rows raise a warning', () => {
  const result = validate(
    [
      { sku: 'A', qty: 5, subtotal: 25, consumedQty: 2, wac: 5, consumedCost: 10 },
      { sku: 'A', qty: 5, subtotal: 25, consumedQty: 2, wac: 7, consumedCost: 10 }
    ],
    [{ sku: 'A', total: 50, qty: 10 }],
    [{ sku: 'A', qty: 4 }]
  );

  assert.match(result.skuValidations[0].issues.join(' '), /2 different WAC values/);
});

test('a SKU missing from Bills is flagged and excluded from the totals', () => {
  const result = validate(
    [{ sku: 'A', qty: 10, subtotal: 50, consumedQty: 4, wac: 5, consumedCost: 20 }],
    [{ sku: 'OTHER', total: 1, qty: 1 }],
    [{ sku: 'A', qty: 4 }]
  );

  const a = result.skuValidations.find(v => v.sku === 'A');
  assert.equal(result.missingBillsCount, 1);
  assert.equal(a.status, 'missing_bills');
  assert.equal(result.wipTotal, 0);
  assert.equal(result.incompleteDataSkuCount, 1);
});

test('a SKU missing from Invoice Items is flagged', () => {
  const result = validate(
    [{ sku: 'A', qty: 10, subtotal: 50, consumedQty: 4, wac: 5, consumedCost: 20 }],
    [{ sku: 'A', total: 50, qty: 10 }],
    [{ sku: 'OTHER', qty: 1 }]
  );

  assert.equal(result.missingInvoiceCount, 1);
  assert.equal(result.skuValidations[0].status, 'missing_invoice');
});

test('an empty report fails loudly instead of marking every SKU as missing', () => {
  const wip = [wipRow({ sku: 'A', qty: 10, subtotal: 50, consumedQty: 4, wac: 5, consumedCost: 20 })];
  assert.throws(() => Consumption.parseBills([]), /Bills Report: the first sheet has no data rows/);
  assert.throws(() => Consumption.parseInvoice([]), /Invoice Items Report: the first sheet has no data rows/);
  assert.doesNotThrow(() => Consumption.parseWip(wip));
});

test('consumed quantity is capped at billed quantity, and both values are kept', () => {
  const result = validate(
    [{ sku: 'A', qty: 10, subtotal: 50, consumedQty: 15, wac: 5, consumedCost: 50 }],
    [{ sku: 'A', total: 50, qty: 10 }],
    [{ sku: 'A', qty: 15 }]
  );

  const v = result.skuValidations[0];
  assert.equal(v.invoiceQtyReported, 15, 'the report value stays visible');
  assert.equal(v.invoiceQtyConsumed, 10, 'the calculation uses the capped value');
  assert.equal(v.calculatedConsumedCost, 50);
  assert.match(v.issues.join(' '), /exceeds Bills QTY/);
});

test('SKUs appearing in only one report are listed as presence findings', () => {
  const result = validate(
    [{ sku: 'A', qty: 1, subtotal: 1, consumedQty: 1, wac: 1, consumedCost: 1 }],
    [{ sku: 'B', total: 5, qty: 5 }],
    [{ sku: 'C', qty: 3 }]
  );

  assert.deepEqual(result.skusOnlyInWip, ['A']);
  assert.deepEqual(result.skusOnlyInBills, ['B']);
  assert.deepEqual(result.skusOnlyInInvoice, ['C']);
  // Only WIP SKUs get a validation row.
  assert.equal(result.skuValidations.length, 1);
});

test('results are ordered worst-first', () => {
  const result = validate(
    [
      { sku: 'ok', qty: 10, subtotal: 50, consumedQty: 4, wac: 5, consumedCost: 20 },
      { sku: 'bad', qty: 10, subtotal: 50, consumedQty: 4, wac: 5, consumedCost: 99 },
      { sku: 'nobills', qty: 10, subtotal: 50, consumedQty: 4, wac: 5, consumedCost: 20 }
    ],
    [{ sku: 'ok', total: 50, qty: 10 }, { sku: 'bad', total: 50, qty: 10 }],
    [{ sku: 'ok', qty: 4 }, { sku: 'bad', qty: 4 }, { sku: 'nobills', qty: 4 }]
  );

  assert.deepEqual(result.skuValidations.map(v => v.status), ['mismatch', 'missing_bills', 'match']);
});

test('parsers accept headers that differ in case and spacing', () => {
  const rows = [{ 'sku  name': 'A', 'QUANTITY': 10, 'unit cost': 5, 'Subtotal ': 50, 'consumed quantity': 4, 'wac': 5, 'CONSUMED SUBTOTAL COST': 20 }];
  const parsed = Consumption.parseWip(rows);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].skuName, 'A');
  assert.equal(parsed[0].subtotal, 50);
  assert.equal(parsed[0].consumedSubtotalCost, 20);
});

test('a WIP export without a Subtotal column is rejected rather than silently zeroed', () => {
  const rows = [{ 'SKU Name': 'A', 'Quantity': 10, 'Unit Cost': 5, 'Consumed Quantity': 4, 'WAC': 5, 'Consumed Subtotal Cost': 20 }];
  assert.throws(() => Consumption.parseWip(rows), /WIP Drilldown: missing required column: Subtotal/);
});

test('rows with a blank SKU are dropped', () => {
  const rows = [wipRow({ sku: 'A' }), wipRow({ sku: '' }), wipRow({ sku: null })];
  assert.equal(Consumption.parseWip(rows).length, 1);
});

test('export rows keep both the reported and capped quantities', () => {
  const result = validate(
    [{ sku: 'A', qty: 10, subtotal: 50, consumedQty: 15, wac: 5, consumedCost: 50 }],
    [{ sku: 'A', total: 50, qty: 10 }],
    [{ sku: 'A', qty: 15 }]
  );
  const [exported] = Consumption.toExportRows(result);

  assert.equal(exported.SKU, 'A');
  assert.equal(exported['Invoice Qty'], 15);
  assert.equal(exported['Qty Used In Calc'], 10);
});
