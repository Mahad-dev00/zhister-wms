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
- Keep API credentials server-side; never place them in browser JavaScript.

Before live write-back, verify the available Zhipster endpoints, authentication, shipment-to-order-line mapping, package update semantics, and label retrieval with a valid API key.

## Seed product catalogue

| Article number | Product | Location |
|---|---|---|
| 99566 | Wc-sits Ifö Sign Mjuksits | A1 |
| 99420 | Wc-sits Ifö Cera Mjuksits | A1 |
| 99488 | Wc-sits Ifö Spira Mjuksits | A1 |
| 629309311 | WC-stol Ifö Spira 6293 Hårdsits | A1 |
| 629308811 | WC-stol Ifö Spira 6293 Rimfree inkl Mjuksits | A1 |

The half-pallet profile is shown as a demo default: 45 kg, 60 × 80 × 95 cm. Confirm product applicability before live shipment updates.

## Implementation stages

1. Build a protected backend and persistent database with users, stock ledger, picking tasks and audit events.
2. Implement read-only Zhipster sync and map shipment/order-line identifiers.
3. Add safe write-back for package dimensions and label retrieval against the existing shipment.
4. Add concurrency controls, role permissions, stock reconciliation, backups and printer testing before replacing Ongoing in production.

## Read-only Zhipster integration

The Orders page has a live shipment lookup. It calls a server-side endpoint at `/api/shipment`, which forwards read requests to the production Zhipster Shipment API. The API key is read from the server environment and is never included in browser JavaScript.

### Configure on Vercel

1. In **Project Settings → Environment Variables**, add `ZHIPSTER_API_KEY` with the Zhipster API key to the environments you intend to test.
2. Redeploy after adding or changing the variable.
3. Open **Live orders → Find a live Zhipster shipment** and search by shipment ID or order number.

The endpoint supports:
- `GET /api/shipment?shipmentId=...` → Zhipster `GetShipment`
- `GET /api/shipment?orderNumber=...` → Zhipster `GetShipmentsByOrderNumber`

The proxy is read-only, rejects ambiguous identifiers, disables caching, and does not forward upstream error bodies to the browser.

### Current integration boundary

This is a live lookup and mapping preview, not a full synchronization. It deliberately does not import API results into the demo picking queue, change shipment statuses, reserve stock, or call any Zhipster write endpoint. Zhipster source statuses and distribution-model values are displayed as supplied. A distribution model—including `DropShipment`—must not be automatically treated as warehouse eligibility without an agreed and verified business rule. The browser index does not automatically create or exclude picking work.

The static prototype still needs a serverless-capable host such as Vercel for `/api/shipment`. Opening `index.html` directly or serving it with only `python -m http.server` will display the UI but cannot run the API proxy.

## Administrator authentication (Preview)

The Preview branch now has a Supabase Auth sign-in gate.

- The only authorised account is `mahad.warsame.work@gmail.com` (display name Mahad).
- First-time setup: use **Create your account** on the Preview login screen, then confirm the verification email before signing in.
- Passwords are sent directly to Supabase Auth over HTTPS. The WMS does not store or log passwords.
- Access and refresh tokens are stored in Secure, HttpOnly, SameSite=Lax cookies; they are not exposed to browser JavaScript or localStorage.
- The server validates the authenticated Supabase user and the fixed administrator email before serving live shipment lookups.
- The signup endpoint only permits the designated administrator email. Do not loosen this allowlist without implementing managed user roles and invitations.

Required Preview environment variables:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (used by server-side Auth requests; safe to expose, but this implementation does not expose it to browser code)
- `SUPABASE_SERVICE_ROLE_KEY` remains server-side only and is not used by the browser or the Auth endpoints.
- `ZHIPSTER_API_KEY` remains server-side only.

Authentication endpoints: `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/session`, and `POST /api/auth/logout`.

**Important current boundary:** this commit protects the WMS UI and the existing live Zhipster lookup. The warehouse screens still use their prototype/sample records and browser localStorage. The existing private `wms` schema is not yet powering picking, packing, stock, or dispatch screens. Database-backed warehouse operations are the next implementation stage; this authentication work does not imply that data migration or persistent WMS operations are complete.

## Persistent WMS database

The Supabase project `Rerso-wms` now has a private `wms` schema containing:

- Zhipster shipment headers and shipment lines, retaining the original JSON payload
- Separate warehouse eligibility and operational work statuses
- Picking tasks and pick-task lines
- Packages and package lines
- Dispatch records
- Audit events

All nine tables have row-level security enabled. The schema is not granted to browser-facing `anon` or `authenticated` roles; database access must go through a protected server-side integration. No demo stock quantities or sample orders have been copied into the live database.

The current database foundation does not yet synchronize shipments or power the existing demo screens. That is the next implementation step, after the server-side Supabase credential and access path are configured.
