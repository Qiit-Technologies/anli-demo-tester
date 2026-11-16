import { NextRequest, NextResponse } from "next/server";
import {
  BookingInputError,
  createBooking,
  listBookings,
} from "@/lib/booking-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const bookings = await listBookings();
    return NextResponse.json({ hotelId: 1, bookings }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Could not load stored bookings:", error);
    return NextResponse.json(
      { error: "Could not load bookings. Check the PostgreSQL configuration." },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
  }

  const value = body as Record<string, unknown>;
  const requiredText = [
    "roomId",
    "roomTypeId",
    "roomTypeName",
    "roomNumber",
    "guestName",
    "guestEmail",
    "checkIn",
    "checkOut",
    "currency",
  ];
  for (const key of requiredText) {
    if (typeof value[key] !== "string" || !value[key].trim()) {
      return NextResponse.json({ error: `${key} is required.` }, { status: 400 });
    }
  }
  if (
    typeof value.guestEmail !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.guestEmail)
  ) {
    return NextResponse.json({ error: "Enter a valid guest email." }, { status: 400 });
  }
  if (typeof value.totalPrice !== "number" || typeof value.numberOfGuests !== "number") {
    return NextResponse.json(
      { error: "totalPrice and numberOfGuests must be numbers." },
      { status: 400 },
    );
  }

  try {
    const booking = await createBooking({
      roomId: value.roomId as string,
      roomTypeId: value.roomTypeId as string,
      roomTypeName: value.roomTypeName as string,
      roomNumber: value.roomNumber as string,
      guestName: value.guestName as string,
      guestEmail: value.guestEmail as string,
      guestPhone: typeof value.guestPhone === "string" ? value.guestPhone : undefined,
      checkIn: value.checkIn as string,
      checkOut: value.checkOut as string,
      totalPrice: value.totalPrice,
      currency: value.currency as string,
      numberOfGuests: value.numberOfGuests,
    });
    return NextResponse.json({ booking }, { status: 201 });
  } catch (error) {
    if (error instanceof BookingInputError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Could not create booking through Channel Manager:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Booking creation failed.",
      },
      { status: 502 },
    );
  }
}
