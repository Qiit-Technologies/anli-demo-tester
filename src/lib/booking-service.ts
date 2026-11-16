import { randomUUID } from "node:crypto";
import {
  acquireBookingLocks,
  findRoomConflict,
  initializeDatabase,
  withTransaction,
} from "@/lib/db";

export const DEMO_HOTEL_ID = 1;

export type BookingRow = {
  id: string;
  hotel_id: number;
  booking_code: string | null;
  external_confirm_id: string | null;
  ota_booking_code: string | null;
  pms_guest_id: string | null;
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
  source: string | null;
  pms_forwarded: boolean | null;
  has_room_conflict: boolean;
  raw_data: unknown;
  created_at: string;
  updated_at: string;
};

export type CreateBookingInput = {
  roomId: string;
  roomTypeId: string;
  roomTypeName: string;
  roomNumber: string;
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  checkIn: string;
  checkOut: string;
  totalPrice: number;
  currency: string;
  numberOfGuests: number;
};

export class BookingInputError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "BookingInputError";
  }
}

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === value;
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return date && isDateOnly(date) ? date : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function requestConfig() {
  const baseUrl = process.env.CHANNEL_MANAGER_BASE_URL?.replace(/\/+$/, "");
  const apiKey = process.env.CHANNEL_MANAGER_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "Set CHANNEL_MANAGER_BASE_URL and CHANNEL_MANAGER_API_KEY to enable hotel room loading and PMS booking creation.",
    );
  }
  return { baseUrl, apiKey };
}

