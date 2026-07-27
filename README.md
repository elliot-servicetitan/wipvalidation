# ServiceTitan WIP Report Validation Tools

Browser-based tools for comparing and validating exported ServiceTitan WIP reports.

Everything runs client-side — spreadsheets are read in the browser with [SheetJS](https://sheetjs.com/) and are never uploaded to a server. That matters here, since these exports contain customer job costing data.

**Live:** https://elliot-servicetitan.github.io/wipvalidation/

## Tools

| Tool | Path | What it does |
| --- | --- | --- |
| Project Summary 3 Diff | `/project-summary-3/` | Matches two exports on `ProjectId` and diffs 14 cost and revenue columns. Reports per-column diff counts, net change, largest single change, presence mismatches, and duplicate ProjectIds. |
| Consumption Validator | `/consumption/` | Cross-checks the WIP Drilldown against Bills and Invoice Items. Verifies that consumed cost equals WAC × consumed quantity for each SKU. |
| Budget Code Diff | `/budget-code/` | Placeholder. Needs the report's column list before it can be built. |

Both working tools export results to CSV or multi-sheet XLSX.

### Project Summary 3 — required columns

`ProjectId`, `TD Total Cost`, `TD Vendor Bill Cost`, `TD Labor Cost`, `TD Burden Cost`, `TD Invoice Equipment Cost`, `TD Invoice Material Cost`, `TD Payroll Adjustments`, `TD Vendor Return`, `TD Invoice Billed`, `TD Invoice Revenue`, `TD Earned Revenue`, `TD % Complete Cost`, `TD Est. Total Cost`, `TD Contract Value`

Column matching ignores case and extra whitespace. Only the first sheet of each workbook is read.

The **tolerance** field suppresses differences at or below a given absolute value — useful for ignoring sub-cent rounding. It defaults to `0` (report everything); floating-point noise below `1e-9` is always ignored.

### Consumption — required columns

| Report | Columns |
| --- | --- |
| WIP Drilldown | `SKU Name`, `Quantity`, `Unit Cost`, `Subtotal`, `Consumed Quantity`, `WAC`, `Consumed Subtotal Cost` |
| Bills | `Item Code`, `Item Total`, `Item Unit Cost`, `Quantity Billed` |
| Invoice Items | `Code`, `Quantity` |

For each SKU the validator aggregates all rows, then compares:

- **WAC** — WIP's `Subtotal ÷ Quantity` against Bills' `Item Total ÷ Quantity Billed`
- **Consumed quantity** — WIP's `Consumed Quantity` against the Invoice Items total
- **Consumed cost** — WIP's `Consumed Subtotal Cost` against `Bills WAC × invoice quantity`

Differences above half a cent are reported. When invoice quantity exceeds billed quantity the calculation caps it at the billed quantity and flags a warning; the table shows both the reported and capped values.

## Layout

```
index.html                              landing page
project-summary-3/index.html            diff tool UI
consumption/index.html                  validator UI
budget-code/index.html                  placeholder
assets/styles.css                       shared stylesheet
assets/wip-common.js                    parsing, number coercion, header matching, exports
assets/project-summary-3-logic.js       pure diff logic
assets/consumption-logic.js             pure validation logic
tests/                                  node:test suite over the logic modules
```

The calculation logic lives in `assets/*-logic.js` with no DOM access. Each file is a UMD-style module: the browser loads it with a plain `<script>` tag, and Node `require`s the same file for tests. There is no build step and no runtime dependency beyond the SheetJS CDN script.

## Development

Open any `index.html` directly in a browser, or serve the directory:

```bash
python3 -m http.server 8000
```

Run the tests (requires Node 18+, no `npm install` needed — the suite has no dependencies):

```bash
npm test
```

CI runs the suite on every push and pull request to `main`; deployment to GitHub Pages is gated on it passing.

## Adding a tool

1. Create `<tool-name>/index.html` and link `../assets/styles.css`.
2. Put the calculation in `assets/<tool-name>-logic.js` using the same UMD wrapper, and use `WIP.buildHeaderMap` so column matching stays whitespace- and case-insensitive.
3. Add `tests/<tool-name>.test.js`.
4. Add a card to the root `index.html`.
