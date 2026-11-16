# Anli Demo Tester

Public booking and webhook demo for QIIT Technologies, Anli `hotelId=1`.
It stores bookings and signed Anli notifications in PostgreSQL.

## What it does

- Syncs hotel room types and rooms from the Channel Manager.
- Creates bookings from the form through `POST /api/v1/channel-manager/bookings`.
- Saves these bookings in the tester database with origin `CREATED_HERE`.
- Receives Anli hotel webhook notifications at `POST /api/webhook`.
- Upserts `BOOKING_NEW`, `BOOKING_MODIFY`, `BOOKING_CANCEL`, `CHECK_IN`, and
  `CHECK_OUT` data into the same booking ledger with origin `ANLI_WEBHOOK`.
- Saves all accepted webhook payloads to a webhook event log, including test
  and non-booking event types.
- Blocks overlapping dates for the same room when creating bookings. Stay dates
  use check-in inclusive / check-out exclusive semantics.
- Stores incoming Anli reservations even if they conflict; those are marked
  `has_room_conflict` in the ledger instead of being rejected after PMS commit.

The webhook only notifies the app about Anli changes. Booking creation from the
form calls the Channel Manager API separately. `hotelId=1` is fixed in this
demo; configure the matching hotel in the Channel Manager and Anli.

## Configure

1. Create a PostgreSQL database on your host.
2. Copy `.env.example` to `.env.local` for local runs, or configure these values
   as deployment environment variables:
   - `DATABASE_URL`: PostgreSQL connection URI.
   - `PGSSL=true` if your database provider requires SSL.
   - `CHANNEL_MANAGER_BASE_URL`: Channel Manager base URL including `/api/v1`.
   - `CHANNEL_MANAGER_API_KEY`: server-side API key for room reads and booking
     creation.
   - `ANLI_WEBHOOK_SECRET`: at least 32 characters and exactly the same secret
     configured for the hotel webhook in Anli.
3. Keep all secrets server-side. Do not use `NEXT_PUBLIC_` prefixes.

Generate a webhook secret if needed:

```bash
openssl rand -hex 32
```

The app creates the required tables and indexes on first request; no manual
migration command is needed. The database user must be allowed to create tables
and indexes in the configured schema.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The dashboard is public;
no dashboard login is configured.

## Configure the Anli hotel webhook

The app needs a public HTTPS deployment URL. Register:

```text
https://<your-deployed-domain>/api/webhook
```

Use HTTP method `POST`, configure the shared `ANLI_WEBHOOK_SECRET`, enable the
hotel-level webhook for `hotelId=1`, and allow the booking events being tested.
Include `TEST` if using Anli's webhook test operation.

Anli sends `X-Webhook-Signature`, an HMAC-SHA256 hex digest of the exact request
body. The app verifies the signature before saving either the event or booking.
Do not use the `GET` method; query-parameter delivery cannot be verified by this
receiver.

## Public deployment warning

This tester intentionally has no dashboard credentials, per the demo
configuration. The public page exposes guest names, contact details, booking
dates and prices; its public booking form can also create reservations in the
PMS using the server-side Channel Manager API key. Only deploy it to a
temporary test environment or restrict access using the hosting platform's
network/access controls. Never use public access for production guest data.

The webhook receiver is intentionally public for Anli but requires a valid
signature. Missing or invalid signatures, malformed payloads, and events for
other hotel IDs are rejected.

## Database behavior

- PostgreSQL is the source of truth for the tester booking ledger and webhook
  event history. Data persists across app restarts and deployments.
- A room/date advisory lock and overlap check prevent concurrent local requests
  from booking the same room for overlapping nights.
- Check-in is included and check-out is excluded from a stay.
- Cancelled, canceled, no-show, and failed-create rows do not block dates.
- When Anli reports an overlapping booking, the tester stores it and marks a
  room conflict so the PMS notification is not lost.
- If an Anli event lacks stay dates or guest fields needed to identify a
  reservation, the raw event is retained in the event log but no booking row is
  created from it.

## Routes

| Method | Route | Purpose |
| --- | --- | --- |
| POST / PUT / PATCH | `/api/webhook` | Verify and persist Anli event; upsert booking events |
| GET | `/api/bookings` | List hotel 1 booking ledger |
| POST | `/api/bookings` | Create reservation through Channel Manager and save it |
| GET | `/api/rooms` | Sync rooms from Channel Manager and return blocked dates |
| GET | `/api/events` | List recent Anli webhook events |
| DELETE | `/api/events` | Clear webhook event history (bookings remain) |

Webhook delivery is asynchronous on Anli's side. The tester persists events
when received; it does not make PMS operations wait for the UI.
# anli-demo-tester
