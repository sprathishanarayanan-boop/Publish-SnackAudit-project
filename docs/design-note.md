# OrdertoAudit design note

## Data model

PostgreSQL is the source of truth. `items` contains raw materials, packaging and finished products. `bom_lines` specifies standard material and packaging quantities per batch. `stock_ledger` records signed quantity movements and their source document; current balances are always `SUM(quantity_delta)` grouped by item. Purchases, production runs, production consumption, customer orders, invoices, invoice lines, payments and the audit log retain the corresponding business documents and traceability.

## Stock and production posting

Purchases create a purchase record and positive stock-ledger receipt in one transaction. A production run reads the BOM, locks all affected item rows, validates stock, writes planned/actual consumption and variance records, posts negative raw-material/packaging movements and a positive finished-goods movement for good packets. Any failure rolls the entire transaction back.

Consumption variance is `(actual - planned) / planned × 100`; yield variance is `(actual good output - expected output) / expected output × 100`. An absolute variance greater than 3% is flagged. Damaged pouches count as material consumption but not good output.

## Valuation and costing

Material valuation is weighted-average cost over positive stock receipts:

`weighted unit cost = Σ(receipt quantity × unit cost) / Σ(receipt quantity)`

Sub-paise rates remain decimal until the run line cost is rounded to paise. Labour and gas/power are charged directly to the production run:

`cost per good packet = (material cost + run labour + run overhead) / good packets`

The seed benchmark yields ₹5,855 total run cost and ₹31.1436 per good packet.

## GST and numbering

Invoice amounts are stored in paise. At the exercise's 5% rate, the taxable amount is multiplied by 5%; the result is split between CGST and SGST for Tamil Nadu, or assigned to IGST for interstate supply. Number allocation uses a transaction-safe counter per Indian financial year.
