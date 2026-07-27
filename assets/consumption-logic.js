/*
 * Pure validation logic for the Consumption WIP cross-check.
 * No DOM access — exported for the browser (window.Consumption) and for Node tests.
 *
 * The check: for every SKU, the WIP Drilldown's consumed cost should equal the
 * weighted average cost derived from Bills multiplied by the quantity consumed
 * according to Invoice Items.
 */
(function (root, factory) {
  const common = typeof module === 'object' && module.exports ? require('./wip-common.js') : root.WIP;
  const api = factory(common);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Consumption = api;
})(typeof self !== 'undefined' ? self : this, function (WIP) {
  'use strict';

  /* Half a cent — below this, differences are rounding, not errors. */
  const TOLERANCE = 0.005;
  /* Totals are compared at whole-cent precision. */
  const TOTAL_TOLERANCE = 0.01;

  const WIP_COLUMNS = ['SKU Name', 'Quantity', 'Unit Cost', 'Subtotal', 'Consumed Quantity', 'WAC', 'Consumed Subtotal Cost'];
  const BILLS_COLUMNS = ['Item Code', 'Item Total', 'Item Unit Cost', 'Quantity Billed'];
  const INVOICE_COLUMNS = ['Code', 'Quantity'];

  const parseWip = rows => {
    const map = WIP.buildHeaderMap(rows, WIP_COLUMNS, 'WIP Drilldown');
    return rows
      .filter(r => WIP.toText(r[map['SKU Name']]) !== '')
      .map(r => ({
        skuName: WIP.toText(r[map['SKU Name']]),
        quantity: WIP.toNumberOr0(r[map['Quantity']]),
        unitCost: WIP.toNumberOr0(r[map['Unit Cost']]),
        subtotal: WIP.toNumberOr0(r[map['Subtotal']]),
        consumedQuantity: WIP.toNumberOr0(r[map['Consumed Quantity']]),
        wac: WIP.toNumberOr0(r[map['WAC']]),
        consumedSubtotalCost: WIP.toNumberOr0(r[map['Consumed Subtotal Cost']])
      }));
  };

  const parseBills = rows => {
    const map = WIP.buildHeaderMap(rows, BILLS_COLUMNS, 'Bills Report');
    return rows
      .filter(r => WIP.toText(r[map['Item Code']]) !== '')
      .map(r => ({
        itemCode: WIP.toText(r[map['Item Code']]),
        itemTotal: WIP.toNumberOr0(r[map['Item Total']]),
        itemUnitCost: WIP.toNumberOr0(r[map['Item Unit Cost']]),
        quantityBilled: WIP.toNumberOr0(r[map['Quantity Billed']])
      }));
  };

  const parseInvoice = rows => {
    const map = WIP.buildHeaderMap(rows, INVOICE_COLUMNS, 'Invoice Items Report');
    return rows
      .filter(r => WIP.toText(r[map['Code']]) !== '')
      .map(r => ({
        code: WIP.toText(r[map['Code']]),
        quantity: WIP.toNumberOr0(r[map['Quantity']])
      }));
  };

  const groupWip = wipRows => {
    const bySku = new Map();
    for (const row of wipRows) {
      let entry = bySku.get(row.skuName);
      if (!entry) {
        entry = { totalConsumedCost: 0, totalConsumedQty: 0, totalBilledCost: 0, totalBilledQty: 0, wacs: [], rowCount: 0 };
        bySku.set(row.skuName, entry);
      }
      entry.totalConsumedCost += row.consumedSubtotalCost;
      entry.totalConsumedQty += row.consumedQuantity;
      entry.totalBilledCost += row.subtotal;
      entry.totalBilledQty += row.quantity;
      entry.wacs.push(row.wac);
      entry.rowCount += 1;
    }
    return bySku;
  };

  const groupBills = billRows => {
    const bySku = new Map();
    for (const row of billRows) {
      const entry = bySku.get(row.itemCode) ?? { totalAmount: 0, totalQty: 0 };
      entry.totalAmount += row.itemTotal;
      entry.totalQty += row.quantityBilled;
      bySku.set(row.itemCode, entry);
    }
    return bySku;
  };

  const groupInvoice = invoiceRows => {
    const bySku = new Map();
    for (const row of invoiceRows) {
      const entry = bySku.get(row.code) ?? { totalQty: 0 };
      entry.totalQty += row.quantity;
      bySku.set(row.code, entry);
    }
    return bySku;
  };

  const STATUS_ORDER = { mismatch: 0, missing_bills: 1, missing_invoice: 2, match: 3 };

  const runValidation = (wipRows, billRows, invoiceRows) => {
    const wipBySku = groupWip(wipRows);
    const billsBySku = groupBills(billRows);
    const invoiceBySku = groupInvoice(invoiceRows);

    const allSkus = [...new Set([...wipBySku.keys(), ...billsBySku.keys(), ...invoiceBySku.keys()])].sort();

    const skuValidations = [];
    const skusOnlyInWip = [];
    const skusOnlyInBills = [];
    const skusOnlyInInvoice = [];
    let wipTotal = 0;
    let calculatedTotal = 0;
    let incompleteDataSkuCount = 0;

    for (const sku of allSkus) {
      const wipData = wipBySku.get(sku);
      const billData = billsBySku.get(sku);
      const invoiceData = invoiceBySku.get(sku);

      if (wipData && !billData && !invoiceData) skusOnlyInWip.push(sku);
      if (!wipData && billData && !invoiceData) skusOnlyInBills.push(sku);
      if (!wipData && !billData && invoiceData) skusOnlyInInvoice.push(sku);

      // Only SKUs present in WIP can be validated — the others are presence-only findings.
      if (!wipData) continue;

      const wipConsumedCost = wipData.totalConsumedCost;
      const wipConsumedQty = wipData.totalConsumedQty;
      const wipWac = wipData.totalBilledQty > 0
        ? wipData.totalBilledCost / wipData.totalBilledQty
        : wipData.wacs[0];

      const issues = [];
      const warnings = [];
      let calculatedWac = null;
      let invoiceQtyConsumed = null;
      let invoiceQtyReported = null;
      let calculatedConsumedCost = null;
      let costDifference = null;
      let billsTotalQty = null;
      let billsTotalAmount = null;
      let status = 'match';

      const uniqueWacs = [...new Set(wipData.wacs.map(w => w.toFixed(6)))];
      if (uniqueWacs.length > 1) {
        warnings.push(`WIP has ${uniqueWacs.length} different WAC values across rows: ${uniqueWacs.map(w => '$' + parseFloat(w).toFixed(4)).join(', ')}`);
      }

      if (!billData) {
        issues.push('SKU not found in Bills report — excluded from TD Vendor Bill Cost calculation (cannot calculate WAC without bill data)');
        status = 'missing_bills';
      } else {
        billsTotalQty = billData.totalQty;
        billsTotalAmount = billData.totalAmount;
        calculatedWac = billsTotalQty > 0 ? billsTotalAmount / billsTotalQty : 0;
        const wacDiff = Math.abs(calculatedWac - wipWac);
        if (wacDiff > TOLERANCE) {
          issues.push(`WAC mismatch: WIP shows $${wipWac.toFixed(4)} but Bills calculates $${calculatedWac.toFixed(4)} (diff: $${wacDiff.toFixed(4)})`);
        }
      }

      if (!invoiceData) {
        issues.push('SKU not found in Invoice Items report — cannot verify QTY consumed');
        if (status !== 'missing_bills') status = 'missing_invoice';
      } else {
        invoiceQtyConsumed = invoiceData.totalQty;
        invoiceQtyReported = invoiceData.totalQty;
        const qtyDiff = Math.abs(invoiceQtyConsumed - wipConsumedQty);
        if (qtyDiff > TOLERANCE) {
          warnings.push(`QTY consumed mismatch: WIP shows ${wipConsumedQty} but Invoice Items shows ${invoiceQtyConsumed} (diff: ${qtyDiff.toFixed(4)})`);
        }
      }

      if (calculatedWac !== null && invoiceQtyConsumed !== null && billsTotalQty !== null) {
        if (invoiceQtyConsumed > billsTotalQty) {
          warnings.push(`Invoice QTY (${invoiceQtyConsumed}) exceeds Bills QTY (${billsTotalQty}) — capping consumed QTY at billed QTY for cost calculation`);
          invoiceQtyConsumed = billsTotalQty;
        }
        calculatedConsumedCost = calculatedWac * invoiceQtyConsumed;
        wipTotal += wipConsumedCost;
        calculatedTotal += calculatedConsumedCost;
        costDifference = wipConsumedCost - calculatedConsumedCost;
        if (Math.abs(costDifference) > TOLERANCE) {
          issues.push(`Consumed cost mismatch: WIP shows $${wipConsumedCost.toFixed(4)} but calculated (WAC × QTY) = $${calculatedConsumedCost.toFixed(4)} (diff: $${costDifference.toFixed(4)})`);
          status = 'mismatch';
        }
      } else {
        incompleteDataSkuCount++;
      }

      if (status === 'match' && issues.length > 0) status = 'mismatch';

      skuValidations.push({
        sku,
        wipRowCount: wipData.rowCount,
        wipConsumedQty,
        wipWac,
        wipConsumedCost,
        calculatedWac,
        invoiceQtyReported,
        invoiceQtyConsumed,
        calculatedConsumedCost,
        costDifference,
        billsTotalQty,
        billsTotalAmount,
        issues: [...issues, ...warnings],
        status
      });
    }

    skuValidations.sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || a.sku.localeCompare(b.sku));

    const totalDifference = wipTotal - calculatedTotal;
    const countBy = s => skuValidations.filter(v => v.status === s).length;
    const mismatchCount = countBy('mismatch');
    const missingBillsCount = countBy('missing_bills');
    const missingInvoiceCount = countBy('missing_invoice');
    const matchCount = countBy('match');

    const hasIssues = matchCount !== skuValidations.length || Math.abs(totalDifference) > TOTAL_TOLERANCE;

    const details = [];
    if (mismatchCount) details.push(`${mismatchCount} SKU(s) have cost calculation mismatches`);
    if (missingBillsCount) details.push(`${missingBillsCount} SKU(s) in WIP not found in Bills report`);
    if (missingInvoiceCount) details.push(`${missingInvoiceCount} SKU(s) in WIP not found in Invoice Items report`);
    if (skusOnlyInWip.length) details.push(`${skusOnlyInWip.length} SKU(s) appear only in WIP`);
    if (skusOnlyInBills.length) details.push(`${skusOnlyInBills.length} SKU(s) appear only in Bills`);
    if (skusOnlyInInvoice.length) details.push(`${skusOnlyInInvoice.length} SKU(s) appear only in Invoice Items`);
    details.push(`${matchCount} SKU(s) validated successfully`);

    const summary = hasIssues
      ? `Validation failed. WIP total: $${wipTotal.toFixed(2)}, calculated total: $${calculatedTotal.toFixed(2)} (difference: $${Math.abs(totalDifference).toFixed(2)}).` +
        (incompleteDataSkuCount > 0 ? ` Note: ${incompleteDataSkuCount} SKU(s) had incomplete data and were excluded from totals.` : '')
      : `Validation passed. The WIP TD Vendor Bill Cost total of $${wipTotal.toFixed(2)} matches the independently calculated total of $${calculatedTotal.toFixed(2)}. All ${matchCount} SKUs have correct WAC and QTY consumed values.`;

    return {
      overallStatus: hasIssues ? 'fail' : 'pass',
      summary,
      details,
      wipTotal,
      calculatedTotal,
      totalDifference,
      incompleteDataSkuCount,
      skuValidations,
      skusOnlyInWip,
      skusOnlyInBills,
      skusOnlyInInvoice,
      matchCount,
      mismatchCount,
      missingBillsCount,
      missingInvoiceCount
    };
  };

  /** Flatten a result into plain rows suitable for CSV/XLSX export. */
  const toExportRows = result => result.skuValidations.map(v => ({
    SKU: v.sku,
    Status: v.status,
    'WIP Rows': v.wipRowCount,
    'WIP Consumed Qty': v.wipConsumedQty,
    'WIP WAC': v.wipWac,
    'WIP Consumed Cost': v.wipConsumedCost,
    'Bills WAC': v.calculatedWac,
    'Bills Total Qty': v.billsTotalQty,
    'Bills Total Amount': v.billsTotalAmount,
    'Invoice Qty': v.invoiceQtyReported,
    'Qty Used In Calc': v.invoiceQtyConsumed,
    'Calculated Consumed Cost': v.calculatedConsumedCost,
    'Cost Difference': v.costDifference,
    'Issues / Warnings': v.issues.join(' | ')
  }));

  return {
    TOLERANCE,
    TOTAL_TOLERANCE,
    WIP_COLUMNS,
    BILLS_COLUMNS,
    INVOICE_COLUMNS,
    parseWip,
    parseBills,
    parseInvoice,
    runValidation,
    toExportRows
  };
});
