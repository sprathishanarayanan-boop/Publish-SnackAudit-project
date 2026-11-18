# OrdertoAudit

A mobile-friendly order-to-audit prototype for a small packaged-snacks factory. It connects salesman orders, approval, GST billing, dispatch, payments, raw-material purchases, BOM production, stock movements, costing and audit reports.

## Run locally

The simplest route is Docker Desktop:

1. Open Docker Desktop and wait for it to be ready.
2. Open PowerShell in this project folder.
3. Run:

```powershell
docker compose up --build
```

Open **http://localhost:4001**. The app creates its schema and benchmark seed records on first start. PostgreSQL data persists in the `audit-db` Docker volume.

To stop it, press **Ctrl+C** and run `docker compose down` in another terminal. `docker compose down -v` also deletes the local demo database.

### Run without Docker

Install Node.js 20+ and PostgreSQL 16, create a database named `orderto_audit`, copy `.env.example` to `.env`, update its `DATABASE_URL` and `JWT_SECRET`, then run:

```powershell
npm install
npm run migrate
npm run seed
npm start
```

Then open `http://localhost:4000`.

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Salesman A | `salesman@snacksaudit.test` | `Salesman@123` |
| Salesman B | `salesmanb@snacksaudit.test` | `Salesman@123` |
| Factory admin | `admin@snacksaudit.test` | `Admin@123` |
| Production supervisor | `production@snacksaudit.test` | `Production@123` |
| Auditor | `auditor@snacksaudit.test` | `Auditor@123` |
| Owner | `owner@snacksaudit.test` | `Owner@123` |

These are demo-only credentials. Change passwords and `JWT_SECRET` before using any hosted instance with non-demo data.

## Benchmark walkthrough

1. Sign in as production. The seed contains 100 kg flour at ₹42/kg and the rest of the benchmark opening stock.
2. Record a 60 kg flour purchase at ₹45/kg.
3. Post a Murukku 200 g production run: flour 40 kg, oil 10.5 L, spice mix 1.2 kg, 194 pouches consumed, 9 cartons, 188 good packets, 6 damaged pouches, ₹1,200 labour and ₹600 gas/power.
4. Sign in as Salesman A and submit an order for 150 packets to Retailer A.
5. As admin, approve the order, download its GST invoice PDF, record dispatch and record ₹4,000 payment.
6. As Salesman B, submit 120 packets to Distributor B. The system shows the shortage of 32 packets against the 88 remaining after dispatch.
7. As auditor or owner, run reports for the relevant date range; download sales, purchase, production, payments and stock ledger CSVs.

## Expected benchmark results

| Check | Expected |
|---|---:|
| Flour closing | 120 kg |
| Cooking oil closing | 19.5 L |
| Pouches closing | 306 |
| Cartons closing | 21 |
| Finished goods after production | 238 packets |
| Finished goods after Retailer A dispatch | 88 packets |
| Yield variance | -6%, flagged |
| Oil usage variance | +5%, flagged |
| Retailer A invoice | ₹7,500 taxable + ₹187.50 CGST + ₹187.50 SGST = ₹7,875 |
| Retailer A outstanding after ₹4,000 payment | ₹3,875 |
| Distributor B order shortage | 32 packets |

### Costing and assumptions

Material cost uses weighted-average receipt cost. Flour weighted-average is `(100 × ₹42 + 60 × ₹45) / 160 = ₹43.125/kg`. For the run, materials cost ₹4,055: flour ₹1,725, oil ₹1,470, spice mix ₹240, pouches ₹485 and cartons ₹135. Labour and gas/power are charged directly to the run, adding ₹1,800. The expected cost is therefore ₹5,855 / 188 good packets = **₹31.1436 per packet** (displayed rounded to paise).

The 6 damaged pouches are included in 194 actual pouch issues (188 saleable packets + 6 damaged). The benchmark’s 9 cartons represent capacity for 180 packets while output is 188; the system records the specified carton consumption and packet output separately, leaving 8 packets unpacked. GST is 5%; same-state supply uses CGST/SGST and interstate supply uses IGST. The demo seller GSTIN is a placeholder (`FACTORY_GSTIN`); replace it with a real GSTIN only for a legally reviewed deployment. All money is stored in integer paise; weighted rates retain sub-paise precision until each run’s material cost is rounded.

Mass entered in grams converts to the item's kilogram base unit; millilitres convert to litres. Finished-goods orders entered in cartons convert at 20 packets per carton, while packaging cartons remain individual pieces of packaging stock.

## Implemented scope

- **Must-have:** role-based login, product/customer/BOM seed data, mobile order entry, order review, GST invoice PDF, ledger-based stock, production run and consumption/yield variance, inventory ledger and CSV exports.
- **Should-have:** purchases, supplier capture, payments, outstanding ageing, weighted-average costing, GST summary, variance alerts and an owner view.
- **Stretch:** queued offline field orders sync when the browser reconnects.

## Design and technology

The app uses Express/Node.js for the API, PostgreSQL for business records, and a dependency-light HTML/CSS/JavaScript client. PostgreSQL transactions lock the affected item rows when purchasing, producing, invoicing and dispatching, and the stock ledger is the source of truth for balances. This provides a single local Docker command and keeps the prototype small enough to inspect.

See [design-note.md](./docs/design-note.md) for the schema, posting rules and costing method.

## Known gaps

- This is a prototype, not a certified GST/e-invoicing product; confirm invoice fields and tax treatment with an accountant before real use.
- Invoice cancellation/credit-note workflow, partial dispatch/returns and full master-data administration are not yet exposed in the UI.
- Offline orders use browser local storage and replay on reconnect; they are not encrypted or shared across devices.
- The generated PDF is a compact basic tax invoice. No email, WhatsApp, Tally sync or production deployment is configured.

## Deploy

Push this folder to a GitHub repository, then create a Render **Blueprint** from it. Render reads `render.yaml` to provision the Node web service and PostgreSQL database. The health endpoint is `/api/health`.
