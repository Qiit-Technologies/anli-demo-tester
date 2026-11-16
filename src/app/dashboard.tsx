"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Booking = {
  id: string;
  booking_code: string | null;
  external_confirm_id: string | null;
  room_id: string | null;
  room_type_id: string | null;
  room_number: string | null;
  guest_name: string;
  guest_email: string;
  guest_phone: string | null;
  check_in: string;
  check_out: string;
  total_price: string;
  currency: string;
  number_of_guests: number;
  status: string;
  origin: string;
  pms_forwarded: boolean | null;
  has_room_conflict: boolean;
  created_at: string;
};

type RoomBooking = {
  id: string;
  bookingCode: string | null;
  guestName: string;
  checkIn: string;
  checkOut: string;
  status: string;
  origin: string;
};

type Room = {
  room_id: string;
  room_type_id: string;
  room_type_name: string;
  room_number: string;
  capacity: number | null;
  room_status: string | null;
  bookings: RoomBooking[];
};

type WebhookEvent = {
  id: string;
  hotel_id: number;
  event_type: string;
  received_at: string;
  payload: Record<string, unknown>;
};

type FormState = {
  roomId: string;
  checkIn: string;
  checkOut: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  numberOfGuests: string;
  totalPrice: string;
  currency: string;
};

const initialForm: FormState = {
  roomId: "",
  checkIn: new Date().toISOString().slice(0, 10),
  checkOut: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  guestName: "",
  guestEmail: "",
  guestPhone: "",
  numberOfGuests: "1",
  totalPrice: "",
  currency: "NGN",
};

