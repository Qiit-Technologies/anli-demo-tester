import { NextResponse } from "next/server";
import {
  listRoomsWithBlocks,
  syncRoomsFromChannelManager,
} from "@/lib/booking-service";
import { isDateOnly } from "@/lib/booking-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const checkIn = query.get("checkIn") ?? undefined;
  const checkOut = query.get("checkOut") ?? undefined;
  if (
    (checkIn && !isDateOnly(checkIn)) ||
    (checkOut && !isDateOnly(checkOut)) ||
    ((checkIn || checkOut) && (!checkIn || !checkOut || checkOut <= checkIn))
  ) {
    return NextResponse.json(
      { error: "Use valid check-in/check-out dates, with check-out after check-in." },
      { status: 400 },
    );
  }

  try {
    const syncedRooms = await syncRoomsFromChannelManager();
    return NextResponse.json(
      {
        hotelId: 1,
        syncedRoomCount: syncedRooms.length,
        rooms: await listRoomsWithBlocks(checkIn, checkOut),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Could not sync hotel rooms:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load rooms from the Channel Manager.",
      },
      { status: 503 },
    );
  }
}
