import { NextResponse } from "next/server";
import {
  clearWebhookEvents,
  listWebhookEvents,
} from "@/lib/booking-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(
      { events: await listWebhookEvents() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Could not load stored Anli webhook events:", error);
    return NextResponse.json(
      { error: "Could not load webhook events. Check the PostgreSQL configuration." },
      { status: 503 },
    );
  }
}

export async function DELETE() {
  try {
    await clearWebhookEvents();
    return NextResponse.json({ cleared: true });
  } catch (error) {
    console.error("Could not clear stored Anli webhook events:", error);
    return NextResponse.json(
      { error: "Could not clear webhook events." },
      { status: 503 },
    );
  }
}