export async function syncRoomsFromChannelManager() {
  const { baseUrl, apiKey } = requestConfig();
  const response = await fetch(
    `${baseUrl}/channel-manager/hotels/${DEMO_HOTEL_ID}/roomtypes`,
    {
      headers: { "x-api-key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    },
  );

  const result = (await response.json().catch(() => null)) as
    | {
        roomTypes?: Array<{
          id?: string | number;
          name?: string;
          rooms?: Array<{
            id?: string | number;
            roomNumber?: string;
            roomCapacity?: number;
            status?: string;
          }>;
        }>;
        message?: string;
      }
    | null;

  if (!response.ok) {
    throw new Error(
      result?.message ?? `Channel Manager room lookup failed (${response.status}).`,
    );
  }
  if (!result || !Array.isArray(result.roomTypes)) {
    throw new Error("Channel Manager returned an unexpected room-types response.");
  }

  const pool = await initializeDatabase();
  const rooms = result.roomTypes.flatMap((type) =>
    (type.rooms ?? [])
      .filter(
        (room): room is typeof room & { id: string | number; roomNumber: string } =>
          room.id !== undefined && typeof room.roomNumber === "string",
      )
      .map((room) => ({
        hotelId: DEMO_HOTEL_ID,
        roomId: String(room.id),
        roomTypeId: String(type.id ?? ""),
        roomTypeName: type.name ?? "Room type",
        roomNumber: room.roomNumber,
        capacity: room.roomCapacity ?? null,
        status: room.status ?? null,
      })),
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const room of rooms) {
      await client.query(
        `
          INSERT INTO demo_rooms
            (hotel_id, room_id, room_type_id, room_type_name, room_number, capacity, room_status, synced_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          ON CONFLICT (hotel_id, room_id) DO UPDATE SET
            room_type_id = EXCLUDED.room_type_id,
            room_type_name = EXCLUDED.room_type_name,
            room_number = EXCLUDED.room_number,
            capacity = EXCLUDED.capacity,
            room_status = EXCLUDED.room_status,
            synced_at = NOW()
        `,
        [
          room.hotelId,
          room.roomId,
          room.roomTypeId,
          room.roomTypeName,
          room.roomNumber,
          room.capacity,
          room.status,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return rooms;
}

export async function listRoomsWithBlocks(checkIn?: string, checkOut?: string) {
  const pool = await initializeDatabase();
  const result = await pool.query(
    `
      SELECT
        r.hotel_id,
        r.room_id,
        r.room_type_id,
        r.room_type_name,
        r.room_number,
        r.capacity,
        r.room_status,
        r.synced_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', b.id,
              'bookingCode', b.booking_code,
              'guestName', b.guest_name,
              'checkIn', b.check_in,
              'checkOut', b.check_out,
              'status', b.status,
              'origin', b.origin
            ) ORDER BY b.check_in
          ) FILTER (WHERE b.id IS NOT NULL),
          '[]'::json
        ) AS bookings,
        BOOL_OR(b.id IS NOT NULL) AS blocked
      FROM demo_rooms r
      LEFT JOIN demo_bookings b
        ON b.hotel_id = r.hotel_id
        AND b.room_id = r.room_id
        AND b.status NOT IN ('CANCELLED', 'CANCELED', 'CREATE_FAILED', 'NO_SHOW')
        AND ($2::date IS NULL OR (b.check_in < $3::date AND b.check_out > $2::date))
      WHERE r.hotel_id = $1
      GROUP BY r.hotel_id, r.room_id, r.room_type_id, r.room_type_name,
        r.room_number, r.capacity, r.room_status, r.synced_at
      ORDER BY r.room_type_name, r.room_number
    `,
    [DEMO_HOTEL_ID, checkIn ?? null, checkOut ?? null],
  );

  return result.rows;
}

export async function createBooking(input: CreateBookingInput): Promise<BookingRow> {
  const { baseUrl, apiKey } = requestConfig();
  if (!isDateOnly(input.checkIn) || !isDateOnly(input.checkOut)) {
    throw new BookingInputError("Enter valid check-in and check-out dates.");
  }
  if (input.checkOut <= input.checkIn) {
    throw new BookingInputError("Check-out must be after check-in.");
  }
  if (!Number.isFinite(input.totalPrice) || input.totalPrice < 0) {
    throw new BookingInputError("Total price must be zero or more.");
  }
  if (!Number.isSafeInteger(input.numberOfGuests) || input.numberOfGuests < 1) {
    throw new BookingInputError("Guest count must be at least one.");
  }

  const pool = await initializeDatabase();
  const roomResult = await pool.query(
    `SELECT * FROM demo_rooms WHERE hotel_id = $1 AND room_id = $2`,
    [DEMO_HOTEL_ID, input.roomId],
  );
  const room = roomResult.rows[0];
  if (!room || room.room_type_id !== input.roomTypeId) {
    throw new BookingInputError(
      "Select a room from the latest Channel Manager room list.",
    );
  }

  const bookingId = randomUUID();
  const externalConfirmId = `QIIT-DEMO-${randomUUID()}`;
  await withTransaction(async (client) => {
    await acquireBookingLocks(client, [`room:${DEMO_HOTEL_ID}:${input.roomId}`]);
    const conflict = await findRoomConflict(client, {
      hotelId: DEMO_HOTEL_ID,
      roomId: input.roomId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
    });
    if (conflict) {
      throw new BookingInputError(
        `Room ${input.roomNumber} is already blocked by ${conflict.booking_code ?? conflict.guest_name} for overlapping dates.`,
        409,
      );
    }

    await client.query(
      `
        INSERT INTO demo_bookings (
          id, hotel_id, external_confirm_id, ota_booking_code, room_id,
          room_type_id, room_number, guest_name, guest_email, guest_phone,
          check_in, check_out, total_price, currency, number_of_guests,
          status, origin, source, raw_data
        ) VALUES (
          $1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13, $14, 'CREATING', 'CREATED_HERE', 'QIIT_DEMO', $15::jsonb
        )
      `,
      [
        bookingId,
        DEMO_HOTEL_ID,
        externalConfirmId,
        input.roomId,
        input.roomTypeId,
        input.roomNumber,
        input.guestName.trim(),
        input.guestEmail.trim(),
        input.guestPhone?.trim() || null,
        input.checkIn,
        input.checkOut,
        input.totalPrice,
        input.currency.trim().toUpperCase(),
        input.numberOfGuests,
        JSON.stringify(input),
      ],
    );
  });

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/channel-manager/bookings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        hotelId: DEMO_HOTEL_ID,
        roomTypeId: input.roomTypeId,
        checkInDate: input.checkIn,
        checkOutDate: input.checkOut,
        roomNumber: input.roomNumber,
        guest: {
          fullName: input.guestName.trim(),
          email: input.guestEmail.trim(),
          ...(input.guestPhone?.trim()
            ? { phoneNumber: input.guestPhone.trim() }
            : {}),
        },
        totalPrice: input.totalPrice,
        currency: input.currency.trim().toUpperCase(),
        externalConfirmId,
        otaBookingCode: externalConfirmId,
        source: "QIIT_DEMO",
        status: "CONFIRMED",
        numberOfGuests: input.numberOfGuests,
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    await pool.query(
      `UPDATE demo_bookings SET status = 'CREATE_FAILED', updated_at = NOW() WHERE id = $1 AND status = 'CREATING'`,
      [bookingId],
    );
    throw new Error(
      `Could not reach the Channel Manager: ${error instanceof Error ? error.message : "network error"}`,
    );
  }

  const responseData = (await response.json().catch(() => null)) as
    | {
        success?: boolean;
        bookingReference?: string;
        bookingCode?: string;
        oreonBookingCode?: string;
        status?: string;
        oreonForwarded?: boolean;
        message?: string;
        error?: string;
      }
    | null;

  if (!response.ok || responseData?.success === false) {
    await pool.query(
      `UPDATE demo_bookings SET status = 'CREATE_FAILED', updated_at = NOW() WHERE id = $1 AND status = 'CREATING'`,
      [bookingId],
    );
    throw new Error(
      responseData?.message ??
        responseData?.error ??
        `Channel Manager rejected the booking (HTTP ${response.status}).`,
    );
  }

  const code =
    nonEmpty(responseData?.bookingReference) ??
    nonEmpty(responseData?.bookingCode) ??
    nonEmpty(responseData?.oreonBookingCode);
  const status = nonEmpty(responseData?.status)?.toUpperCase() ?? "CONFIRMED";
  const forwarded =
    typeof responseData?.oreonForwarded === "boolean"
      ? responseData.oreonForwarded
      : null;

  const updated = await pool.query<BookingRow>(
    `
      UPDATE demo_bookings SET
        booking_code = COALESCE($2, booking_code),
        status = CASE WHEN status = 'CREATING' THEN $3 ELSE status END,
        pms_forwarded = $4,
        raw_data = raw_data || $5::jsonb,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      bookingId,
      code,
      status,
      forwarded,
      JSON.stringify({ channelManagerResponse: responseData }),
    ],
  );

  return updated.rows[0];
}

function getWebhookBookingData(payload: Record<string, unknown>) {
  const nested = payload.data;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : null;
}

function bookingStatusForEvent(eventType: string, data: Record<string, unknown>) {
  if (eventType === "BOOKING_CANCEL" || data.isVoid === true) return "CANCELLED";
  if (eventType === "CHECK_IN" || data.isCheckedIn === true) return "CHECKED_IN";
  if (eventType === "CHECK_OUT" || data.isCheckedOut === true) return "CHECKED_OUT";
  const supplied = nonEmpty(data.bookingStatus);
  if (supplied) return supplied.toUpperCase();
  return eventType === "BOOKING_NEW" ? "CONFIRMED" : "MODIFIED";
}

export async function storeWebhookEvent(
  payload: Record<string, unknown>,
): Promise<{ eventId: string; booking: BookingRow | null }> {
  const pool = await initializeDatabase();
  const client = await pool.connect();
  const eventId = randomUUID();
  const hotelId = Number(payload.hotelId);
  const eventType = String(payload.eventType);
  const data = getWebhookBookingData(payload);

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO demo_webhook_events (id, hotel_id, event_type, payload) VALUES ($1, $2, $3, $4::jsonb)`,
      [eventId, hotelId, eventType, JSON.stringify(payload)],
    );

    let savedBooking: BookingRow | null = null;
    if (
      data &&
      ["BOOKING_NEW", "BOOKING_MODIFY", "BOOKING_CANCEL", "CHECK_IN", "CHECK_OUT"].includes(eventType)
    ) {
      const bookingCode = nonEmpty(data.bookingCode);
      const otaBookingCode = nonEmpty(data.otaBookingCode);
      const pmsGuestId =
        data.id === undefined || data.id === null ? null : String(data.id);
      const externalConfirmId = otaBookingCode;
      const guestName =
        nonEmpty(data.fullName) ??
        (bookingCode || pmsGuestId
          ? `Guest ${bookingCode ?? pmsGuestId}`
          : null);
      const guestEmail = nonEmpty(data.email);
      const checkIn = dateOnly(data.startDate);
      const checkOut = dateOnly(data.endDate);
      const roomId = data.roomId === undefined || data.roomId === null
        ? null
        : String(data.roomId);
      const roomTypeId = data.roomtypeId === undefined || data.roomtypeId === null
        ? null
        : String(data.roomtypeId);
      const roomNumber = nonEmpty(data.roomNumber);

      if (guestName && checkIn && checkOut && checkOut > checkIn) {
        await acquireBookingLocks(client, [
          `booking:${hotelId}:${bookingCode ?? externalConfirmId ?? pmsGuestId}`,
          roomId ? `room:${hotelId}:${roomId}` : null,
        ]);

        const existing = await client.query<BookingRow>(
          `
            SELECT * FROM demo_bookings
            WHERE hotel_id = $1
              AND (
                ($2::text IS NOT NULL AND booking_code = $2)
                OR ($3::text IS NOT NULL AND external_confirm_id = $3)
                OR ($3::text IS NOT NULL AND ota_booking_code = $3)
                OR ($4::text IS NOT NULL AND pms_guest_id = $4)
              )
            ORDER BY CASE WHEN booking_code = $2 THEN 0
              WHEN external_confirm_id = $3 OR ota_booking_code = $3 THEN 1 ELSE 2 END
            LIMIT 1
            FOR UPDATE
          `,
          [hotelId, bookingCode, externalConfirmId, pmsGuestId],
        );
        const matched = existing.rows[0];
        const conflict = roomId
          ? await findRoomConflict(client, {
              hotelId,
              roomId,
              checkIn,
              checkOut,
              excludeBookingId: matched?.id,
            })
          : undefined;
        const status = bookingStatusForEvent(eventType, data);
        const totalPrice =
          numberValue(data.bookingAmount) ??
          numberValue(data.totalPrice) ??
          numberValue(data.amount) ??
          0;
        const currency = nonEmpty(data.currency) ?? "NGN";
        const numberOfGuests = Math.max(
          1,
          Math.floor(numberValue(data.numberOfGuests) ?? 1),
        );

        if (matched) {
          const updated = await client.query<BookingRow>(
            `
              UPDATE demo_bookings SET
                booking_code = COALESCE($2, booking_code),
                external_confirm_id = COALESCE($3, external_confirm_id),
                ota_booking_code = COALESCE($4, ota_booking_code),
                pms_guest_id = COALESCE($5, pms_guest_id),
                room_id = COALESCE($6, room_id),
                room_type_id = COALESCE($7, room_type_id),
                room_number = COALESCE($8, room_number),
                guest_name = $9,
                guest_email = $10,
                guest_phone = COALESCE($11, guest_phone),
                check_in = $12,
                check_out = $13,
                total_price = CASE WHEN $14::numeric > 0 THEN $14 ELSE total_price END,
                currency = $15,
                number_of_guests = $16,
                status = $17,
                has_room_conflict = $18,
                raw_data = $19::jsonb,
                updated_at = NOW()
              WHERE id = $1
              RETURNING *
            `,
            [
              matched.id,
              bookingCode,
              externalConfirmId,
              otaBookingCode,
              pmsGuestId,
              roomId,
              roomTypeId,
              roomNumber,
              guestName,
              guestEmail,
              nonEmpty(data.phoneNumber),
              checkIn,
              checkOut,
              totalPrice,
              currency,
              numberOfGuests,
              status,
              Boolean(conflict),
              JSON.stringify(payload),
            ],
          );
          savedBooking = updated.rows[0];
        } else {
          const inserted = await client.query<BookingRow>(
            `
              INSERT INTO demo_bookings (
                id, hotel_id, booking_code, external_confirm_id, ota_booking_code,
                pms_guest_id, room_id, room_type_id, room_number, guest_name,
                guest_email, guest_phone, check_in, check_out, total_price,
                currency, number_of_guests, status, origin, source,
                has_room_conflict, raw_data
              ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18,
                'ANLI_WEBHOOK', 'ANLI_PMS', $19, $20::jsonb
              )
              RETURNING *
            `,
            [
              randomUUID(),
              hotelId,
              bookingCode,
              externalConfirmId,
              otaBookingCode,
              pmsGuestId,
              roomId,
              roomTypeId,
              roomNumber,
              guestName,
              guestEmail,
              nonEmpty(data.phoneNumber),
              checkIn,
              checkOut,
              totalPrice,
              currency,
              numberOfGuests,
              status,
              Boolean(conflict),
              JSON.stringify(payload),
            ],
          );
          savedBooking = inserted.rows[0];
        }
      }
    }

    await client.query("COMMIT");
    return { eventId, booking: savedBooking };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listBookings(): Promise<BookingRow[]> {
  const pool = await initializeDatabase();
  const result = await pool.query<BookingRow>(
    `SELECT * FROM demo_bookings WHERE hotel_id = $1 ORDER BY check_in DESC, created_at DESC LIMIT 500`,
    [DEMO_HOTEL_ID],
  );
  return result.rows;
}

export async function listWebhookEvents() {
  const pool = await initializeDatabase();
  const result = await pool.query(
    `SELECT id, hotel_id, event_type, received_at, payload FROM demo_webhook_events WHERE hotel_id = $1 ORDER BY received_at DESC LIMIT 100`,
    [DEMO_HOTEL_ID],
  );
  return result.rows;
}

export async function clearWebhookEvents() {
  const pool = await initializeDatabase();
  await pool.query(`DELETE FROM demo_webhook_events WHERE hotel_id = $1`, [
    DEMO_HOTEL_ID,
  ]);
}