function day(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function formatDate(value: string): string {
  const parsed = new Date(`${day(value)}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function formatMoney(value: string, currency: string): string {
  const amount = Number(value);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "NGN",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function overlaps(
  checkIn: string,
  checkOut: string,
  bookedIn: string,
  bookedOut: string,
): boolean {
  return day(bookedIn) < checkOut && day(bookedOut) > checkIn;
}

function isBlocking(status: string) {
  return !["CANCELLED", "CANCELED", "CREATE_FAILED", "NO_SHOW"].includes(
    status.toUpperCase(),
  );
}

export default function Dashboard({ receiverUrl }: { receiverUrl: string }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [pageError, setPageError] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const refreshBookings = useCallback(async () => {
    const [bookingResponse, eventResponse] = await Promise.all([
      fetch("/api/bookings", { cache: "no-store" }),
      fetch("/api/events", { cache: "no-store" }),
    ]);

    if (!bookingResponse.ok) {
      const result = (await bookingResponse.json().catch(() => ({}))) as { error?: string };
      throw new Error(result.error ?? `Could not load bookings (${bookingResponse.status}).`);
    }

    const bookingResult = (await bookingResponse.json()) as { bookings: Booking[] };
    setBookings(bookingResult.bookings);

    if (eventResponse.ok) {
      const eventResult = (await eventResponse.json()) as { events: WebhookEvent[] };
      setEvents(eventResult.events);
    }
    setPageError("");
  }, []);

  const refreshRooms = useCallback(async () => {
    setLoadingRooms(true);
    try {
      const response = await fetch("/api/rooms?sync=true", { cache: "no-store" });
      const result = (await response.json().catch(() => ({}))) as {
        rooms?: Room[];
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? `Could not load rooms (${response.status}).`);
      setRooms(result.rooms ?? []);
      setPageError("");
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not load hotel rooms.");
    } finally {
      setLoadingRooms(false);
    }
  }, []);

  useEffect(() => {
    const load = () => {
      void refreshBookings().catch((error: unknown) => {
        setPageError(error instanceof Error ? error.message : "Could not load bookings.");
      });
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [refreshBookings]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshRooms(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshRooms]);

  const blockedRoomIds = useMemo(() => {
    const blocked = new Set<string>();
    for (const room of rooms) {
      if (
        bookings.some(
          (booking) =>
            booking.room_id === room.room_id &&
            isBlocking(booking.status) &&
            overlaps(form.checkIn, form.checkOut, booking.check_in, booking.check_out),
        )
      ) {
        blocked.add(room.room_id);
      }
    }
    return blocked;
  }, [bookings, form.checkIn, form.checkOut, rooms]);

  const selectedRoom = rooms.find((room) => room.room_id === form.roomId);
  function updateForm(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormError("");
    setSuccess("");
  }

  async function copyEndpoint() {
    await navigator.clipboard.writeText(receiverUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function submitBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setSuccess("");

    if (!selectedRoom) {
      setFormError("Select an available room.");
      return;
    }
    if (blockedRoomIds.has(selectedRoom.room_id)) {
      setFormError("That room is already booked for some of the selected dates.");
      return;
    }
    if (form.checkOut <= form.checkIn) {
      setFormError("Check-out must be after check-in.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: selectedRoom.room_id,
          roomTypeId: selectedRoom.room_type_id,
          roomTypeName: selectedRoom.room_type_name,
          roomNumber: selectedRoom.room_number,
          guestName: form.guestName,
          guestEmail: form.guestEmail,
          guestPhone: form.guestPhone,
          checkIn: form.checkIn,
          checkOut: form.checkOut,
          numberOfGuests: Number(form.numberOfGuests),
          totalPrice: Number(form.totalPrice),
          currency: form.currency,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        booking?: Booking;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? `Booking failed (${response.status}).`);

      setSuccess(
        `Booking created${result.booking?.booking_code ? ` · ${result.booking.booking_code}` : ""}.`,
      );
      setForm((current) => ({
        ...initialForm,
        checkIn: current.checkIn,
        checkOut: current.checkOut,
      }));
      await refreshBookings();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not create booking.");
      await refreshBookings().catch(() => undefined);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Anli Demo Tester home">
          <span className="brand-mark">A</span>
          <span>
            <strong>anli</strong>
            <small>BOOKING TESTER</small>
          </span>
        </Link>
        <div className="topbar-right">
          <span className="live-dot" />
          QIIT TECHNOLOGIES
          <span className="topbar-divider" />
          HOTEL ID / 01
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span /> BOOKING &amp; AVAILABILITY WORKSPACE</p>
          <h1>Stay <em>ledger.</em></h1>
          <p className="hero-description">
            Create bookings through the Channel Manager, receive Anli PMS
            notifications, and see room dates blocked in one place.
          </p>
        </div>
        <div className="hero-stamp" aria-hidden="true">
          <span>HOTEL 01</span>
          <strong>↗</strong>
        </div>
      </section>

      <section className="setup-card" aria-labelledby="webhook-title">
        <div className="setup-heading">
          <div className="section-icon">01</div>
          <div>
            <p className="eyebrow">ANLI PMS → THIS APP</p>
            <h2 id="webhook-title">Inbound hotel webhook</h2>
          </div>
          <span className="status-pill status-ready"><span /> HOTEL ID 1</span>
        </div>
        <div className="endpoint-row">
          <span className="method-chip">POST</span>
          <code>{receiverUrl}</code>
          <button className="copy-button" onClick={copyEndpoint}>
            {copied ? "COPIED" : "COPY URL"}
          </button>
        </div>
        <div className="setup-notes">
          <div><span className="note-number">A</span><p>Register this public URL as the hotel webhook URL in Anli.</p></div>
          <div><span className="note-number">B</span><p>Set method to <b>POST</b> and configure the matching <code>ANLI_WEBHOOK_SECRET</code>.</p></div>
          <div><span className="note-number">C</span><p>Booking create, modify, cancel, check-in and check-out notifications update the ledger.</p></div>
        </div>
      </section>

      {pageError && <div className="error-banner page-error" role="alert">{pageError}</div>}

      <section className="workspace-grid">
        <section className="booking-form-card" aria-labelledby="create-title">
          <div className="card-heading">
            <div className="section-icon">02</div>
            <div>
              <p className="eyebrow">CREATE HERE → ANLI PMS</p>
              <h2 id="create-title">New booking</h2>
            </div>
          </div>
          <form onSubmit={submitBooking}>
            <label className="field">
              <span>ROOM</span>
              <select
                value={form.roomId}
                onChange={(event) => updateForm("roomId", event.target.value)}
                required
                disabled={loadingRooms || rooms.length === 0}
              >
                <option value="">
                  {loadingRooms ? "Loading hotel rooms…" : "Select a room"}
                </option>
                {rooms.map((room) => (
                  <option
                    key={room.room_id}
                    value={room.room_id}
                    disabled={blockedRoomIds.has(room.room_id)}
                  >
                    {room.room_type_name} · Room {room.room_number}
                    {blockedRoomIds.has(room.room_id) ? " · DATES BLOCKED" : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="field-row">
              <label className="field">
                <span>CHECK-IN</span>
                <input
                  type="date"
                  value={form.checkIn}
                  onChange={(event) => updateForm("checkIn", event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>CHECK-OUT</span>
                <input
                  type="date"
                  min={form.checkIn}
                  value={form.checkOut}
                  onChange={(event) => updateForm("checkOut", event.target.value)}
                  required
                />
              </label>
            </div>

            <div className="availability-note">
              <span className="availability-mark">{selectedRoom && blockedRoomIds.has(selectedRoom.room_id) ? "!" : "✓"}</span>
              {selectedRoom
                ? blockedRoomIds.has(selectedRoom.room_id)
                  ? `Room ${selectedRoom.room_number} is blocked for these dates.`
                  : `Room ${selectedRoom.room_number} is clear for these dates.`
                : "Choose dates and a room to check for existing bookings."}
            </div>

            <label className="field">
              <span>GUEST NAME</span>
              <input
                value={form.guestName}
                onChange={(event) => updateForm("guestName", event.target.value)}
                placeholder="Full name"
                autoComplete="name"
                required
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>EMAIL</span>
                <input
                  type="email"
                  value={form.guestEmail}
                  onChange={(event) => updateForm("guestEmail", event.target.value)}
                  placeholder="guest@example.com"
                  autoComplete="email"
                  required
                />
              </label>
              <label className="field">
                <span>PHONE</span>
                <input
                  type="tel"
                  value={form.guestPhone}
                  onChange={(event) => updateForm("guestPhone", event.target.value)}
                  placeholder="+234…"
                  autoComplete="tel"
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>GUESTS</span>
                <input
                  type="number"
                  min="1"
                  max={selectedRoom?.capacity ?? 20}
                  value={form.numberOfGuests}
                  onChange={(event) => updateForm("numberOfGuests", event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>TOTAL PRICE</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.totalPrice}
                  onChange={(event) => updateForm("totalPrice", event.target.value)}
                  placeholder="0.00"
                  required
                />
              </label>
              <label className="field currency-field">
                <span>CURRENCY</span>
                <select value={form.currency} onChange={(event) => updateForm("currency", event.target.value)}>
                  <option value="NGN">NGN</option>
                  <option value="USD">USD</option>
                  <option value="GBP">GBP</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>
            </div>

            {formError && <div className="form-message form-error" role="alert">{formError}</div>}
            {success && <div className="form-message form-success" role="status">{success}</div>}
            <button
              className="submit-button"
              type="submit"
              disabled={submitting || loadingRooms || !rooms.length || Boolean(selectedRoom && blockedRoomIds.has(selectedRoom.room_id))}
            >
              {submitting ? "SENDING TO CHANNEL MANAGER…" : "CREATE PMS BOOKING"}
              {!submitting && <span>↗</span>}
            </button>
            <p className="form-footnote">The Channel Manager API creates the PMS booking; this app stores it and blocks this room’s dates.</p>
          </form>
        </section>

        <section className="room-panel" aria-labelledby="rooms-title">
          <div className="card-heading room-heading">
            <div className="section-icon">03</div>
            <div>
              <p className="eyebrow">ROOM INVENTORY</p>
              <h2 id="rooms-title">Blocked dates</h2>
            </div>
            <button className="icon-button" onClick={() => void refreshRooms()} aria-label="Refresh rooms">↻</button>
          </div>
          <div className="room-list">
            {loadingRooms && rooms.length === 0 ? (
              <div className="panel-empty"><span className="loader" /> Loading rooms from Anli…</div>
            ) : rooms.length === 0 ? (
              <div className="panel-empty">
                <strong>No rooms loaded</strong>
                <p>Check Channel Manager URL, API key and hotel ID 1 setup.</p>
                <button className="text-button" onClick={() => void refreshRooms()}>RETRY ROOM SYNC</button>
              </div>
            ) : (
              rooms.map((room) => {
                const activeBookings = bookings.filter(
                  (booking) => booking.room_id === room.room_id && isBlocking(booking.status),
                );
                const currentRangeConflict = blockedRoomIds.has(room.room_id);
                return (
                  <div className="room-row" key={room.room_id}>
                    <div className="room-ident">
                      <span className={`room-led ${currentRangeConflict ? "room-led-blocked" : ""}`} />
                      <span><strong>Room {room.room_number}</strong><small>{room.room_type_name}</small></span>
                    </div>
                    <div className="room-blocks">
                      {activeBookings.length === 0 ? (
                        <span className="available-label">NO DATES BLOCKED</span>
                      ) : (
                        activeBookings.slice(0, 2).map((booking) => (
                          <span className="date-block" key={booking.id} title={booking.guest_name}>
                            {formatDate(booking.check_in)} — {formatDate(booking.check_out)}
                          </span>
                        ))
                      )}
                      {activeBookings.length > 2 && <small>+{activeBookings.length - 2} more stays</small>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="room-legend"><span><i className="legend-open" /> AVAILABLE</span><span><i className="legend-blocked" /> DATES BLOCKED</span></div>
        </section>
      </section>

      <section className="ledger-section" aria-labelledby="ledger-title">
        <div className="inbox-heading">
          <div className="inbox-title-wrap">
            <div className="section-icon">04</div>
            <div>
              <p className="eyebrow">POSTGRESQL BOOKING RECORDS</p>
              <h2 id="ledger-title">Booking ledger <span>{bookings.length.toString().padStart(2, "0")}</span></h2>
            </div>
          </div>
          <span className="refresh-indicator"><i /> AUTO-REFRESH 5S</span>
        </div>
        {bookings.length === 0 ? (
          <div className="empty-state ledger-empty">
            <div className="empty-icon">⌂</div>
            <strong>No bookings in this hotel yet</strong>
            <p>Create a booking or send a booking event from Anli.</p>
          </div>
        ) : (
          <div className="ledger-table-wrap">
            <table className="ledger-table">
              <thead>
                <tr><th>GUEST / BOOKING</th><th>ROOM</th><th>STAY</th><th>STATUS</th><th>ORIGIN</th><th>AMOUNT</th></tr>
              </thead>
              <tbody>
                {bookings.map((booking) => (
                  <tr key={booking.id}>
                    <td><strong>{booking.guest_name}</strong><small>{booking.booking_code ?? booking.external_confirm_id ?? "No booking code"}</small></td>
                    <td><strong>{booking.room_number ? `Room ${booking.room_number}` : "Unassigned"}</strong><small>{booking.room_type_id ? `Type ${booking.room_type_id}` : "Room not provided"}</small></td>
                    <td><strong>{formatDate(booking.check_in)} — {formatDate(booking.check_out)}</strong><small>{booking.number_of_guests} guest{booking.number_of_guests === 1 ? "" : "s"}</small></td>
                    <td>
                      <span className={`booking-status ${booking.status.toLowerCase().replaceAll("_", "-")}`}>{booking.status.replaceAll("_", " ")}</span>
                      {booking.has_room_conflict && <small className="conflict-label">ROOM CONFLICT</small>}
                      {booking.status === "CREATE_FAILED" && <small className="conflict-label">NOT CREATED IN PMS</small>}
                      {booking.pms_forwarded === false && <small className="conflict-label">PMS FORWARDING NOT CONFIRMED</small>}
                    </td>
                    <td><span className={`origin-badge ${booking.origin === "CREATED_HERE" ? "origin-local" : "origin-anli"}`}>{booking.origin === "CREATED_HERE" ? "CREATED HERE" : "ANLI WEBHOOK"}</span></td>
                    <td className="amount-cell">{formatMoney(booking.total_price, booking.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="activity-section" aria-labelledby="activity-title">
        <div className="activity-heading">
          <div>
            <p className="eyebrow">ANLI NOTIFICATION LOG</p>
            <h2 id="activity-title">Recent webhook activity <span>{events.length.toString().padStart(2, "0")}</span></h2>
          </div>
          <span className="refresh-indicator"><i /> PERSISTED IN DATABASE</span>
        </div>
        {events.length === 0 ? (
          <p className="activity-empty">Waiting for the first signed notification from Anli.</p>
        ) : (
          <div className="activity-list">
            {events.slice(0, 8).map((event) => (
              <details className="activity-row" key={event.id}>
                <summary><span className="event-type">{event.event_type}</span><span>Hotel {event.hotel_id}</span><time>{new Date(event.received_at).toLocaleString()}</time><span className="expand-mark">+</span></summary>
                <pre>{JSON.stringify(event.payload, null, 2)}</pre>
              </details>
            ))}
          </div>
        )}
      </section>

      <footer className="footer">
        <span>QIIT TECHNOLOGIES · HOTEL ID 1</span>
        <span>Public demo dashboard · Booking and guest details are visible to visitors.</span>
      </footer>
    </main>
  );
}
