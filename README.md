# Zhister WMS — warehouse prototype

A browser-based WMS prototype inspired by the operational layout of Ongoing WMS. It is designed as the warehouse execution layer around existing Zhipster orders.

## Run locally

No build tools or paid hosting are required.

1. Download or clone this repository.
2. Open `index.html` in a modern browser.

For local development, you can also run `python -m http.server 8000` in this folder and visit `http://localhost:8000`.

## Included in this prototype

- Overview dashboard and order queue
- Search by order ID, order number, customer or article number
- Product catalogue seeded with the five supplied Ifö SKUs
- Batch picking grouped by article number while preserving each order's quantity
- Picking completion and packing workflow
- Demo half-pallet parcel profile (45 kg, 60 × 80 × 95 cm)
- Shipping queue, CSV exports and print views
- Browser local storage for demo progress

## Important: demo, not production WMS

The current version uses sample orders and local browser storage. It does not connect to Zhipster, reserve live stock, create carrier bookings, update real shipments or retrieve real shipping labels. Do not use its demo statuses or stock quantities as operational truth.

### Integration design

- Zhipster remains the source of truth for registered orders/shipments, carrier bookings, tracking and labels.
- Zhister WMS should own warehouse execution: allocation, pick progress, packing, internal stock locations and audit history.
- The integration must update the existing Zhipster shipment rather than create a duplicate shipment.
- Keep API credentials server-side (for example, Apps Script Properties or a protected backend); never place them in browser JavaScript.

Before live integration, verify the available Zhipster endpoints, authentication, shipment-to-order-line mapping, package update semantics, and label retrieval with a valid API key.

## Seed product catalogue

| Article number | Product | Location |
|---|---|---|
| 99566 | Wc-sits Ifö Sign Mjuksits | A1 |
| 99420 | Wc-sits Ifö Cera Mjuksits | A1 |
| 99488 | Wc-sits Ifö Spira Mjuksits | A1 |
| 629309311 | WC-stol Ifö Spira 6293 Hårdsits | A1 |
| 629308811 | WC-stol Ifö Spira 6293 Rimfree inkl Mjuksits | A1 |

The half-pallet profile is shown as a demo default: 45 kg, 60 × 80 × 95 cm. Confirm product applicability before live shipment updates.

## Next implementation stages

1. Add a protected backend and persistent database with users, stock ledger, picking tasks and audit events.
2. Implement read-only Zhipster sync and map shipment/order-line identifiers.
3. Add safe write-back for package dimensions and label retrieval against the existing shipment.
4. Add concurrency controls, role permissions, stock reconciliation, backups and printer testing before replacing Ongoing in production.

## Read-only Zhipster integration (first implementation)

The Orders page now has a live shipment lookup. It calls a server-side endpoint at `/api/shipment`, which forwards only read requests to the production Zhipster Shipment API. The API key is read from the server environment and is never included in browser JavaScript.

### Configure on Vercel

1. Import or connect this repository to a Vercel project (if it is not already connected).
2. In **Project Settings → Environment Variables**, add `ZHIPSTER_API_KEY` with the Zhipster API key. Add it to the environments you intend to test.
3. Redeploy after adding the variable.
4. Open **Orders → Find a live Zhipster shipment** and search by shipment ID / shipment number or order number.

The endpoint supports:
- `GET /api/shipment?shipmentId=...` → Zhipster `GetShipment`
- `GET /api/shipment?orderNumber=...` → Zhipster `GetShipmentsByOrderNumber`

The proxy is read-only, rejects ambiguous identifiers, disables caching, and does not forward upstream error bodies to the browser.

### Current integration boundary

This is a live lookup and mapping preview, not a full synchronization. It deliberately does not import API results into the demo picking queue, change shipment statuses, reserve stock, or call any Zhipster write endpoint. The current sample shipment includes a `DropShipment` distribution model; that is not evidence of own-warehouse fulfillment and must not be turned into picking work automatically.

The static prototype still needs a serverless-capable host such as Vercel for `/api/shipment`. Opening `index.html` directly or serving it with only `python -m http.server` will display the UI but cannot run the API proxy.


## Warehouse eligibility preview (second implementation)

The live shipment lookup now classifies each returned shipment conservatively before any warehouse workflow can use it:

- `DropShipment` is explicitly excluded from warehouse picking.
- Missing distribution model, missing dispatch orders, or missing article lines require review.
- Other distribution-model values also require review until their exact Zhipster meaning is confirmed and mapped to an own-warehouse fulfilment rule.
- Shipment status (for example registered, pickup confirmed, or dispatched) is displayed as shipment information; it is not treated as proof of warehouse fulfilment responsibility.

This is deliberately a preview-only decision layer. It does not create picking tasks, import live shipments into browser-local demo orders, reserve stock, or write status changes to Zhipster. Do not loosen the eligibility rules until the actual distribution-model values and dispatch-line semantics have been verified against representative live API responses.
