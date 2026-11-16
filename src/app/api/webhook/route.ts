import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  DEMO_HOTEL_ID,
  storeWebhookEvent,
} from "@/lib/booking-service";

type AnliWebhookPayload = {
  hotelId: number;
  eventType: string;
  event: string;
  timestamp: string;
  data: unknown;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAnliPayload(value: unknown): value is AnliWebhookPayload {
  if (!isRecord(value)) return false;

  return (
    typeof value.hotelId === "number" &&
    Number.isSafeInteger(value.hotelId) &&
    typeof value.eventType === "string" &&
    value.eventType.length > 0 &&
    typeof value.event === "string" &&
    typeof value.timestamp === "string" &&
    Number.isFinite(Date.parse(value.timestamp)) &&
    Object.hasOwn(value, "data")
  );
}

async function readBody(request: NextRequest): Promise<string | null> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function receiveWebhook(request: NextRequest) {
  const secret = process.env.ANLI_WEBHOOK_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith("replace-")) {
    return NextResponse.json(
      {
        error:
          "ANLI_WEBHOOK_SECRET must be set to a non-placeholder value of at least 32 characters.",
      },
      { status: 503 },
    );
  }

  const rawBody = await readBody(request);
  if (rawBody === null) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }

  const signature = request.headers.get("x-webhook-signature") ?? "";
  if (!/^[\da-f]{64}$/i.test(signature)) {
    return NextResponse.json(
      { error: "Missing or invalid X-Webhook-Signature." },
      { status: 401 },
    );
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return NextResponse.json({ error: "Webhook signature did not match." }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!isAnliPayload(parsed)) {
    return NextResponse.json(
      {
        error:
          "Payload must include numeric hotelId, eventType, event, timestamp, and data.",
      },
      { status: 400 },
    );
  }

  const headerEvent = request.headers.get("x-webhook-event");
  if (headerEvent && headerEvent !== parsed.eventType) {
    return NextResponse.json(
      { error: "X-Webhook-Event does not match the payload eventType." },
      { status: 400 },
    );
  }

  if (parsed.hotelId !== DEMO_HOTEL_ID) {
    return NextResponse.json(
      { error: "This tester is configured for hotelId 1." },
      { status: 403 },
    );
  }

  try {
    const stored = await storeWebhookEvent(parsed);
    return NextResponse.json(
      {
        accepted: true,
        eventId: stored.eventId,
        bookingStored: Boolean(stored.booking),
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("Could not persist Anli webhook notification:", error);
    return NextResponse.json(
      { error: "The notification could not be saved to the booking database." },
      { status: 503 },
    );
  }
}

export const POST = receiveWebhook;
export const PUT = receiveWebhook;
export const PATCH = receiveWebhook;
