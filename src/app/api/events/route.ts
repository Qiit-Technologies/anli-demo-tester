import { NextResponse } from "next/server";
import { clearWebhookEvents, listWebhookEvents } from "@/lib/event-store";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      events: listWebhookEvents(),
      webhookSecretConfigured: Boolean(process.env.ANLI_WEBHOOK_SECRET),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export function DELETE() {
  clearWebhookEvents();
  return NextResponse.json({ cleared: true });
}
